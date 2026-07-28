import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { V5ConsoleSnapshot } from "../console.js";
import { useV5Client } from "./provider.jsx";

export interface V5ConsoleActions {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  clear(): void;
  send(text: string): Promise<boolean>;
}

export interface V5ConsoleBinding extends V5ConsoleActions {
  snapshot: Accessor<V5ConsoleSnapshot>;
}

/** Track the running program's output as a signal. */
export function createV5Console(): V5ConsoleBinding {
  const client = useV5Client();
  const console = client.console;
  const [snapshot, setSnapshot] = createSignal(console.getSnapshot());
  const unsubscribe = console.subscribe(() => {
    setSnapshot(() => console.getSnapshot());
  });

  onCleanup(unsubscribe);

  return {
    snapshot,
    start: () => console.start(),
    stop: () => console.stop(),
    clear: () => console.clear(),
    send: (text: string) => console.send(text),
  };
}
