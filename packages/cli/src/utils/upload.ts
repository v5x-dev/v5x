import { type PortSelectionOptions, withSelectedV5Device } from "../device";
import { requireOptionValue } from "./guards";
import { formatSerialFailure, printJson } from "./output";
import {
  buildProject,
  createProgramConfig,
  findProgramArtifacts,
  inspectProject,
  loadValidatedProgramArtifacts,
  validateProgramArtifacts,
} from "./project";
import {
  toWorkflowArtifactJson,
  toWorkflowProjectJson,
  type WorkflowUploadJson,
} from "./workflow-json";

export interface UploadOptions extends PortSelectionOptions {
  path: string;
  slot: number;
  name?: string;
  description?: string;
  icon: string;
  artifact?: string;
  build: boolean;
  run: boolean;
  command: WorkflowUploadJson["command"];
  json?: boolean;
}

export interface UploadCommandOptions extends PortSelectionOptions {
  // sade/mri parse a flag given without a value (e.g. a bare `--slot`) as the
  // boolean `true` rather than the declared default, so this must accept both.
  slot: string | boolean;
  name?: string | boolean;
  description?: string | boolean;
  icon: string | boolean;
  file?: string | boolean;
  build?: boolean;
  run?: boolean;
  json?: boolean;
}

/**
 * Resolves the raw `--slot` CLI option into a slot number.
 *
 * A bare `--slot` flag (no value) is parsed by sade/mri as the boolean
 * `true`, which would silently become slot 1 via `Number(true)`. Reject that
 * case explicitly instead of uploading to the wrong slot.
 */
export function resolveSlotOption(slot: string | boolean): number {
  return Number(requireOptionValue(slot, "--slot"));
}

/**
 * Resolves whether the project should be built before uploading.
 *
 * When `--file` is given the caller is uploading a pre-built artifact, so
 * the build step is skipped by default. Passing `--build` (or omitting
 * `--file`) explicitly opts back into building; `--no-build` always skips it.
 */
export function resolveBuildOption(
  build: boolean | undefined,
  file: string | undefined,
): boolean {
  if (build !== undefined) return build;
  return file === undefined;
}

export async function uploadProgramFromCommand(
  path: string | undefined,
  options: UploadCommandOptions,
  runDefault: boolean,
): Promise<void> {
  const name = requireOptionValue(options.name, "--name");
  const description = requireOptionValue(options.description, "--description");
  const icon = requireOptionValue(options.icon, "--icon");
  const file = requireOptionValue(options.file, "--file");

  await uploadProgram({
    path: path ?? process.cwd(),
    slot: resolveSlotOption(options.slot),
    name,
    description,
    icon: icon ?? "default.bmp",
    artifact: file,
    build: resolveBuildOption(options.build, file),
    run: options.run ?? runDefault,
    port: options.port,
    command: runDefault ? "run" : "upload",
    json: options.json,
  });
}

export function reportProgress() {
  let previousState = "";
  // Track the longest state label seen so far so short state names (e.g.
  // "bin") are padded wide enough to fully overwrite a longer previous one
  // (e.g. "channel") when redrawing the same TTY line.
  let maxStateWidth = 0;
  const report = (state: string, current: number, total: number) => {
    if (state !== previousState) {
      if (previousState !== "") process.stderr.write("\n");
      previousState = state;
    }
    maxStateWidth = Math.max(maxStateWidth, state.length);
    const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
    const message = `${state.toLowerCase().padEnd(maxStateWidth)} ${percent}%`;
    process.stderr.write(
      // "\x1b[K" clears from the cursor to the end of the line, so residue
      // from a longer previous message on the same line never lingers.
      process.stderr.isTTY ? `\r\x1b[K${message}` : `${message}\n`,
    );
  };
  report.finish = () => {
    if (previousState !== "") process.stderr.write("\n");
  };
  return report;
}

export async function uploadProgram(
  options: UploadOptions,
): Promise<WorkflowUploadJson> {
  const project = await inspectProject(options.path);
  if (options.build)
    await buildProject(project, {
      stdout: options.json === true ? "ignore" : "inherit",
    });
  const artifacts = await findProgramArtifacts(project, options.artifact);
  const config = createProgramConfig({
    slot: options.slot,
    name: options.name ?? project.name,
    description: options.description ?? project.description,
    icon: options.icon,
    type: project.type,
    run: options.run,
  });
  const validated = await validateProgramArtifacts(artifacts);
  const bytes = await loadValidatedProgramArtifacts(validated);

  await withSelectedV5Device(options, async (device) => {
    const progress = reportProgress();
    const uploaded = await device.brain.uploadProgram(
      config,
      bytes.hot,
      bytes.cold,
      progress,
    );
    progress.finish();
    if (uploaded.isErr()) {
      throw new Error(
        formatSerialFailure(
          "the brain rejected the program upload",
          uploaded.error,
        ),
      );
    }
    if (!uploaded.value)
      throw new Error("the brain rejected the program upload");
    if (options.json !== true) {
      console.log(
        `${options.run ? "uploaded and started" : "uploaded"} ${config.program.name} in slot ${options.slot}`,
      );
    }
  });
  const result: WorkflowUploadJson = {
    command: options.command,
    project: toWorkflowProjectJson(project),
    slot: options.slot,
    name: config.program.name,
    description: config.program.description,
    icon: config.program.icon,
    artifactPath: validated.hot.path,
    artifacts: toWorkflowArtifactJson(validated),
    built: options.build,
    started: options.run,
  };
  if (options.json === true) printJson(result);
  return result;
}
