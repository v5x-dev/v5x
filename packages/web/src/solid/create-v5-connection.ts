import { useV5Client } from "./provider.jsx";

export interface V5ConnectionActions {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export function createV5Connection(): V5ConnectionActions {
  const client = useV5Client();

  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    refresh: () => client.refresh(),
  };
}
