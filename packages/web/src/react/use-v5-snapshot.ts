import { useSyncExternalStore } from "react";
import { type V5Snapshot } from "../client.js";
import { useV5Client } from "./provider.js";

export function useV5Snapshot(): V5Snapshot {
  const client = useV5Client();
  return useSyncExternalStore(
    (listener) => client.subscribe(listener),
    () => client.getSnapshot(),
    () => client.getSnapshot(),
  );
}
