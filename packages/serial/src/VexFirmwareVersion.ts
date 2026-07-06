export class VexFirmwareVersion {
  constructor(
    readonly major: number,
    readonly minor: number,
    readonly build: number,
    readonly beta: number,
  ) {}

  static fromString(version: string): VexFirmwareVersion {
    const parts = version
      .toLowerCase()
      .replace(/b/g, "")
      .split(".")
      .map((x) => parseInt(x, 10));
    while (parts.length < 4) parts.push(0);
    return new VexFirmwareVersion(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  }

  static fromUint8Array(
    data: Uint8Array,
    offset: number = 0,
    reverse: boolean = false,
  ): VexFirmwareVersion {
    return new VexFirmwareVersion(
      data[offset + (reverse ? 3 : 0)]!,
      data[offset + (reverse ? 2 : 1)]!,
      data[offset + (reverse ? 1 : 2)]!,
      data[offset + (reverse ? 0 : 3)]!,
    );
  }

  static allZero(): VexFirmwareVersion {
    return new VexFirmwareVersion(0, 0, 0, 0);
  }

  static fromCatalogString(version: string): VexFirmwareVersion {
    return VexFirmwareVersion.fromString(version.replace(/_/g, "."));
  }

  isBeta(): boolean {
    return this.beta !== 0;
  }

  toUint8Array(reverse: boolean = false): Uint8Array {
    const data = new Uint8Array(4);
    data[reverse ? 3 : 0] = this.major;
    data[reverse ? 2 : 1] = this.minor;
    data[reverse ? 1 : 2] = this.build;
    data[reverse ? 0 : 3] = this.beta;
    return data;
  }

  toUserString(): string {
    return `${this.major}.${this.minor}.${this.build}`;
  }

  toInternalString(): string {
    return `${this.toUserString()}.b${this.beta}`;
  }

  compare(that: VexFirmwareVersion): number {
    for (const [a, b] of [
      [this.major, that.major],
      [this.minor, that.minor],
      [this.build, that.build],
      [this.beta, that.beta],
    ] as const) {
      const delta = a - b;
      if (delta !== 0) return delta;
    }
    return 0;
  }
}
