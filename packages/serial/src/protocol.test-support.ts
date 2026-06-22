export function protocolReply<Reply extends object>(
  constructor: { prototype: Reply },
  values: Partial<Reply> = {},
): Reply {
  return Object.assign(Object.create(constructor.prototype) as Reply, values);
}

export function deferred<Value>() {
  let resolve = (_value: Value): void => {};
  let reject = (_reason?: unknown): void => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
