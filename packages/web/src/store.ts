export type V5Unsubscribe = () => void;
export type V5StoreListener = () => void;

export interface V5Store<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: V5StoreListener): V5Unsubscribe;
}

export function createListenerSet() {
  const listeners = new Set<V5StoreListener>();

  return {
    emit(): void {
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          // Subscribers observe state changes and must not affect the client
          // lifecycle or prevent the remaining subscribers from running.
        }
      }
    },
    subscribe(listener: V5StoreListener): V5Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
