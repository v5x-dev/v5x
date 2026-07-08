import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  createV5Client,
  type V5Client,
  type V5ClientOptions,
} from "../client.js";

const V5Context = createContext<V5Client | null>(null);

export interface V5ProviderProps {
  children: ReactNode;
  client?: V5Client;
  options?: V5ClientOptions;
}

export function V5Provider({
  children,
  client,
  options,
}: V5ProviderProps): ReactNode {
  const value = useMemo(
    () => client ?? createV5Client(options),
    [client, options?.refreshIntervalMs, options?.serial],
  );

  useEffect(() => {
    if (client !== undefined) return;
    return () => void value.disconnect();
  }, [client, value]);

  return createElement(V5Context.Provider, { value }, children);
}

export function useV5Client(): V5Client {
  const client = useContext(V5Context);
  if (client === null) {
    throw new Error("V5 hooks must be used inside V5Provider.");
  }
  return client;
}
