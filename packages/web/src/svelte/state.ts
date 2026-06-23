import { createSubscriber } from "svelte/reactivity";
import {
  createV5Client,
  type V5Client,
  type V5ConnectionStatus,
  type V5Snapshot,
} from "../client.js";

export interface V5State {
  readonly client: V5Client;
  readonly snapshot: V5Snapshot;
  readonly status: V5ConnectionStatus;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

class V5RuneState implements V5State {
  readonly client: V5Client;
  readonly #subscribe: () => void;

  constructor(client: V5Client) {
    this.client = client;
    this.#subscribe = createSubscriber((update) =>
      client.subscribe(() => update()),
    );
  }

  get snapshot(): V5Snapshot {
    this.#subscribe();
    return this.client.getSnapshot();
  }

  get status(): V5ConnectionStatus {
    return this.snapshot.status;
  }

  connect(): Promise<boolean> {
    return this.client.connect();
  }

  disconnect(): Promise<void> {
    return this.client.disconnect();
  }

  refresh(): Promise<void> {
    return this.client.refresh();
  }
}

export function createV5State(client: V5Client = createV5Client()): V5State {
  return new V5RuneState(client);
}
