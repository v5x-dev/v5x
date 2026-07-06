import { $ } from "bun";
import { parse } from "yaml";

const repository = "v5x-dev/v5x";

const labels = [
  {
    name: "dependencies",
    color: "0366D6",
    description: "Dependency update pull requests",
  },
  {
    name: "bun",
    color: "FBF0DF",
    description: "Bun runtime and package manager updates",
  },
  {
    name: "cli",
    color: "1D76DB",
    description: "CLI package updates",
  },
  {
    name: "serial",
    color: "0E8A16",
    description: "Serial package updates",
  },
  {
    name: "web",
    color: "5319E7",
    description: "Web package updates",
  },
  {
    name: "examples",
    color: "F9D0C4",
    description: "Example app updates",
  },
  {
    name: "docs",
    color: "0075CA",
    description: "Documentation app updates",
  },
  {
    name: "website",
    color: "C2E0C6",
    description: "Website app updates",
  },
  {
    name: "ci",
    color: "BFDADC",
    description: "Continuous integration updates",
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDependabotLabels(config: unknown): string[] {
  if (!isRecord(config) || !Array.isArray(config.updates)) {
    throw new Error(".github/dependabot.yml must contain an updates array");
  }

  const names = new Set<string>();
  for (const update of config.updates) {
    if (!isRecord(update)) continue;
    if (!Array.isArray(update.labels)) continue;

    for (const label of update.labels) {
      if (typeof label !== "string") {
        throw new Error("Dependabot labels must be strings");
      }
      names.add(label);
    }
  }

  return [...names].sort();
}

const config = parse(await Bun.file(".github/dependabot.yml").text());
const dependabotLabels = readDependabotLabels(config);
const definitionsByName = new Map(labels.map((label) => [label.name, label]));
const missingDefinitions = dependabotLabels.filter(
  (name) => !definitionsByName.has(name),
);

if (missingDefinitions.length > 0) {
  throw new Error(
    `Missing label definitions for: ${missingDefinitions.join(", ")}`,
  );
}

if (process.argv.includes("--check")) {
  console.log(
    `Dependabot label definitions cover: ${dependabotLabels.join(", ")}`,
  );
  process.exit(0);
}

for (const name of dependabotLabels) {
  const label = definitionsByName.get(name);
  if (label === undefined) continue;

  await $`gh label create ${label.name} --repo ${repository} --color ${label.color} --description ${label.description} --force`;
}
