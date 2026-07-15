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

  test("does not retain empty string or symbol listener buckets", () => {
    const emitter = new VexEventEmitter();
    const listener = () => {};
    const symbolEvent = Symbol("update");

    emitter.remove("unknown", listener);
    expect(emitter.handlerMap.has("unknown")).toBe(false);

    emitter.on(symbolEvent, listener);
    emitter.remove(symbolEvent, listener);
    expect(emitter.handlerMap.has(symbolEvent)).toBe(false);
  });

  test("removing one listener preserves the others in order", () => {
    const emitter = new VexEventEmitter<{ update: number }>();
    const values: string[] = [];
    const first = (value: number) => values.push(`first:${value}`);
    const removed = (value: number) => values.push(`removed:${value}`);
    const last = (value: number) => values.push(`last:${value}`);
    emitter.on("update", first);
    emitter.on("update", removed);
    emitter.on("update", last);

    emitter.remove("update", removed);
    emitter.emit("update", 1);

    expect(values).toEqual(["first:1", "last:1"]);
    expect(emitter.handlerMap.get("update")).toHaveLength(2);
  });

  test("continues emitting after a listener throws", () => {
    const emitter = new VexEventEmitter<{ update: number }>();
    const values: number[] = [];

    emitter.on("update", () => {
      throw new Error("listener failed");
    });
    emitter.on("update", (value) => {
      values.push(value);
    });

    expect(() => emitter.emit("update", 7)).toThrow("listener failed");
    expect(values).toEqual([7]);
  });

  test("snapshots multiple listeners during emission", () => {
    const emitter = new VexEventEmitter<{ update: number }>();
    const values: string[] = [];
    const removed = (value: number) => values.push(`removed:${value}`);
    const added = (value: number) => values.push(`added:${value}`);

    emitter.on("update", (value) => {
      values.push(`first:${value}`);
      emitter.remove("update", removed);
      emitter.on("update", added);
    });
    emitter.on("update", removed);

    emitter.emit("update", 1);
    emitter.emit("update", 2);

    expect(values).toEqual(["first:1", "removed:1", "first:2", "added:2"]);
  });

  test("preserves single and aggregate listener errors", () => {
    const emitter = new VexEventEmitter<{ update: undefined }>();
    const first = new Error("first");
    const second = new Error("second");
    emitter.on("update", () => {
      throw first;
    });

    expect(() => emitter.emit("update", undefined)).toThrow(first);

    emitter.on("update", () => {
      throw second;
    });
    try {
      emitter.emit("update", undefined);
      throw new Error("expected emit to throw");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([first, second]);
    }
  });

  test("preserves symbol event names through VexEventTarget", () => {
    const target = new VexEventTarget();
    const event = Symbol("update");
    let received: unknown;

    target.on(event, (value) => {
      received = value;
    });
    target.emit(event, "ready");

    expect(received).toBe("ready");
  });

  test("keeps distinct symbols with the same description separate", () => {
    const target = new VexEventTarget();
    const first = Symbol("update");
    const second = Symbol("update");
    const values: string[] = [];

    target.on(first, () => values.push("first"));
    target.on(second, () => values.push("second"));
    target.emit(first, undefined);

    expect(values).toEqual(["first"]);
  });
});
