import { describe, expect, test } from "bun:test";
import { AckType } from "./Vex";
import { type HostBoundPacket } from "./VexPacket";
import { PacketView } from "./VexPacketView";

describe("PacketView", () => {
  test("reads firmware versions relative to its byte offset", () => {
    const bytes = new Uint8Array([99, 99, 1, 2, 3, 4, 99]);
    const view = new PacketView(bytes.buffer, 2, 4);

    const version = view.nextVersion();
    expect([version.major, version.minor, version.build, version.beta]).toEqual(
      [1, 2, 3, 4],
    );
  });

  test("decodes fixed and null-terminated strings as UTF-8", () => {
    const bytes = new TextEncoder().encode("pré\0arm");
    const view = new PacketView(bytes.buffer);

    expect(view.nextVarNTBS(bytes.byteLength)).toBe("pré");
    expect(view.position).toBe(5);
    expect(view.nextString(3)).toBe("arm");
  });

  test("bounds packet views to a subarray's byte length", () => {
    const backing = Uint8Array.of(99, 99, 0, 42, 7, 8);
    const data = backing.subarray(2, 4);
    const packet = {
      data,
      ack: AckType.CDC2_ACK,
      ackIndex: 0,
      payloadSize: 1,
    } as HostBoundPacket;

    const view = PacketView.fromPacket(packet);

    expect(view.byteOffset).toBe(2);
    expect(view.byteLength).toBe(2);
    expect(view.nextUint8()).toBe(42);
    expect(() => view.nextUint8()).toThrow(RangeError);
  });
});
