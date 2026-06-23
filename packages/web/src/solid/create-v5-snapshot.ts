import { createSignal, onCleanup, type Accessor } from "solid-js";
import { type V5Snapshot } from "../client.js";
import { useV5Client } from "./provider.jsx";

export function createV5Snapshot(): Accessor<V5Snapshot> {
  const client = useV5Client();
  const [snapshot, setSnapshot] = createSignal(client.getSnapshot());
  const unsubscribe = client.subscribe(() => {
    setSnapshot(() => client.getSnapshot());
  });

  onCleanup(unsubscribe);

  return snapshot;
}
