/**
 * A bounded byte accumulator for downloads whose final length may be unknown.
 * The backing allocation is reused when it is exactly filled, avoiding the
 * full-payload concatenation allocation required by retaining stream chunks.
 */
export class DownloadBuffer {
  private storage: Uint8Array<ArrayBuffer>;
  private length = 0;

  constructor(
    initialCapacity: number,
    private readonly maxBytes: number,
  ) {
    this.storage = new Uint8Array(initialCapacity);
  }

  append(chunk: Uint8Array): boolean {
    const nextLength = this.length + chunk.byteLength;
    if (nextLength > this.maxBytes) return false;

    this.reserve(nextLength);
    this.storage.set(chunk, this.length);
    this.length = nextLength;
    return true;
  }

  finish(): ArrayBuffer {
    if (this.length === this.storage.byteLength) return this.storage.buffer;
    return this.storage.buffer.slice(0, this.length);
  }

  private reserve(required: number): void {
    if (required <= this.storage.byteLength) return;

    const doubled = Math.max(64, this.storage.byteLength * 2);
    const capacity = Math.min(this.maxBytes, Math.max(required, doubled));
    const storage = new Uint8Array(capacity);
    storage.set(this.storage.subarray(0, this.length));
    this.storage = storage;
  }
}
