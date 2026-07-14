import { convertScreenCapture } from "../src/VexScreenCapture";

const framebuffer = new Uint8Array(512 * 272 * 4);
for (let index = 0; index < framebuffer.length; index++) {
  framebuffer[index] = index & 0xff;
}

const iterations = 250;
const startedAt = performance.now();
let checksum = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  const pixels = convertScreenCapture(framebuffer);
  checksum += pixels[iteration % pixels.length]!;
}
const elapsed = performance.now() - startedAt;

console.log(
  `screen capture conversion: ${(elapsed / iterations).toFixed(3)} ms/iteration (${checksum})`,
);
