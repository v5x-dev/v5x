import { expect, test } from "bun:test";
import { type IPacketCallback } from "./Vex";
import { PendingRequestDispatcher } from "./PendingRequestDispatcher";

function callback(
  commandId: number | undefined,
  commandExtendedId: number | undefined,
): IPacketCallback {
  return {
    callback: () => {},
    timeout: setTimeout(() => {}, 10_000),
    wantedCommandId: commandId,
    wantedCommandExId: commandExtendedId,
  };
}

test("removing a drained callback cannot delete a new command queue", () => {
  const dispatcher = new PendingRequestDispatcher();
  const removeDrained = dispatcher.add(callback(88, 0x12));

  expect(dispatcher.drain()).toHaveLength(1);
  const current = callback(88, 0x12);
  dispatcher.add(current);

  expect(removeDrained()).toBe(false);
  expect(dispatcher.shift(88, 0x12)?.timeout).toBe(current.timeout);
  clearTimeout(current.timeout);
});

test("drain also deactivates raw callbacks", () => {
  const dispatcher = new PendingRequestDispatcher();
  const removeDrained = dispatcher.add(callback(undefined, undefined));

  dispatcher.drain();
  const current = callback(undefined, undefined);
  dispatcher.add(current);

  expect(removeDrained()).toBe(false);
  expect(dispatcher.shift(1, undefined)?.timeout).toBe(current.timeout);
  clearTimeout(current.timeout);
});
