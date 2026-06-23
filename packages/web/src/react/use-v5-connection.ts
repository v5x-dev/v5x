import { useMemo } from "react";
import { useV5Client } from "./provider.js";

export interface V5ConnectionActions {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export function useV5Connection(): V5ConnectionActions {
  const client = useV5Client();

  return useMemo(
    () => ({
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
      refresh: () => client.refresh(),
    }),
    [client],
  );
}
