import { createSubscriber } from "svelte/reactivity";
import {
  createV5Client,
  type V5Client,
  type V5ConnectionStatus,
  type V5Snapshot,
} from "../client.js";
import { type V5ConsoleSnapshot } from "../console.js";

export interface V5State {
  readonly client: V5Client;
  readonly snapshot: V5Snapshot;
  readonly status: V5ConnectionStatus;
  /** Live output of the running user program. */
  readonly console: V5ConsoleSnapshot;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  startConsole(): Promise<boolean>;
  stopConsole(): Promise<void>;
  clearConsole(): void;
  sendToConsole(text: string): Promise<boolean>;
}

class V5RuneState implements V5State {
  readonly client: V5Client;
  readonly #subscribe: () => void;
  readonly #subscribeConsole: () => void;

  constructor(client: V5Client) {
    this.client = client;
    this.#subscribe = createSubscriber((update) =>
      client.subscribe(() => update()),
    );
    // The console has its own subscription so that reading `console` does not
    // make a component re-run on every connection snapshot, or the other way
    // round.
    this.#subscribeConsole = createSubscriber((update) =>
      client.console.subscribe(() => update()),
    );
  }

  get snapshot(): V5Snapshot {
    this.#subscribe();
    return this.client.getSnapshot();
  }

  get console(): V5ConsoleSnapshot {
    this.#subscribeConsole();
    return this.client.console.getSnapshot();
  }

  get status(): V5ConnectionStatus {
    return this.snapshot.status;
  }

  connect(): Promise<boolean> {
    return this.client.connect();
  }

  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  refresh(): Promise<void> {
    return this.client.refresh();
  }

  startConsole(): Promise<boolean> {
    return this.client.console.start();
  }

  stopConsole(): Promise<void> {
    return this.client.console.stop();
  }

  clearConsole(): void {
    this.client.console.clear();
  }

  sendToConsole(text: string): Promise<boolean> {
    return this.client.console.send(text);
  }
}

export function createV5State(client: V5Client = createV5Client()): V5State {
  return new V5RuneState(client);
}
