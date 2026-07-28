declare module "bun-serialport" {
  import type { EventEmitter } from "node:events";

  export interface SerialPortOpenOptions {
    path: string;
    baudRate: number;
    autoOpen?: boolean;
    readBufferSize?: number;
    readInterval?: number;
  }

  export interface SerialPortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
    product?: string;
  }

  export class SerialPort extends EventEmitter {
    constructor(options: SerialPortOpenOptions);

    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;

    open(): Promise<void>;
    close(): Promise<void>;
    write(data: string | Uint8Array | Buffer): Promise<number>;
    pause?(): void;
    resume?(): void;
  }

  export function list(): Promise<SerialPortInfo[]>;
}
