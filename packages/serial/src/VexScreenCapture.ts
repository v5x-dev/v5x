const SCREEN_CAPTURE_HEIGHT = 272;
const SCREEN_CAPTURE_WIDTH = 480;
const SCREEN_CAPTURE_CHANNELS = 3;
const SCREEN_CAPTURE_MESSAGE_WIDTH = 512;
const SCREEN_CAPTURE_MESSAGE_CHANNELS = 4;

export const SCREEN_CAPTURE_FRAMEBUFFER_SIZE =
  SCREEN_CAPTURE_MESSAGE_WIDTH *
  SCREEN_CAPTURE_HEIGHT *
  SCREEN_CAPTURE_MESSAGE_CHANNELS;

export function convertScreenCapture(framebuffer: Uint8Array): Uint8Array {
  if (framebuffer.length !== SCREEN_CAPTURE_FRAMEBUFFER_SIZE) {
    throw new Error(
      `bad screen capture framebuffer size: ${framebuffer.length}; expected ${SCREEN_CAPTURE_FRAMEBUFFER_SIZE}`,
    );
  }

  const pixels = new Uint8Array(
    SCREEN_CAPTURE_WIDTH * SCREEN_CAPTURE_HEIGHT * SCREEN_CAPTURE_CHANNELS,
  );

  let source = 0;
  let target = 0;
  for (let row = 0; row < SCREEN_CAPTURE_HEIGHT; row++) {
    for (let column = 0; column < SCREEN_CAPTURE_WIDTH; column++) {
      pixels[target] = framebuffer[source + 2]!;
      pixels[target + 1] = framebuffer[source + 1]!;
      pixels[target + 2] = framebuffer[source]!;
      source += SCREEN_CAPTURE_MESSAGE_CHANNELS;
      target += SCREEN_CAPTURE_CHANNELS;
    }
    source +=
      (SCREEN_CAPTURE_MESSAGE_WIDTH - SCREEN_CAPTURE_WIDTH) *
      SCREEN_CAPTURE_MESSAGE_CHANNELS;
  }

  return pixels;
}
