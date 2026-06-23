export type V5Unsubscribe = () => void;
export type V5StoreListener = () => void;

export interface V5Store<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: V5StoreListener): V5Unsubscribe;
}

export function createListenerSet(): {
  emit(): void;
  subscribe(listener: V5StoreListener): V5Unsubscribe;
} {
  const listeners = new Set<V5StoreListener>();

  return {
    emit() {
      for (const listener of listeners) listener();
    },
    subscribe(listener: V5StoreListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
