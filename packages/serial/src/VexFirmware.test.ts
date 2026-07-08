import { afterEach, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { okAsync } from "neverthrow";
import { V5SerialDevice } from "./VexDevice";
import { V5SerialConnection } from "./VexConnection";
import {
  FactoryEnableReplyD2HPacket,
  FactoryStatusReplyD2HPacket,
} from "./VexPacketModels";
import { protocolReply } from "./protocol.test-support";

const serial = { getPorts: async () => [] } as unknown as Serial;
const devices: V5SerialDevice[] = [];

afterEach(async () => {
  await Promise.all(devices.splice(0).map((device) => device.dispose()));
});

test("firmware upload validates an archive and uploads both images", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const uploadedTargets: number[] = [];
  const progressStates: string[] = [];
  const factoryReply = protocolReply(FactoryEnableReplyD2HPacket);
  const finishedReply = protocolReply(FactoryStatusReplyD2HPacket, {
    status: 0,
    percent: 100,
  });
  let replyIndex = 0;
  const uploadFile = (
    request: {
      downloadTarget: number;
    },
    progress?: Parameters<V5SerialConnection["uploadFileToDevice"]>[1],
  ): ReturnType<V5SerialConnection["uploadFileToDevice"]> => {
    uploadedTargets.push(request.downloadTarget);
    progress?.(1, 1);
    return okAsync<boolean>(true);
  };
  device.connection = {
    isConnected: true,
    request: () =>
      okAsync(
        [factoryReply, finishedReply, factoryReply, finishedReply][
          replyIndex++
        ],
      ),
    uploadFileToDevice: uploadFile,
    close: async () => {},
  } as unknown as V5SerialConnection;

  const archive = zipSync({
    "1.2.3/BOOT.bin": new Uint8Array([1, 2]),
    "1.2.3/assets.bin": new Uint8Array([3, 4]),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => new Response(archive), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.2.3",
      (state) => progressStates.push(state),
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
    expect(uploadedTargets).toHaveLength(2);
    expect(progressStates).toContain("FACTORY ENB ASSETS");
    expect(progressStates).toContain("UPLOAD ASSETS");
    expect(progressStates.some((state) => state.includes("ASSERT"))).toBe(
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("firmware upload reports which factory image upload was rejected", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  const factoryReply = protocolReply(FactoryEnableReplyD2HPacket);
  const finishedReply = protocolReply(FactoryStatusReplyD2HPacket, {
    status: 0,
    percent: 100,
  });
  let replyIndex = 0;
  let uploadIndex = 0;
  device.connection = {
    isConnected: true,
    request: () =>
      okAsync([factoryReply, finishedReply, factoryReply][replyIndex++]),
    uploadFileToDevice: (): ReturnType<
      V5SerialConnection["uploadFileToDevice"]
    > => okAsync<boolean>(uploadIndex++ === 0),
    close: async () => {},
  } as unknown as V5SerialConnection;

  const archive = zipSync({
    "1.2.3/BOOT.bin": new Uint8Array([1, 2]),
    "1.2.3/assets.bin": new Uint8Array([3, 4]),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => new Response(archive), {
    preconnect: originalFetch.preconnect,
  });

  try {
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.2.3",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("ASSETS upload");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("firmware downloads reject declared oversized responses before reading", async () => {
  const device = new V5SerialDevice(serial);
  devices.push(device);
  device.connection = {
    isConnected: true,
    close: async () => {},
  } as unknown as V5SerialConnection;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-length": String(65 * 1024 * 1024) },
      }),
    { preconnect: originalFetch.preconnect },
  );

  try {
    const result = await device.brain.uploadFirmware(
      "https://example.test/",
      "1.2.3",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("exceeds");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
