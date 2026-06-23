import { expect, test } from "bun:test";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { type V5Client, type V5Snapshot } from "../client.js";
import { V5WebError } from "../errors.js";
import { V5Provider } from "./provider.js";
import { useV5Snapshot } from "./use-v5-snapshot.js";

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

test("useV5Snapshot reads the current snapshot from a provided client", () => {
  const client = createFakeClient();
  const seen: V5Snapshot[] = [];
  let renderer: ReactTestRenderer | undefined;

  function Probe() {
    seen.push(useV5Snapshot());
    return null;
  }

  act(() => {
    renderer = create(
      <V5Provider client={client}>
        <Probe />
      </V5Provider>,
    );
  });

  expect(seen.at(-1)?.status).toBe("idle");

  act(() => {
    client.setSnapshot(createSnapshot("connected"));
  });

  expect(seen.at(-1)?.status).toBe("connected");

  act(() => {
    renderer?.unmount();
  });
});
