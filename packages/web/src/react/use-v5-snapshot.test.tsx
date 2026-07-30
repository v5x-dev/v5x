import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as clientModule from "../client.js";
import {
  type V5Client,
  type V5ClientOptions,
  type V5Snapshot,
} from "../client.js";
import { createV5Console } from "../console.js";
import { V5WebError } from "../errors.js";
import { V5Provider, useV5Client } from "./provider.js";
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
    // The console is a real store over an absent device: idle, never streaming.
    console: createV5Console(() => null),
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

test("V5Provider keeps an owned client stable for equivalent inline options", async () => {
  const seen: V5Client[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    seen.push(useV5ClientForTest());
    return null;
  }

  await act(async () => {
    root.render(
      <V5Provider options={{ refreshIntervalMs: 500 }}>
        <Probe />
      </V5Provider>,
    );
  });
  await act(async () => {
    root.render(
      <V5Provider options={{ refreshIntervalMs: 500 }}>
        <Probe />
      </V5Provider>,
    );
  });
  await act(async () => {
    root.unmount();
  });

  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);
});

test("V5Provider creates one owned client under Strict Mode double invocation", async () => {
  const createSpy = spyOn(clientModule, "createV5Client");
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    useV5Client();
    return null;
  }

  try {
    await act(async () => {
      root.render(
        <StrictMode>
          <V5Provider>
            <Probe />
          </V5Provider>
        </StrictMode>,
      );
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    createSpy.mockRestore();
  }
});

function useV5ClientForTest(): V5Client {
  return useV5Client();
}

function countingClient(disconnects: { count: number }): V5Client {
  return {
    ...createFakeClient(),
    disconnect: async () => {
      disconnects.count++;
    },
  };
}

/**
 * Render the provider once per entry in `optionSets`, collecting the owned
 * client each render produced along with how often clients were disconnected.
 */
async function renderOwnedProvider(
  optionSets: (V5ClientOptions | undefined)[],
): Promise<{ seen: V5Client[]; disconnects: { count: number } }> {
  const disconnects = { count: 0 };
  const createSpy = spyOn(clientModule, "createV5Client").mockImplementation(
    () => countingClient(disconnects),
  );
  const seen: V5Client[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    seen.push(useV5ClientForTest());
    return null;
  }

  try {
    for (const options of optionSets) {
      await act(async () => {
        root.render(
          <V5Provider options={options}>
            <Probe />
          </V5Provider>,
        );
      });
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
    createSpy.mockRestore();
  }
  return { seen, disconnects };
}

test.each([
  ["maxCharacters", { maxCharacters: 10 }, { maxCharacters: 20 }],
  [
    "terminal.idlePollIntervalMs",
    { terminal: { idlePollIntervalMs: 10 } },
    { terminal: { idlePollIntervalMs: 20 } },
  ],
  [
    "terminal.timeoutMs",
    { terminal: { timeoutMs: 10 } },
    { terminal: { timeoutMs: 20 } },
  ],
  [
    "terminal.maxConsecutiveErrors",
    { terminal: { maxConsecutiveErrors: 1 } },
    { terminal: { maxConsecutiveErrors: 2 } },
  ],
])(
  "V5Provider replaces an owned client when console %s changes",
  async (_, first, second) => {
    const { seen, disconnects } = await renderOwnedProvider([
      { console: first },
      { console: second },
    ]);

    expect(seen[0]).not.toBe(seen[1]);
    // Once for the replaced client, once for the survivor at unmount.
    expect(disconnects.count).toBe(2);
  },
);

test("V5Provider keeps an owned client stable for equivalent console options", async () => {
  const { seen, disconnects } = await renderOwnedProvider([
    { refreshIntervalMs: 500, console: { maxCharacters: 10, terminal: {} } },
    { refreshIntervalMs: 500, console: { maxCharacters: 10, terminal: {} } },
  ]);

  expect(seen[0]).toBe(seen[1]);
  expect(disconnects.count).toBe(1);
});

test("V5Provider still replaces an owned client when the serial adapter changes", async () => {
  const first = {} as Serial;
  const second = {} as Serial;
  const { seen } = await renderOwnedProvider([
    { serial: first },
    { serial: second },
  ]);

  expect(seen[0]).not.toBe(seen[1]);
});

test("V5Provider never recreates or disconnects an external client", async () => {
  let disconnects = 0;
  const client: V5Client = {
    ...createFakeClient(),
    disconnect: async () => {
      disconnects++;
    },
  };
  const createSpy = spyOn(clientModule, "createV5Client");
  const seen: V5Client[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);

  function Probe() {
    seen.push(useV5ClientForTest());
    return null;
  }

  try {
    for (const maxCharacters of [10, 20]) {
      await act(async () => {
        root.render(
          <V5Provider client={client} options={{ console: { maxCharacters } }}>
            <Probe />
          </V5Provider>,
        );
      });
    }
  } finally {
    await act(async () => {
      root.unmount();
    });
    createSpy.mockRestore();
  }

  expect(seen).toEqual([client, client]);
  expect(createSpy).not.toHaveBeenCalled();
  expect(disconnects).toBe(0);
});
