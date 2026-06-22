import { describe, expect, test } from "bun:test";
import { CrcGenerator } from "./VexCRC";
import { VexEventEmitter, VexEventTarget } from "./VexEvent";
import { VexFirmwareVersion } from "./VexFirmwareVersion";

describe("CrcGenerator", () => {
  const input = new TextEncoder().encode("123456789");

  test("matches standard CRC-16/CCITT-FALSE and CRC-32/MPEG-2 vectors", () => {
    const crc = new CrcGenerator();

    expect(crc.crc16(input, 0xffff)).toBe(0x29b1);
    expect(crc.crc32(input, 0xffffffff)).toBe(0x0376e6e7);
  });
});

describe("VexFirmwareVersion", () => {
  test("round-trips normal and reversed byte layouts", () => {
    const version = VexFirmwareVersion.fromString("1.2.3.b4");

    expect(version.toUint8Array()).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(version.toUint8Array(true)).toEqual(new Uint8Array([4, 3, 2, 1]));
    expect(
      VexFirmwareVersion.fromUint8Array(
        new Uint8Array([9, 4, 3, 2, 1, 9]),
        1,
        true,
      ),
    ).toEqual(version);
  });

  test("normalizes catalog versions and compares each component", () => {
    expect(
      VexFirmwareVersion.fromCatalogString("1_2_3").toInternalString(),
    ).toBe("1.2.3.b0");
    expect(
      VexFirmwareVersion.fromString("2.0.0").compare(
        VexFirmwareVersion.fromString("1.9.9"),
      ),
    ).toBeGreaterThan(0);
    expect(VexFirmwareVersion.fromString("1.2.3.b4").isBeta()).toBe(true);
    expect(VexFirmwareVersion.allZero().isBeta()).toBe(false);
  });
});

describe("VexEventEmitter", () => {
  test("registers, removes, and clears listeners", () => {
    const emitter = new VexEventEmitter();
    const values: Array<unknown> = [];
    const listener = (value: unknown) => values.push(value);

    emitter.on("update", listener);
    emitter.emit("update", 1);
    emitter.remove("update", listener);
    emitter.emit("update", 2);
    emitter.on("update", listener);
    emitter.clearListeners();
    emitter.emit("update", 3);

    expect(values).toEqual([1]);
  });

  test("normalizes symbol event names through VexEventTarget", () => {
    const target = new VexEventTarget();
    const event = Symbol("update");
    let received: unknown;

    target.on(event, (value) => {
      received = value;
    });
    target.emit(event, "ready");

    expect(received).toBe("ready");
  });
});
