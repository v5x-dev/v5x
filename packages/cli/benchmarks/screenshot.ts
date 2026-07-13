import { encodeScreenshotPng } from "../src/commands/screenshot";

const pixels = new Uint8Array(480 * 272 * 3);
for (let index = 0; index < pixels.length; index++) {
  pixels[index] = index & 0xff;
}

const iterations = 50;
const startedAt = performance.now();
let checksum = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  const png = encodeScreenshotPng(pixels);
  checksum += png[iteration % png.length]!;
}
const elapsed = performance.now() - startedAt;

console.log(
  `PNG screenshot encoding: ${(elapsed / iterations).toFixed(3)} ms/iteration (${checksum})`,
);
