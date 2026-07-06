import { FileVendor, type IFileBasicInfo } from "@v5x/serial";

export const VENDOR_PREFIXES: Record<FileVendor, string> = {
  [FileVendor.USER]: "user/",
  [FileVendor.SYS]: "sys_/",
  [FileVendor.DEV1]: "rmsh/",
  [FileVendor.DEV2]: "pros/",
  [FileVendor.DEV3]: "mwrk/",
  [FileVendor.DEV4]: "deva/",
  [FileVendor.DEV5]: "devb/",
  [FileVendor.DEV6]: "devc/",
  [FileVendor.VEXVM]: "vxvm/",
  [FileVendor.VEX]: "vex_/",
  [FileVendor.UNDEFINED]: "test/",
};

export const VENDORS = [
  FileVendor.USER,
  FileVendor.SYS,
  FileVendor.DEV1,
  FileVendor.DEV2,
  FileVendor.DEV3,
  FileVendor.DEV4,
  FileVendor.DEV5,
  FileVendor.DEV6,
  FileVendor.VEXVM,
  FileVendor.VEX,
  FileVendor.UNDEFINED,
] as const;

const PREFIX_VENDORS = new Map<string, FileVendor>(
  VENDORS.map((vendor) => [VENDOR_PREFIXES[vendor], vendor]),
);

/**
 * Parse a file path as displayed by `v5x dir`. A `user/`-style vendor
 * prefix selects the vendor; a bare filename keeps the default vendor
 * (USER) for compatibility.
 */
export function parseBrainFilePath(path: string): IFileBasicInfo {
  const separator = path.indexOf("/");
  if (separator === -1) return { filename: path, vendor: FileVendor.USER };

  const prefix = path.slice(0, separator + 1);
  const filename = path.slice(separator + 1);
  const vendor = PREFIX_VENDORS.get(prefix);
  if (vendor === undefined)
    throw new Error(
      `unknown vendor prefix "${prefix}" in "${path}"; expected one of ${[
        ...PREFIX_VENDORS.keys(),
      ].join(", ")}`,
    );
  if (filename === "")
    throw new Error(`missing filename after vendor prefix in "${path}"`);
  return { filename, vendor };
}
