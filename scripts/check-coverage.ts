const targets = [
  { name: "Firmware", path: "packages/serial/src/VexFirmware.ts", minimum: 60 },
  {
    name: "Transfers",
    path: "packages/serial/src/VexTransfers.ts",
    minimum: 60,
  },
  { name: "CLI adapter", path: "packages/cli/src/adapter.ts", minimum: 70 },
  {
    name: "Device state",
    path: "packages/serial/src/VexDeviceState.ts",
    minimum: 60,
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
