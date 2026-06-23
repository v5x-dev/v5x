import { expect, test } from "bun:test";
import { type V5Client, type V5Snapshot } from "../client.js";
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
