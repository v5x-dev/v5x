# @v5x/node

A Web Serial compatible serial transport for host runtimes. `@v5x/serial`
talks to a V5 brain through the Web Serial API, which browsers provide and
Node.js and Bun do not. This package provides it.

## Install

```sh
bun add @v5x/node @v5x/serial bun-serialport
```

`bun-serialport` is the default native backend on Linux and macOS, and an
optional peer dependency. Install it when you run on Bun under those
platforms; skip it on Windows, where the built-in backend talks to the Win32
communications API directly, or supply your own backend on any other runtime.

## Usage

`serial` is a drop-in replacement for `navigator.serial`:

```ts
import { serial } from "@v5x/node";
import { V5SerialDevice } from "@v5x/serial";

const device = new V5SerialDevice(serial);

const result = await device.connect();
if (result.isErr()) throw new Error(result.error.message);

console.log(device.brain.version);
await device.dispose();
```

`getPorts()` enumerates the ports the backend can see, and `requestPort()`
resolves the first matching one rather than prompting, because a host process
has no port picker to show.

```ts
import { createNodeSerial } from "@v5x/node";

const serial = createNodeSerial();

for (const port of await serial.getPorts()) {
  const info = port.getInfo();
  console.log(info.path, info.usbVendorId, info.usbProductId);
}
```

### Port identity

`SerialPortInfo` is a superset of the browser's. A host process can see the
device path and the USB serial number that a browser deliberately hides, so
ports also carry `path`, `serialNumber`, and a stable `id` (the USB serial
number when the platform reports one, otherwise the path). `@v5x/cli` uses
these for its `--port` selector.

Port objects are stable across enumerations: calling `getPorts()` twice returns
the same object for a port you already opened, so its open state is preserved.
A closed port is replaced when its discovered USB identity changes, and dropped
once it disappears. After the first enumeration, the transport also monitors
the backend for port changes and emits Web Serial-compatible `connect` and
`disconnect` events. The monitor does not keep the host process alive.

## Backends

Every platform detail lives behind `SerialBackend`. Supporting a new runtime or
operating system — Node.js with `serialport`, a hardware test rig — is a
backend, not a fork of the transport.

```ts
import { createNodeSerial, type SerialBackend } from "@v5x/node";

const backend: SerialBackend = {
  name: "my-backend",
  // Omit `platforms` to accept every platform.
  platforms: ["darwin", "linux", "win32"],
  async list() {
    return [{ path: "COM3", vendorId: "2888", productId: "0501" }];
  },
  async open({ path, baudRate }) {
    // Return an already-open port that emits `data` and `error` events.
    return openMyNativePort(path, baudRate);
  },
};

const serial = createNodeSerial({ backend });
```

`vendorId` and `productId` are hexadecimal strings without a `0x` prefix; the
transport parses them into the numeric `usbVendorId` and `usbProductId` that
Web Serial filters match against.

A backend that implements `pause()` and `resume()` gets backpressure handling:
the transport pauses native reads while the readable stream is full. A backend
without them errors the stream instead of buffering without bound.

`NodeSerial` refuses to enumerate ports on a platform outside the backend's
declared `platforms`, so the failure names the backend rather than surfacing as
an opaque native error.

### The default backends

`createDefaultSerialBackend()` picks the backend that can drive the host, and
`createNodeSerial()` uses it when you pass no `backend` of your own. Neither
backend loads its native layer until a port is enumerated or opened, so
importing this package is safe on any platform.

`createBunSerialportBackend()` drives `bun-serialport`, which ships native code
for Linux and macOS. On Linux it enumerates ports from sysfs rather than
through the library, because the library reports paths without the USB ids that
Web Serial filters need. `readLinuxUsbDeviceAttributes` and `listLinuxPorts`
are exported for backends that want the same sysfs walk.

`createWindowsSerialBackend()` talks to the Win32 communications API through
Bun's FFI, so Windows needs no native module. It enumerates COM ports from the
registry, because Windows reports USB ids through the device enumeration tree
rather than through the port itself. `parseComPortNames`,
`parseUsbPortAttributes`, and `createWindowsPortLister` are exported for
backends that want the same enumeration.

## Build

```sh
bun run build
```
