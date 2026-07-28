import { err, ok, Result, ResultAsync } from "neverthrow";
import {
  VexInvalidArgumentError,
  VexNotConnectedError,
  VexSerialError,
  toVexSerialError,
} from "./error.js";
import { sleepUntil } from "./timing.js";
import { V5SerialConnection } from "./v5-serial-connection.js";

interface ConnectionLifecycleHost {
  getSerial(): Serial;
  getConnection(): V5SerialConnection | undefined;
  setConnection(connection: V5SerialConnection | undefined): void;
  createConnection(): V5SerialConnection;
  invalidateSnapshots(): void;
  refresh(): ResultAsync<boolean, VexSerialError>;
  getBrainUniqueId(): number;
  getAutoReconnect(): boolean;
  setAutoReconnect(value: boolean): void;
  setAutoRefresh(value: boolean): void;
  emitDisconnected(): void;
  emitError(error: VexSerialError): void;
  reconnect(): ResultAsync<void, VexSerialError>;
}

function describePort(port: SerialPort): string | undefined {
  const info = port.getInfo() as SerialPortInfo & {
    path?: unknown;
    id?: unknown;
    serialNumber?: unknown;
  };
  const identifier = info.path ?? info.id ?? info.serialNumber;
  return typeof identifier === "string" ? identifier : undefined;
}

export class ConnectionLifecycle {
  private generation = 0;
  private reconnecting = false;
  private disconnecting = false;
  private disposed = false;
  private cancelReconnectWait: (() => void) | undefined;
  private disconnectListener:
    | {
        connection: V5SerialConnection;
        listener: () => void;
      }
    | undefined;

  constructor(private readonly host: ConnectionLifecycleHost) {}

  get isReconnecting(): boolean {
    return this.reconnecting;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  connect(conn?: V5SerialConnection): ResultAsync<void, VexSerialError> {
    if (this.disposed) return this.staleResultAsync();
    if (this.isConnected())
      return ResultAsync.fromSafePromise(Promise.resolve());

    const generation = this.advance();
    return new ResultAsync(this.runConnect(conn, generation));
  }

  private async runConnect(
    conn: V5SerialConnection | undefined,
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    if (!this.isCurrent(generation)) return this.staleResult();
    if (this.isConnected()) return ok(undefined);

    if (conn != null) {
      const accepted = await this.openSuppliedConnection(conn, generation);
      if (accepted.isErr()) return accepted;
    } else {
      const discovered = await this.discoverConnection(generation);
      if (discovered.isErr()) return discovered;
    }

    return this.initializeCommittedConnection(generation);
  }

  private async openSuppliedConnection(
    connection: V5SerialConnection,
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    if (!connection.isConnected) {
      const opened = await connection.open();
      if (await this.wasSuperseded(generation, connection)) {
        return this.staleResult();
      }
      if (opened.isErr()) {
        await this.closeFailedCandidate(connection);
        return err(opened.error);
      }
      if (opened.value !== "opened") {
        await this.closeFailedCandidate(connection);
        return err(
          new VexNotConnectedError(
            opened.value === "busy"
              ? "the supplied V5 serial port is busy"
              : "the supplied connection did not select a V5 serial port",
          ),
        );
      }
    }

    const query = await connection.query1();
    if (await this.wasSuperseded(generation, connection)) {
      return this.staleResult();
    }
    if (query.isErr()) {
      await connection.close();
      return err(query.error);
    }
    if (!this.commit(connection, generation)) {
      await connection.close();
      return this.staleResult();
    }
    return ok(undefined);
  }

  private async discoverConnection(
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    let tryIndex = 0;
    let canRequestPort = true;
    const attemptedPorts = new Set<SerialPort>();
    const attemptedPortNames: string[] = [];

    while (true) {
      if (!this.isCurrent(generation)) return this.staleResult();
      const candidate = this.host.createConnection();

      let result = await candidate.open(tryIndex++, false);
      if (await this.wasSuperseded(generation, candidate)) {
        return this.staleResult();
      }
      if (result.isOk() && result.value === "no-port" && canRequestPort) {
        canRequestPort = false;
        result = await candidate.open(tryIndex, true);
        if (await this.wasSuperseded(generation, candidate)) {
          return this.staleResult();
        }
      }
      if (result.isErr()) {
        await candidate.close();
        return err(result.error);
      }
      if (result.value === "no-port") {
        const attempted = attemptedPortNames.length
          ? `; attempted ${attemptedPortNames.join(", ")}`
          : "";
        return err(
          new VexNotConnectedError(
            `no responsive V5 device was found${attempted}`,
          ),
        );
      }
      if (result.value === "busy") {
        await candidate.close();
        return err(
          new VexNotConnectedError("the selected V5 serial port is busy"),
        );
      }

      const port = candidate.port;
      if (port !== undefined && attemptedPorts.has(port)) {
        await candidate.close();
        const portName = describePort(port);
        return err(
          new VexNotConnectedError(
            portName === undefined
              ? "the selected serial port did not respond as a V5 device"
              : `serial port ${portName} did not respond as a V5 device`,
          ),
        );
      }
      if (port !== undefined) {
        attemptedPorts.add(port);
        const portName = describePort(port);
        if (portName !== undefined) attemptedPortNames.push(portName);
      }

      const query = await candidate.query1();
      if (await this.wasSuperseded(generation, candidate)) {
        return this.staleResult();
      }
      if (query.isErr()) {
        await candidate.close();
        continue;
      }

      if (!this.commit(candidate, generation)) {
        await candidate.close();
        return this.staleResult();
      }
      return ok(undefined);
    }
  }

  async disconnect(): Promise<void> {
    this.advance();
    this.host.invalidateSnapshots();
    this.disconnecting = true;
    const connection = this.host.getConnection();
    this.host.setConnection(undefined);
    this.detachDisconnectListener();
    try {
      await connection?.close();
    } finally {
      this.disconnecting = false;
    }
  }

  async dispose(): Promise<void> {
    this.host.setAutoReconnect(false);
    this.host.setAutoRefresh(false);
    this.disposed = true;
    await this.disconnect();
  }

  reconnect(timeout = 0): ResultAsync<void, VexSerialError> {
    if (this.disposed) return this.staleResultAsync();
    const invalidTimeout = this.validateTimeout(timeout);
    if (invalidTimeout !== undefined) return invalidTimeout;
    if (this.isConnected())
      return ResultAsync.fromSafePromise(Promise.resolve());

    const generation = this.reconnecting ? this.generation : this.advance();
    return new ResultAsync(this.runReconnect(timeout, generation));
  }

  private validateTimeout(
    timeout: number,
  ): ResultAsync<void, VexSerialError> | undefined {
    if (Number.isFinite(timeout) && timeout >= 0) return undefined;
    return new ResultAsync(
      Promise.resolve(
        err(
          new VexInvalidArgumentError(
            "timeout must be a finite, non-negative number",
          ),
        ),
      ),
    );
  }

  private async runReconnect(
    timeout: number,
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    if (!this.isCurrent(generation)) return this.staleResult();
    if (this.isConnected()) return ok(undefined);

    const endTime = Date.now() + timeout;
    if (this.reconnecting) {
      if (timeout === 0) {
        await this.waitForReconnectToFinish();
      } else {
        const waited = await sleepUntil(() => !this.reconnecting, timeout);
        if (waited.isErr() || !waited.value) {
          return err(new VexNotConnectedError());
        }
      }
      if (!this.isCurrent(generation)) return this.staleResult();
      if (this.isConnected()) return ok(undefined);
    }

    this.reconnecting = true;
    try {
      while (timeout === 0 || Date.now() < endTime) {
        const attempt = await this.tryReconnectPorts(
          generation,
          endTime,
          timeout,
        );
        if (attempt.isErr()) return attempt;
        if (this.isConnected()) break;

        const remaining = timeout === 0 ? 1000 : endTime - Date.now();
        if (remaining <= 0) break;
        await this.waitForRetry(Math.min(1000, remaining), generation);
        if (!this.isCurrent(generation)) return this.staleResult();
      }
    } catch (error) {
      return err(toVexSerialError(error));
    } finally {
      this.reconnecting = false;
    }

    return this.initializeCommittedConnection(generation);
  }

  private async tryReconnectPorts(
    generation: number,
    endTime: number,
    timeout: number,
  ): Promise<Result<void, VexSerialError>> {
    let tryIndex = 0;
    while (true) {
      if (!this.isCurrent(generation)) return this.staleResult();
      if (timeout !== 0 && Date.now() >= endTime) return ok(undefined);
      const candidate = this.host.createConnection();
      const result = await candidate.open(tryIndex++, false);
      if (await this.wasSuperseded(generation, candidate)) {
        return this.staleResult();
      }
      if (result.isErr()) {
        await candidate.close();
        return err(result.error);
      }
      if (result.value === "no-port") return ok(undefined);
      if (result.value === "busy") {
        await candidate.close();
        continue;
      }

      const status = await candidate.getSystemStatus(200);
      if (await this.wasSuperseded(generation, candidate)) {
        return this.staleResult();
      }
      if (status.isErr()) {
        await candidate.close();
        continue;
      }
      const uniqueId = this.host.getBrainUniqueId();
      if (uniqueId !== 0 && status.value.uniqueId !== uniqueId) {
        await candidate.close();
        continue;
      }
      if (!this.commit(candidate, generation)) {
        await candidate.close();
        return this.staleResult();
      }
      return ok(undefined);
    }
  }

  private async initializeCommittedConnection(
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    const connection = this.host.getConnection();
    if (!this.isCurrent(generation) || connection == null) {
      return this.staleResult();
    }
    if (!connection.isConnected) return err(new VexNotConnectedError());
    return this.afterConnect(connection, generation);
  }

  private async waitForReconnectToFinish(): Promise<void> {
    while (this.reconnecting) {
      const result = await sleepUntil(() => !this.reconnecting, 1000);
      if (result.isOk() && result.value) return;
    }
  }

  private async waitForRetry(
    delayMs: number,
    generation: number,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        this.host.getSerial().removeEventListener("connect", finish);
        if (this.cancelReconnectWait === finish) {
          this.cancelReconnectWait = undefined;
        }
        resolve();
      };

      this.cancelReconnectWait?.();
      this.cancelReconnectWait = finish;
      this.host.getSerial().addEventListener("connect", finish, { once: true });
      timer = setTimeout(finish, delayMs);
      if (!this.isCurrent(generation)) finish();
    });
  }

  private isConnected(): boolean {
    return this.host.getConnection()?.isConnected ?? false;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.disposed;
  }

  private advance(): number {
    this.generation++;
    this.cancelReconnectWait?.();
    return this.generation;
  }

  private async wasSuperseded(
    generation: number,
    candidate: V5SerialConnection,
  ): Promise<boolean> {
    if (this.isCurrent(generation)) return false;
    await candidate.close();
    return true;
  }

  private staleResult(): Result<void, VexSerialError> {
    return err(new VexNotConnectedError("connection attempt was superseded"));
  }

  private staleResultAsync(): ResultAsync<void, VexSerialError> {
    return new ResultAsync(Promise.resolve(this.staleResult()));
  }

  private async closeFailedCandidate(
    connection: V5SerialConnection,
  ): Promise<void> {
    try {
      await connection.close();
    } catch {
      // Preserve the failure that prevented the candidate from opening.
    }
  }

  private commit(connection: V5SerialConnection, generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.detachDisconnectListener();
    this.host.setConnection(connection);
    return true;
  }

  private detachDisconnectListener(): void {
    const subscription = this.disconnectListener;
    this.disconnectListener = undefined;
    subscription?.connection.remove("disconnected", subscription.listener);
  }

  private async afterConnect(
    connection: V5SerialConnection,
    generation: number,
  ): Promise<Result<void, VexSerialError>> {
    if (
      !this.isCurrent(generation) ||
      this.host.getConnection() !== connection
    ) {
      return this.staleResult();
    }

    const listener = () => {
      if (
        this.disconnecting ||
        !this.isCurrent(generation) ||
        this.host.getConnection() !== connection
      ) {
        return;
      }
      this.advance();
      this.host.invalidateSnapshots();
      this.host.setConnection(undefined);
      this.detachDisconnectListener();
      this.host.emitDisconnected();
      if (this.host.getAutoReconnect() && !this.disposed) {
        void this.host
          .reconnect()
          .mapErr((error) => this.host.emitError(error));
      }
    };
    connection.on("disconnected", listener);
    this.disconnectListener = { connection, listener };

    const refreshed = await this.host.refresh();
    if (
      !this.isCurrent(generation) ||
      this.host.getConnection() !== connection ||
      !connection.isConnected
    ) {
      return this.staleResult();
    }
    if (refreshed.isErr()) {
      await this.discardConnection(connection, generation);
      return err(refreshed.error);
    }
    if (!refreshed.value) {
      await this.discardConnection(connection, generation);
      return err(
        new VexNotConnectedError(
          "initial device refresh did not produce a current snapshot",
        ),
      );
    }
    return ok(undefined);
  }

  private async discardConnection(
    connection: V5SerialConnection,
    generation: number,
  ): Promise<void> {
    if (
      !this.isCurrent(generation) ||
      this.host.getConnection() !== connection
    ) {
      return;
    }
    this.advance();
    this.host.invalidateSnapshots();
    this.host.setConnection(undefined);
    this.detachDisconnectListener();
    await connection.close();
  }
}
