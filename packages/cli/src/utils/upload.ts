import { withV5Device } from "../device";
import { formatSerialFailure, printJson } from "./output";
import {
  buildProject,
  createProgramConfig,
  findProgramArtifacts,
  inspectProject,
  validateProgramArtifacts,
} from "./project";
import {
  toWorkflowArtifactJson,
  toWorkflowProjectJson,
  type WorkflowUploadJson,
} from "./workflow-json";

export interface UploadOptions {
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

export interface UploadCommandOptions {
  slot: string;
  name?: string;
  description?: string;
  icon: string;
  file?: string;
  build?: boolean;
  run?: boolean;
  json?: boolean;
}

export async function uploadProgramFromCommand(
  path: string | undefined,
  options: UploadCommandOptions,
  runDefault: boolean,
): Promise<void> {
  await uploadProgram({
    path: path ?? process.cwd(),
    slot: Number(options.slot),
    name: options.name,
    description: options.description,
    icon: options.icon,
    artifact: options.file,
    build: options.build ?? true,
    run: options.run ?? runDefault,
    command: runDefault ? "run" : "upload",
    json: options.json,
  });
}

function reportProgress() {
  let previousState = "";
  const report = (state: string, current: number, total: number) => {
    if (state !== previousState) {
      if (previousState !== "") process.stderr.write("\n");
      previousState = state;
    }
    const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
    const message = `${state.toLowerCase().padEnd(5)} ${percent}%`;
    process.stderr.write(
      process.stderr.isTTY ? `\r${message}` : `${message}\n`,
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
  const bytes = await Bun.file(validated.hot.path).bytes();
  const coldBytes = validated.cold
    ? await Bun.file(validated.cold.path).bytes()
    : undefined;

  await withV5Device(async (device) => {
    const progress = reportProgress();
    const uploaded = await device.brain.uploadProgram(
      config,
      bytes,
      coldBytes,
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
