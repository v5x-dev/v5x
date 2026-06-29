import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { type V5Client, type V5Snapshot } from "../client.js";
import { V5WebError } from "../errors.js";
import { V5Provider } from "./provider.js";
import { useV5Snapshot } from "./use-v5-snapshot.js";

const window = new Window();
Object.defineProperties(globalThis, {
  document: { value: window.document },
  Event: { value: window.Event },
  HTMLElement: { value: window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { value: true },
  Node: { value: window.Node },
  window: { value: window },
});

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

test("useV5Snapshot reads updates from a provided client and unsubscribes", async () => {
  const client = createFakeClient();
  const seen: V5Snapshot[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    seen.push(useV5Snapshot());
    return null;
  }

  await act(async () => {
    root.render(
      <V5Provider client={client}>
        <Probe />
      </V5Provider>,
    );
  });

  expect(seen.at(-1)?.status).toBe("idle");
  expect(client.listenerCount()).toBe(1);

  await act(async () => {
    client.setSnapshot(createSnapshot("connected"));
  });

  expect(seen.at(-1)?.status).toBe("connected");

  await act(async () => {
    root.unmount();
  });

  expect(client.listenerCount()).toBe(0);
});
