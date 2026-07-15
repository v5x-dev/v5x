/**
 * A growable receive queue. Parsed packets are copied out before their bytes
 * are discarded, so views into this reusable storage never escape the reader.
 */
export class ReceiveBuffer {
  private storage: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private start = 0;
  private end = 0;

  get byteLength(): number {
    return this.end - this.start;
  }

  get bytes(): Uint8Array<ArrayBuffer> {
    return this.storage.subarray(this.start, this.end);
  }

  append(chunk: Uint8Array): void {
    this.reserve(chunk.byteLength);
    this.storage.set(chunk, this.end);
    this.end += chunk.byteLength;
  }

  copy(length: number): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, length);
  }

  discard(length: number): void {
    this.start += length < 0 ? this.byteLength + length : length;
    if (this.start < 0) this.start = 0;
    if (this.start > this.end) this.start = this.end;
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
    } else if (this.start >= 4096 && this.start * 2 >= this.storage.length) {
      this.storage.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
  }

  private reserve(additional: number): void {
    const required = this.byteLength + additional;
    if (this.storage.length - this.end >= additional) return;

    if (this.storage.length >= required) {
      this.storage.copyWithin(0, this.start, this.end);
      this.end = this.byteLength;
      this.start = 0;
      return;
    }

    const storage: Uint8Array<ArrayBuffer> = new Uint8Array(
      Math.max(required, Math.max(64, this.storage.length * 2)),
    );
    storage.set(this.bytes);
    this.end = this.byteLength;
    this.start = 0;
    this.storage = storage;
  }
}
