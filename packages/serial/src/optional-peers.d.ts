declare module "bun-serialport" {
  export const SerialPort: any;
  export function list(): Promise<any[]>;
}

declare module "serialport" {
  export const SerialPort: any;
}
