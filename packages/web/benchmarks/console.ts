import { okAsync } from "neverthrow";
import { createV5Console } from "../src/console.js";

class FakeTerminal {
  private readonly listeners = new Set<(text: string) => void>();

  on(event: string, listener: (text: string) => void): void {
    if (event === "text") this.listeners.add(listener);
  }

  remove(event: string, listener: (text: string) => void): void {
    if (event === "text") this.listeners.delete(listener);
  }

  write() {
    return okAsync(0);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  print(text: string): void {
    for (const listener of this.listeners) listener(text);
  }
}

const terminal = new FakeTerminal();
const consoleStore = createV5Console(
  () =>
    ({
      openTerminal: () => ({ isErr: () => false, value: terminal }),
    }) as never,
  { maxCharacters: 100_000, snapshotPublicationIntervalMs: 16 },
);
let publications = 0;
consoleStore.subscribe(() => publications++);
await consoleStore.start();

const startedAt = performance.now();
for (let index = 0; index < 50_000; index++) terminal.print(`line ${index}\n`);
await Bun.sleep(25);
const elapsed = performance.now() - startedAt;
const snapshot = consoleStore.getSnapshot();
console.log(
  `console output: ${(50_000 / (elapsed / 1_000)).toFixed(0)} chunks/s, ${publications} publications, ${snapshot.text.length} retained chars`,
);
