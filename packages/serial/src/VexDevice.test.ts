import { afterEach, describe, expect, test } from "bun:test";
import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { FileVendor, MatchMode, RadioChannelType } from "./Vex";
import {
  V5Radio,
  V5SerialDevice,
  downloadFileFromInternet,
  sleepUntil,
  sleepUntilAsync,
} from "./VexDevice";
import { V5SerialConnection } from "./VexConnection";
import { VexIoError, VexProtocolError } from "./VexError";
import { type ProgramIniConfig } from "./VexIniConfig";
import {
  GetDeviceStatusReplyD2HPacket as GetDeviceStatusReplyD2HPacketClass,
  GetRadioStatusReplyD2HPacket as GetRadioStatusReplyD2HPacketClass,
  GetSystemFlagsReplyD2HPacket as GetSystemFlagsReplyD2HPacketClass,
  GetSystemStatusReplyD2HPacket as GetSystemStatusReplyD2HPacketClass,
  LoadFileActionReplyD2HPacket,
  MatchModeReplyD2HPacket,
} from "./VexPacket";
import { VexFirmwareVersion } from "./VexFirmwareVersion";

const devices: V5SerialDevice[] = [];
const serial = {
  getPorts: async () => [],
} as unknown as Serial;

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

describe("sleepUntilAsync", () => {
  test("waits between attempts and propagates predicate failures", async () => {
    let attempts = 0;
    expect(
      (
        await sleepUntilAsync(async () => ++attempts === 2, 100, 10)
      )._unsafeUnwrap(),
    ).toBe(true);
    expect(attempts).toBe(2);
    const failed = await sleepUntilAsync(async () => {
      throw new Error("predicate failed");
    }, 100);
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().message).toContain("predicate failed");
  });
});

test("downloadFileFromInternet rejects HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  const mockedFetch = Object.assign(
    async () => new Response("missing", { status: 404 }),
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = mockedFetch;
  try {
    const result = await downloadFileFromInternet("https://example.test/file");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("404");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("firmware uploads reject unsafe version paths", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;

  const result = await device.brain.uploadFirmware(
    "https://example.test/",
    "../firmware",
  );
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("invalid VEXos version");
});

test("firmware uploads propagate download failures", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("missing", { status: 404 }),
    { preconnect: originalFetch.preconnect },
  );

  try {
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "valid-version",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("404");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful file reads resume automatic refresh", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const connection = {
    isConnected: true,
    downloadFileToHost: () => okAsync(new Uint8Array([1, 2, 3])),
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.connection = connection;

  expect(
    (
      await device.brain.readFile({ filename: "test", vendor: FileVendor.USER })
    )._unsafeUnwrap(),
  ).toEqual(new Uint8Array([1, 2, 3]));
  expect(device.state.isFileTransferring).toBe(false);
});

test("concurrent file operations keep automatic refresh paused", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let resolveFirst = (_value: Uint8Array): void => {};
  let resolveSecond = (_value: Uint8Array): void => {};
  let calls = 0;
  const first = new Promise<Uint8Array>((resolve) => (resolveFirst = resolve));
  const second = new Promise<Uint8Array>(
    (resolve) => (resolveSecond = resolve),
  );
  device.connection = {
    isConnected: true,
    downloadFileToHost: () =>
      new ResultAsync((calls++ === 0 ? first : second).then((v) => ok(v))),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const firstRead = device.brain.readFile("first");
  const secondRead = device.brain.readFile("second");
  expect(device.state.isFileTransferring).toBe(true);

  resolveFirst(new Uint8Array([1]));
  await firstRead;
  expect(device.state.isFileTransferring).toBe(true);

  resolveSecond(new Uint8Array([2]));
  await secondRead;
  expect(device.state.isFileTransferring).toBe(false);
});

test("state-changing methods wait for acknowledgement before updating state", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const loadedSlots: number[] = [];
  let stopped = false;
  device.connection = {
    isConnected: true,
    setMatchMode: () => okAsync({} as MatchModeReplyD2HPacket),
    loadProgram: (slot: number) => {
      loadedSlots.push(slot);
      return okAsync({} as LoadFileActionReplyD2HPacket);
    },
    stopProgram: () => {
      stopped = true;
      return okAsync({} as LoadFileActionReplyD2HPacket);
    },
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect((await device.setMatchMode("driver")).isOk()).toBe(true);
  expect(device.matchMode).toBe("driver");
  expect((await device.brain.setActiveProgram(2)).isOk()).toBe(true);
  expect(device.brain.activeProgram).toBe(2);
  expect(loadedSlots).toEqual([2]);
  expect((await device.brain.setActiveProgram(0)).isOk()).toBe(true);
  expect(device.brain.activeProgram).toBe(0);
  expect(stopped).toBe(true);
});

test("state-changing methods report a disconnected device", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);

  expect((await device.setMatchMode("driver")).isErr()).toBe(true);
  expect((await device.brain.setActiveProgram(1)).isErr()).toBe(true);
});

test("controller uploads restore the pit channel after upload failure", async () => {
  const channels: RadioChannelType[] = [];
  class ControllerDevice extends V5SerialDevice {
    override get isV5Controller(): boolean {
      return true;
    }

    override get radio(): V5Radio {
      return {
        changeChannel: (channel: RadioChannelType) => {
          channels.push(channel);
          return okAsync(undefined);
        },
      } as unknown as V5Radio;
    }
  }

  const device = new ControllerDevice(serial);
  devices.push(device);
  device.refresh = () => okAsync<boolean>(true);
  device.connection = {
    isConnected: true,
    getSystemStatus: () => okAsync({} as never),
    uploadProgramToDevice: () => okAsync<boolean>(false),
    close: async () => {},
  } as unknown as V5SerialConnection;

  expect(
    (
      await device.brain.uploadProgram(
        {} as ProgramIniConfig,
        new Uint8Array([1]),
        undefined,
        () => {},
      )
    ).isErr(),
  ).toBe(true);
  expect(channels).toEqual([RadioChannelType.DOWNLOAD, RadioChannelType.PIT]);
});

test("automatic refresh failures are emitted instead of left unhandled", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => errAsync(new VexIoError("refresh failed"));

  const emitted = new Promise<unknown>((resolve) => {
    device.on("error", (error) => {
      device.autoRefresh = false;
      resolve(error);
    });
  });
  expect(await emitted).toBeInstanceOf(Error);
});

test("connect opens and retains a supplied connection", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let opened = false;
  let connected = false;
  const connection = {
    get isConnected() {
      return connected;
    },
    open: () => {
      opened = true;
      connected = true;
      return okAsync("opened" as const);
    },
    query1: () => okAsync({} as never),
    on: () => {},
    close: async () => {},
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);

  expect((await device.connect(connection)).isOk()).toBe(true);
  expect(opened).toBe(true);
  expect(device.connection).toBe(connection);
});

test("explicit disconnect does not trigger automatic reconnect", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  let disconnected: (() => void) | undefined;
  let reconnects = 0;
  const connection = {
    isConnected: true,
    query1: () => okAsync({} as never),
    on: (event: string, listener: () => void) => {
      if (event === "disconnected") disconnected = listener;
    },
    close: async () => disconnected?.(),
  } as unknown as V5SerialConnection;
  device.refresh = () => okAsync<boolean>(true);
  device.reconnect = () => {
    reconnects++;
    return okAsync(undefined);
  };

  await device.connect(connection);
  await device.disconnect();
  expect(reconnects).toBe(0);
});

test("reconnect clears its guard when port discovery throws", async () => {
  class InspectableDevice extends V5SerialDevice {
    get isReconnecting() {
      return this._isReconnecting;
    }
  }
  const failingSerial = {
    getPorts: async () => {
      throw new Error("port discovery failed");
    },
  } as unknown as Serial;
  const device = new InspectableDevice(failingSerial);
  devices.push(device);

  const result = await device.reconnect(100);
  expect(result.isErr()).toBe(true);
  expect(result._unsafeUnwrapErr().message).toContain("port discovery failed");
  expect(device.isReconnecting).toBe(false);
});

describe("sleepUntil and sleepUntilAsync argument validation", () => {
  test("rejects non-positive intervals", async () => {
    let r = await sleepUntilAsync(async () => true, 10, 0);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("interval must be positive");
    r = await sleepUntil(() => true, 10, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("interval must be positive");
  });

  test("rejects negative timeouts", async () => {
    let r = await sleepUntilAsync(async () => true, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain(
      "timeout must be non-negative",
    );
    r = await sleepUntil(() => true, -1);
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain(
      "timeout must be non-negative",
    );
  });

  test("predicate exceptions reject without leaving timers behind", async () => {
    const r = await sleepUntilAsync(
      async () => {
        throw new Error("boom");
      },
      100,
      5,
    );
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("boom");
  });
});

describe("downloadFileFromInternet streaming limits", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects bodies that exceed the configured byte limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    globalThis.fetch = Object.assign(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": "16" },
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const r = await downloadFileFromInternet("https://example.test/big", {
      maxBytes: 10,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("exceeds limit");
  });

  test("accepts bodies that fit within the configured byte limit", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = Object.assign(
      async () => new Response(body, { status: 200 }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const result = await downloadFileFromInternet("https://example.test/ok", {
      maxBytes: 10,
    });
    expect(new Uint8Array(result._unsafeUnwrap())).toEqual(body);
  });

  test("rejects declared content length that exceeds the limit", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response("", {
          status: 200,
          headers: { "content-length": "1024" },
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;

    const r = await downloadFileFromInternet("https://example.test/big", {
      maxBytes: 10,
    });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().message).toContain("exceeds limit");
  });
});

function buildReply(args: {
  system?: Partial<GetSystemStatusReplyD2HPacketClass>;
  flags?: Partial<GetSystemFlagsReplyD2HPacketClass>;
  radio?: Partial<GetRadioStatusReplyD2HPacketClass>;
  devices?: Partial<GetDeviceStatusReplyD2HPacketClass>;
}) {
  return {
    getSystemStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetSystemStatusReplyD2HPacketClass.prototype),
          {
            cpu0Version: VexFirmwareVersion.allZero(),
            cpu1Version: VexFirmwareVersion.allZero(),
            systemVersion: VexFirmwareVersion.allZero(),
            uniqueId: 0,
            sysflags: [0, 0, 0, 0, 0, 0, 0],
            ...args.system,
          },
        ) as GetSystemStatusReplyD2HPacketClass,
      ),
    getSystemFlags: () =>
      okAsync(
        Object.assign(
          Object.create(GetSystemFlagsReplyD2HPacketClass.prototype),
          {
            flags: 0,
            battery: 0,
            controllerBatteryPercent: 0,
            partnerControllerBatteryPercent: 0,
            currentProgram: 0,
            ...args.flags,
          },
        ) as GetSystemFlagsReplyD2HPacketClass,
      ),
    getRadioStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetRadioStatusReplyD2HPacketClass.prototype),
          {
            device: 0,
            quality: 0,
            strength: 0,
            channel: 0,
            timeslot: 0,
            ...args.radio,
          },
        ) as GetRadioStatusReplyD2HPacketClass,
      ),
    getDeviceStatus: () =>
      okAsync(
        Object.assign(
          Object.create(GetDeviceStatusReplyD2HPacketClass.prototype),
          {
            count: 0,
            devices: [],
            ...args.devices,
          },
        ) as GetDeviceStatusReplyD2HPacketClass,
      ),
  };
}

describe("refresh snapshot safety", () => {
  test("partial refresh failure preserves the previous coherent snapshot", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    let calls = 0;
    const replies = buildReply({
      system: {
        cpu0Version: new VexFirmwareVersion(1, 2, 3, 4),
        uniqueId: 0xdeadbeef,
        sysflags: [0, 0, 0b00100000, 0, 0, 0, 0],
      },
      flags: { currentProgram: 0 },
      radio: { channel: 7 },
      devices: { count: 0, devices: [] },
    });
    device.connection = {
      isConnected: true,
      ...replies,
      getSystemStatus: () => {
        calls++;
        // second refresh fails at first call
        return calls === 2
          ? errAsync(new VexProtocolError("system status nack"))
          : replies.getSystemStatus();
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.refresh())._unsafeUnwrap()).toBe(true);
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("1.2.3.b4");
    expect(device.state.radio.channel).toBe(7);
    expect(device.state.matchMode).toBe("disabled");
    expect(device.state.brain.isAvailable).toBe(true);

    const next = await device.refresh();
    expect(next._unsafeUnwrap()).toBe(false);
    expect(device.state.brain.isAvailable).toBe(false);
    // Previous coherent snapshot is preserved.
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("1.2.3.b4");
    expect(device.state.radio.channel).toBe(7);
    expect(device.state.matchMode).toBe("disabled");
  });

  test("a generation that began before disposal does not commit state", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    let resolveStatus:
      | ((value: GetSystemStatusReplyD2HPacketClass) => void)
      | null = null;
    const gate = new Promise<GetSystemStatusReplyD2HPacketClass>((resolve) => {
      resolveStatus = resolve;
    });
    const replies = buildReply({
      system: {
        cpu0Version: new VexFirmwareVersion(9, 9, 9, 9),
      },
    });
    device.connection = {
      isConnected: true,
      ...replies,
      getSystemStatus: async () => ok(await gate),
      close: async () => {},
    } as unknown as V5SerialConnection;

    const refresh = device.refresh();
    await Bun.sleep(0);
    await device.dispose();
    (
      resolveStatus as
        | ((value: GetSystemStatusReplyD2HPacketClass) => void)
        | null
    )?.(
      Object.assign(
        Object.create(GetSystemStatusReplyD2HPacketClass.prototype),
        {
          cpu0Version: new VexFirmwareVersion(9, 9, 9, 9),
          cpu1Version: VexFirmwareVersion.allZero(),
          systemVersion: VexFirmwareVersion.allZero(),
          uniqueId: 0,
          sysflags: [0, 0, 0, 0, 0, 0, 0],
        },
      ) as GetSystemStatusReplyD2HPacketClass,
    );
    const result = await refresh;
    expect(result._unsafeUnwrap()).toBe(false);
    // The state must NOT have been committed by a generation that
    // started before the device was disposed.
    expect(device.state.brain.cpu0Version.toInternalString()).toBe("0.0.0.b0");
  });
});

describe("promise-returning program/match state", () => {
  test("setMatchMode updates state only after the device acknowledges", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    const calls: MatchMode[] = [];
    const replies: Array<MatchModeReplyD2HPacket | null> = [];
    device.connection = {
      isConnected: true,
      setMatchMode: (mode: MatchMode) => {
        calls.push(mode);
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("setMatchMode nack"))
          : okAsync(r);
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    replies.push(
      Object.create(
        MatchModeReplyD2HPacket.prototype,
      ) as MatchModeReplyD2HPacket,
    );
    expect((await device.setMatchMode("autonomous")).isOk()).toBe(true);
    expect(device.state.matchMode).toBe("autonomous");
    expect(calls).toEqual(["autonomous"]);

    // Reject path: state is not updated and the method resolves to an error.
    replies.push(null);
    expect((await device.setMatchMode("driver")).isErr()).toBe(true);
    expect(device.state.matchMode).toBe("autonomous");
  });

  test("runProgram and stopProgram return observable promises", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    const calls: Array<string | number> = [];
    const replies: Array<LoadFileActionReplyD2HPacket | null> = [
      Object.create(
        LoadFileActionReplyD2HPacket.prototype,
      ) as LoadFileActionReplyD2HPacket,
      null,
    ];
    device.connection = {
      isConnected: true,
      runProgram: (slot: string | number) => {
        calls.push(slot);
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("runProgram nack"))
          : okAsync(r);
      },
      stopProgram: () => {
        const r = replies.shift();
        return r == null
          ? errAsync(new VexProtocolError("stopProgram nack"))
          : okAsync(r);
      },
      close: async () => {},
    } as unknown as V5SerialConnection;

    expect((await device.brain.runProgram(1)).isOk()).toBe(true);
    expect(device.state.brain.activeProgram).toBe(1);
    expect(calls).toEqual([1]);

    expect((await device.brain.stopProgram()).isErr()).toBe(true);
    expect(device.state.brain.activeProgram).toBe(1);
  });

  test("setMatchMode reports a disconnected device", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: false,
      setMatchMode: () => errAsync(new VexProtocolError("setMatchMode nack")),
      close: async () => {},
    } as unknown as V5SerialConnection;
    expect((await device.setMatchMode("disabled")).isErr()).toBe(true);
  });
});

describe("firmware size limits", () => {
  function makeZip(
    entries: Array<{ name: string; data: Uint8Array }>,
  ): Uint8Array {
    // Minimal valid ZIP writer: uses CRC32 + STORED (no compression) entries,
    // followed by a central directory. Enough for unzipit to parse the
    // entries and for our size-validation code to inspect them.
    const crcTable = (() => {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++)
          c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
      return table;
    })();
    const crc32 = (data: Uint8Array) => {
      let c = 0xffffffff;
      for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

    const fileRecords: Uint8Array[] = [];
    const centralRecords: Uint8Array[] = [];
    let offset = 0;
    for (const entry of entries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const crc = crc32(entry.data);
      const local = new Uint8Array(30 + nameBytes.byteLength);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, entry.data.byteLength, true);
      view.setUint32(22, entry.data.byteLength, true);
      view.setUint16(26, nameBytes.byteLength, true);
      view.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      fileRecords.push(local, entry.data);
      const localStart = offset;
      offset += local.byteLength;
      offset += entry.data.byteLength;

      const central = new Uint8Array(46 + nameBytes.byteLength);
      const cview = new DataView(central.buffer);
      cview.setUint32(0, 0x02014b50, true);
      cview.setUint16(4, 20, true);
      cview.setUint16(6, 20, true);
      cview.setUint16(8, 0, true);
      cview.setUint16(10, 0, true);
      cview.setUint16(12, 0, true);
      cview.setUint32(16, crc, true);
      cview.setUint32(20, entry.data.byteLength, true);
      cview.setUint32(24, entry.data.byteLength, true);
      cview.setUint16(28, nameBytes.byteLength, true);
      cview.setUint16(30, 0, true);
      cview.setUint16(32, 0, true);
      cview.setUint16(34, 0, true);
      cview.setUint16(36, 0, true);
      cview.setUint32(38, 0, true);
      cview.setUint32(42, localStart, true);
      central.set(nameBytes, 46);
      centralRecords.push(central);
    }

    const centralSize = centralRecords.reduce((s, b) => s + b.byteLength, 0);
    const centralStart = offset;
    offset += centralSize;

    const end = new Uint8Array(22);
    const eview = new DataView(end.buffer);
    eview.setUint32(0, 0x06054b50, true);
    eview.setUint16(8, entries.length, true);
    eview.setUint16(10, entries.length, true);
    eview.setUint32(12, centralSize, true);
    eview.setUint32(16, centralStart, true);

    const total = offset + end.byteLength;
    const out = new Uint8Array(total);
    let p = 0;
    for (const chunk of fileRecords) {
      out.set(chunk, p);
      p += chunk.byteLength;
    }
    for (const chunk of centralRecords) {
      out.set(chunk, p);
      p += chunk.byteLength;
    }
    out.set(end, p);
    return out;
  }

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchBytes(bytes: Uint8Array) {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(new Blob([bytes as unknown as ArrayBuffer]), {
          status: 200,
        }),
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;
  }

  test("per-entry firmware image is rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    // Allocate a buffer larger than the per-entry limit (32 MB) without
    // pulling 40 MB into memory at once. The validation should reject
    // based on the declared entry size before any of the body is
    // materialised.
    const huge = new Uint8Array(33 * 1024 * 1024);
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: huge },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("per-entry limit");
  });

  test("aggregate firmware size is rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    // Two entries of 25 MB each pass the 32 MB per-entry check but
    // together exceed the 48 MB aggregate limit.
    const half = new Uint8Array(25 * 1024 * 1024);
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: half },
      { name: "1.0.0/assets.bin", data: half },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("aggregate");
  });

  test("unexpected ZIP entries are rejected before any upload", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: new Uint8Array(16) },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
      { name: "1.0.0/extra.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("unexpected entries");
  });

  test("empty firmware entries are rejected before any upload", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    const zip = makeZip([
      { name: "1.0.0/BOOT.bin", data: new Uint8Array(0) },
      { name: "1.0.0/assets.bin", data: new Uint8Array(16) },
    ]);
    mockFetchBytes(zip);
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("empty");
  });

  test("compressed VEXos archives are rejected when oversized", async () => {
    const device = new V5SerialDevice(serial);
    devices.push(device);
    device.connection = {
      isConnected: true,
      close: async () => {},
    } as unknown as V5SerialConnection;
    mockFetchBytes(new Uint8Array(200 * 1024 * 1024));
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.0.0",
    );
    expect(result.isErr()).toBe(true);
  });
});
