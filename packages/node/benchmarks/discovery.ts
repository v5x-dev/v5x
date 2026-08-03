import {
  createLinuxPortLister,
  createWindowsPortLister,
} from "../src/index.js";

const names = Array.from({ length: 2_000 }, (_, index) => `COM${index + 1}`);
const serialOutput = names
  .map((name, index) => `    \\Device\\USBSER${index}    REG_SZ    ${name}`)
  .join("\r\n");
const usbOutput = names
  .map(
    (name, index) =>
      `HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_2888&PID_0501\\device-${index}\\Device Parameters\r\n    PortName    REG_SZ    ${name}`,
  )
  .join("\r\n");
let usbReads = 0;
const windowsList = createWindowsPortLister({
  readSerialComm: async () => serialOutput,
  readUsbPortNames: async () => {
    usbReads++;
    return usbOutput;
  },
});
let startedAt = performance.now();
await windowsList();
await windowsList();
console.log(
  `Windows discovery: ${(performance.now() - startedAt).toFixed(1)} ms for ${names.length} ports, ${usbReads} USB walks`,
);

const devices = Array.from(
  { length: 256 },
  (_, index) => `/sys/devices/usb-${index}`,
);
let attributeReads = 0;
const linuxList = createLinuxPortLister({
  readdir: async () =>
    Array.from({ length: 2_000 }, (_, index) => `ttyACM${index}`),
  realpath: async (path) =>
    devices[Number(path.match(/ttyACM(\d+)/)?.[1])! % devices.length]!,
  readUsbAttributes: async () => {
    attributeReads++;
    return { vendorId: "2888", productId: "0501" };
  },
});
startedAt = performance.now();
await linuxList();
await linuxList();
console.log(
  `Linux discovery: ${(performance.now() - startedAt).toFixed(1)} ms for 2,000 ttys, ${attributeReads} attribute walks`,
);
