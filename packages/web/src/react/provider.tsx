import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
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

interface OwnedClient {
  client: V5Client;
  key: string;
  serial: V5ClientOptions["serial"];
}

/**
 * The value-comparable part of the options a client reads once, at
 * construction. Console settings belong here too: a client cannot be
 * reconfigured afterwards, so a provider that reused its client would
 * silently keep serving the console options from the first render.
 *
 * Options are usually written as an inline object literal, so this compares
 * the effective values rather than object identity. `serial` is compared
 * separately by identity because it is a live Web Serial object.
 */
function ownedClientKey(options: V5ClientOptions | undefined): string {
  const consoleOptions = options?.console;
  const terminal = consoleOptions?.terminal;
  return JSON.stringify([
    options?.refreshIntervalMs ?? null,
    consoleOptions?.maxCharacters ?? null,
    terminal?.idlePollIntervalMs ?? null,
    terminal?.timeoutMs ?? null,
    terminal?.maxConsecutiveErrors ?? null,
  ]);
}

export function V5Provider({
  children,
  client,
  options,
}: V5ProviderProps): ReactNode {
  // Lazily create the owned client into a ref rather than during render.
  // A ref persists across Strict Mode's double render invocation, so only
  // one client is ever constructed for a given set of options; a fresh
  // useMemo/render call would build (and leak) a throwaway on the extra pass.
  const owned = useRef<OwnedClient | null>(null);
  let value: V5Client;
  if (client !== undefined) {
    value = client;
  } else {
    const key = ownedClientKey(options);
    if (
      owned.current === null ||
      owned.current.key !== key ||
      owned.current.serial !== options?.serial
    ) {
      owned.current = {
        client: createV5Client(options),
        key,
        serial: options?.serial,
      };
    }
    value = owned.current.client;
  }

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
