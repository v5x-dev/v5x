import { defineCommand } from "@bunli/core";
import { getV5Device } from "../plugins/device";
import { FileVendor } from "@v5x/serial";

export const VENDOR_PREFIXES = {
  user: FileVendor.USER,
  "/user": FileVendor.USER,

  sys_: FileVendor.SYS,
  "/sys_": FileVendor.SYS,

  rmsh: FileVendor.DEV1,
  "/rmsh": FileVendor.DEV1,

  pros: FileVendor.DEV2,
  "/pros": FileVendor.DEV2,

  mwrk: FileVendor.DEV3,
  "/mwrk": FileVendor.DEV3,

  deva: FileVendor.DEV4,
  "/deva": FileVendor.DEV4,

  devb: FileVendor.DEV5,
  "/devb": FileVendor.DEV5,

  devc: FileVendor.DEV6,
  "/devc": FileVendor.DEV6,

  vxvm: FileVendor.VEXVM,
  "/vxvm": FileVendor.VEXVM,

  vex_: FileVendor.VEX,
  "/vex_": FileVendor.VEX,
} as const satisfies Record<string, FileVendor>;

function resolveVendorPath(path: string): {
  vendor: FileVendor;
  filename: string;
} {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  for (const [prefix, vendor] of Object.entries(VENDOR_PREFIXES) as [
    keyof typeof VENDOR_PREFIXES,
    FileVendor,
  ][]) {
    if (normalized.startsWith(prefix)) {
      return {
        vendor,
        filename: normalized.slice(prefix.length).replace(/^\/+/, ""),
      };
    }
  }

  return {
    vendor: FileVendor.UNDEFINED,
    filename: normalized.replace(/^\/+/, ""),
  };
}

const catCommand = defineCommand({
  name: "cat",
  description: "read a file from flash",
  handler: async ({ positional, context, colors }) => {
    if (!context) return;
    const device = getV5Device(context);
    if (!device) return;

    const [path] = positional;

    const handle = resolveVendorPath(path);
    const output = await device.brain.readFile(handle);
    const decoder = new TextDecoder();

    console.log(decoder.decode(output));
  },
});

export default catCommand;
