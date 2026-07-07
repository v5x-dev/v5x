import { useMemo, useSyncExternalStore } from "react";
import { type V5Snapshot } from "../client.js";
import { useV5Client } from "./provider.js";

export function useV5Snapshot(): V5Snapshot {
  const client = useV5Client();
  const getSnapshot = useMemo(() => {
    let snapshot = client.getSnapshot();

    return () => {
      const nextSnapshot = client.getSnapshot();
      if (isSameSnapshot(snapshot, nextSnapshot)) return snapshot;
      snapshot = nextSnapshot;
      return snapshot;
    };
  }, [client]);

  return useSyncExternalStore(
    (listener) => client.subscribe(listener),
    getSnapshot,
    getSnapshot,
  );
}

function isSameSnapshot(left: V5Snapshot, right: V5Snapshot): boolean {
  return (
    left.status === right.status &&
    left.supported === right.supported &&
    left.unavailableReason === right.unavailableReason &&
    left.connected === right.connected &&
    left.connecting === right.connecting &&
    left.disconnecting === right.disconnecting &&
    left.error === right.error &&
    left.device === right.device &&
    left.deviceVersion === right.deviceVersion
  );
}
