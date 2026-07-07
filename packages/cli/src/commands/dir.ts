import type { Sade } from "sade";
import type { FileVendor, IFileHandle, VexSerialError } from "@v5x/serial";
import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { VENDOR_PREFIXES, VENDORS } from "../utils/brainPath";
import {
  formatSerialFailure,
  printJson,
  renderTable,
  utcTimestamp,
} from "../utils/output";

type FileRow = {
  vendor: FileVendor;
  filename: string;
  size: number;
  loadAddress: number;
  timestamp: number;
  crc32: number;
};

type VendorListFailure = {
  vendor: FileVendor;
  vendorPrefix: string;
  message: string;
};

function vendorPrefix(vendor: FileVendor): string {
  return VENDOR_PREFIXES[vendor] ?? "";
}

export function formatFileTimestamp(timestamp: number): string {
  return utcTimestamp.format(new Date(timestamp * 1000));
}

export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function formatFileRows(files: FileRow[]): string[][] {
  return files.map(
    ({ vendor, filename, size, loadAddress, timestamp, crc32 }) => [
      vendorPrefix(vendor) + filename,
      formatFileSize(size),
      `0x${loadAddress.toString(16)}`,
      formatFileTimestamp(timestamp),
      `0x${crc32.toString(16)}`,
    ],
  );
}

export function toFileJson(files: FileRow[]) {
  return files.map(
    ({ vendor, filename, size, loadAddress, timestamp, crc32 }) => ({
      vendor,
      vendorPrefix: vendorPrefix(vendor).replace("/", ""),
      filename,
      path: vendorPrefix(vendor) + filename,
      size,
      loadAddress,
      timestamp,
      timestampIso: new Date(timestamp * 1000).toISOString(),
      crc32,
    }),
  );
}

export function formatVendorListFailure(
  vendor: FileVendor,
  error: VexSerialError,
): VendorListFailure {
  return {
    vendor,
    vendorPrefix: vendorPrefix(vendor).replace("/", ""),
    message: formatSerialFailure(
      `failed to list ${vendorPrefix(vendor)} files`,
      error,
    ),
  };
}

export function toDirectoryJson(files: FileRow[], errors: VendorListFailure[]) {
  return {
    files: toFileJson(files),
    errors,
  };
}

export default function registerDirCommand(program: Sade) {
  program
    .command("dir", "list files on flash", { alias: "ls" })
    .option("--json", "print machine-readable JSON")
    .option("--port", "serial port path or id, defaults to V5X_PORT")
    .action(async (options: { json?: boolean } & PortSelectionOptions) => {
      await withSelectedV5Device(options, async (device) => {
        const files: (FileRow & IFileHandle)[] = [];
        const errors: VendorListFailure[] = [];
        for (const vendor of VENDORS) {
          const result = await device.brain.listFiles(vendor);
          if (result.isOk())
            files.push(...result.value.map((file) => ({ ...file, vendor })));
          else errors.push(formatVendorListFailure(vendor, result.error));
        }
        if (options.json === true) printJson(toDirectoryJson(files, errors));
        else {
          for (const error of errors)
            process.stderr.write(`warning: ${error.message}\n`);
          console.log(
            renderTable(
              ["name", "size", "load address", "timestamp", "crc32"],
              formatFileRows(files),
            ),
          );
        }
      });
    });
}
