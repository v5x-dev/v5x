import { reportProgress } from "../src/utils/upload.js";
import {
  createTerminalJsonRenderer,
  createTerminalRenderer,
} from "../src/utils/terminal.js";

const runs = 5;
let totalMs = 0;
for (let index = 0; index < runs; index++) {
  const startedAt = performance.now();
  const processHandle = Bun.spawn(["bun", "src/index.ts", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await processHandle.exited;
  totalMs += performance.now() - startedAt;
}

const output = { writes: 0, isTTY: true };
const progress = reportProgress({
  cadenceMs: 50,
  output: {
    get isTTY() {
      return output.isTTY;
    },
    write: () => {
      output.writes++;
      return true;
    },
  },
});
const startedAt = performance.now();
for (let index = 0; index <= 100_000; index++) progress("BIN", index, 100_000);
progress.finish();
const progressMs = performance.now() - startedAt;

const timestamped = createTerminalRenderer({ timestamps: true, color: false });
const json = createTerminalJsonRenderer(() => new Date(0));
for (let index = 0; index < 10_000; index++) {
  timestamped.render(`line ${index}\n`);
  json.render(`line ${index}\n`);
}
console.log(
  `CLI cold start: ${(totalMs / runs).toFixed(1)} ms; progress: ${progressMs.toFixed(1)} ms and ${output.writes} redraws`,
);
