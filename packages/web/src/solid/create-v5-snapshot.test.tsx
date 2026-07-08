import { expect, test } from "bun:test";
import { createComponent, createRoot, type Accessor } from "solid-js";
import { type V5Client, type V5Snapshot } from "../client.js";
import { V5WebError } from "../errors.js";
import { V5Provider } from "./provider.jsx";
import { createV5Snapshot } from "./create-v5-snapshot.js";

function createSnapshot(status: V5Snapshot["status"]): V5Snapshot {
  return {
    status,
    supported: true,
    unavailableReason: null,
    connected: status === "connected",
    connecting: status === "connecting",
    disconnecting: status === "disconnecting",
    error:
      status === "error"
        ? new V5WebError("connect-error", "connect failed")
        : null,
    device: null,
    deviceVersion: 0,
  };
}

function createFakeClient(): V5Client & {
  listenerCount(): number;
  setSnapshot(snapshot: V5Snapshot): void;
} {
  const listeners = new Set<() => void>();
  let snapshot = createSnapshot("idle");

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect: async () => true,
    disconnect: async () => {},
    refresh: async () => {},
    listenerCount: () => listeners.size,
    setSnapshot(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}

test("createV5Snapshot mirrors updates and unsubscribes on cleanup", () => {
  const client = createFakeClient();
  let snapshot: Accessor<V5Snapshot> | undefined;
  const dispose = createRoot((rootDispose) => {
    const Probe = () => {
      snapshot = createV5Snapshot();
      return null;
    };

    createComponent(V5Provider, {
      client,
      get children() {
        return createComponent(Probe, {});
      },
    });

    return rootDispose;
  });

  expect(snapshot?.().status).toBe("idle");
  expect(client.listenerCount()).toBe(1);

  client.setSnapshot(createSnapshot("connected"));

  expect(snapshot?.().status).toBe("connected");

  dispose();

  expect(client.listenerCount()).toBe(0);
});

test("V5Provider disconnects a provided client only when it owns it", () => {
  let disconnects = 0;
  const client = {
    ...createFakeClient(),
    disconnect: async () => {
      disconnects++;
    },
  };

  const dispose = createRoot((rootDispose) => {
    createComponent(V5Provider, {
      client,
      children: null,
    });

    return rootDispose;
  });

  dispose();

  expect(disconnects).toBe(0);
});
