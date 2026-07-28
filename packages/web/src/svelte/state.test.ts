import { expect, test } from "bun:test";
import { type V5Client, type V5Snapshot } from "../client.js";
import { createV5Console } from "../console.js";
import { V5WebError } from "../errors.js";
import { createV5State } from "./state.js";

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
    // The console is a real store over an absent device: idle, never streaming.
    console: createV5Console(() => null),
    setSnapshot(nextSnapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}

test("createV5State exposes rune-friendly snapshot getters", () => {
  const client = createFakeClient();
  const state = createV5State(client);

  expect(state.status).toBe("idle");
  expect(state.snapshot.connected).toBe(false);

  client.setSnapshot(createSnapshot("connected"));

  expect(state.status).toBe("connected");
  expect(state.snapshot.connected).toBe(true);
});
