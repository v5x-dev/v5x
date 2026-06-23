import { createComponent, createContext, useContext, type JSX } from "solid-js";
import {
  createV5Client,
  type V5Client,
  type V5ClientOptions,
} from "../client.js";

const V5Context = createContext<V5Client>();

export interface V5ProviderProps {
  children: JSX.Element;
  client?: V5Client;
  options?: V5ClientOptions;
}

export function V5Provider(props: V5ProviderProps): JSX.Element {
  const client = props.client ?? createV5Client(props.options);

  return createComponent(V5Context.Provider, {
    value: client,
    get children() {
      return props.children;
    },
  });
}

export function useV5Client(): V5Client {
  const client = useContext(V5Context);
  if (client === undefined) {
    throw new Error("V5 helpers must be used inside V5Provider.");
  }
  return client;
}
