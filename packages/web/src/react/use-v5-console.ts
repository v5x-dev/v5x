import { useMemo, useSyncExternalStore } from "react";
import type { V5ConsoleSnapshot } from "../console.js";
import { useV5Client } from "./provider.js";

export interface V5ConsoleBinding extends V5ConsoleSnapshot {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  clear(): void;
  send(text: string): Promise<boolean>;
}

/**
 * Subscribe to the running program's output.
 *
 * The console is its own store, so a component using this re-renders on new
 * output without pulling in every consumer of the connection snapshot.
 */
export function useV5Console(): V5ConsoleBinding {
  const client = useV5Client();
  const console = client.console;
  const snapshot = useSyncExternalStore(
    (listener) => console.subscribe(listener),
    () => console.getSnapshot(),
    () => console.getSnapshot(),
  );

  const actions = useMemo(
    () => ({
      start: () => console.start(),
      stop: () => console.stop(),
      clear: () => console.clear(),
      send: (text: string) => console.send(text),
    }),
    [console],
  );

  return { ...snapshot, ...actions };
}
