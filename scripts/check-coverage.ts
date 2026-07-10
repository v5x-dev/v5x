const targets = [
  {
    name: "Connection",
    path: "packages/serial/src/VexConnection.ts",
    minimum: 93,
  },
  {
    name: "Device",
    path: "packages/serial/src/VexDevice.ts",
    minimum: 93,
  },
  {
    name: "Packet models",
    path: "packages/serial/src/VexPacketModels.ts",
    minimum: 68,
  },
  {
    name: "Packet encoder",
    path: "packages/serial/src/VexPacketEncoder.ts",
    minimum: 88,
  },
  { name: "Firmware", path: "packages/serial/src/VexFirmware.ts", minimum: 87 },
  {
    name: "Transfers",
    path: "packages/serial/src/VexTransfers.ts",
    minimum: 95,
  },
  { name: "CLI adapter", path: "packages/cli/src/adapter.ts", minimum: 81 },
  {
    name: "CLI device command output",
    path: "packages/cli/src/commands/devices.ts",
    minimum: 77,
  },
  {
    name: "CLI dir command output",
    path: "packages/cli/src/commands/dir.ts",
    minimum: 67,
  },
  {
    name: "CLI doctor command output",
    path: "packages/cli/src/commands/doctor.ts",
    minimum: 79,
  },
  {
    name: "CLI screenshot command output",
    path: "packages/cli/src/commands/screenshot.ts",
    minimum: 68,
  },
  {
    name: "CLI output helpers",
    path: "packages/cli/src/utils/output.ts",
    minimum: 77,
  },
  {
    name: "CLI project workflows",
    path: "packages/cli/src/utils/project.ts",
    minimum: 65,
  },
  {
    name: "CLI scaffold workflows",
    path: "packages/cli/src/utils/scaffold.ts",
    minimum: 92,
  },
  {
    name: "Device state",
    path: "packages/serial/src/VexDeviceState.ts",
    minimum: 82,
  },
  {
    name: "Web client",
    path: "packages/web/src/client.ts",
    minimum: 96,
  },
  {
    name: "Web support",
    path: "packages/web/src/support.ts",
    minimum: 100,
  },
];

const lcovPath = "coverage/lcov.info";
const lcov = await Bun.file(lcovPath).text();
const records = lcov.split("end_of_record").map((record) => {
  const source = /^SF:(.+)$/m.exec(record)?.[1]?.replaceAll("\\", "/");
  const found = Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
  const total = Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
  return { source, found, total };
});

const rows = targets.map((target) => {
  const matching = records.filter((record) =>
    record.source?.endsWith(target.path),
  );
  const found = matching.reduce((sum, record) => sum + record.found, 0);
  const total = matching.reduce((sum, record) => sum + record.total, 0);
  if (total === 0) throw new Error(`coverage missing for ${target.path}`);
  return { ...target, percent: (found / total) * 100 };
});

const summary = [
  "# Critical-module line coverage",
  "",
  "| Area | Coverage | Minimum |",
  "| --- | ---: | ---: |",
  ...rows.map(
    (row) =>
      `| ${row.name} | ${row.percent.toFixed(2)}% | ${row.minimum.toFixed(2)}% |`,
  ),
  "",
].join("\n");

await Bun.write("coverage/summary.md", summary);
console.log(summary);

const failures = rows.filter((row) => row.percent < row.minimum);
if (failures.length > 0) {
  throw new Error(
    failures
      .map(
        (row) =>
          `${row.name} coverage ${row.percent.toFixed(2)}% is below ${row.minimum.toFixed(2)}%`,
      )
      .join("\n"),
  );
}
