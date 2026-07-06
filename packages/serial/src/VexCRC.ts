const POLYNOMIAL_CRC32 = 0x04c11db7;
const POLYNOMIAL_CRC16 = 0x1021;

function genTable16(): Uint16Array {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let acc = i << 8;
    for (let j = 0; j < 8; j++) {
      acc = (acc & 0x8000) !== 0 ? (acc << 1) ^ POLYNOMIAL_CRC16 : acc << 1;
    }
    table[i] = acc & 0xffff;
  }
  return table;
}

function genTable32(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let acc = i << 24;
    for (let j = 0; j < 8; j++) {
      acc = (acc & 0x80000000) !== 0 ? (acc << 1) ^ POLYNOMIAL_CRC32 : acc << 1;
    }
    table[i] = acc;
  }
  return table;
}

const CRC16_TABLE = genTable16();
const CRC32_TABLE = genTable32();

export class CrcGenerator {
  crc32Table: Uint32Array = CRC32_TABLE;
  static POLYNOMIAL_CRC32 = POLYNOMIAL_CRC32;
  static POLYNOMIAL_CRC16 = POLYNOMIAL_CRC16;

  crc16(buf: Uint8Array, initValue: number): number {
    let acc = initValue;
    for (let j = 0; j < buf.length; j++) {
      acc = ((acc << 8) ^ CRC16_TABLE[((acc >>> 8) ^ buf[j]!) & 0xff]!) >>> 0;
    }
    return acc & 0xffff;
  }

  crc32(buf: Uint8Array, initValue: number): number {
    let acc = initValue;
    for (let j = 0; j < buf.length; j++) {
      acc = ((acc << 8) ^ CRC32_TABLE[((acc >>> 24) ^ buf[j]!) & 0xff]!) >>> 0;
    }
    return acc >>> 0;
  }
}
