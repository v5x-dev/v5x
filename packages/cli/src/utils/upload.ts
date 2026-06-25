import { withV5Device } from "../device";
import {
  buildProject,
  createProgramConfig,
  findProgramArtifacts,
  inspectProject,
  validateProgramArtifacts,
} from "./project";

export interface UploadOptions {
  path: string;
  slot: number;
  name?: string;
  description?: string;
  icon: string;
  artifact?: string;
  build: boolean;
  run: boolean;
}

export interface UploadCommandOptions {
  slot: string;
  name?: string;
  description?: string;
  icon: string;
  file?: string;
  build?: boolean;
  run?: boolean;
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
  });
}

export async function uploadProgram(options: UploadOptions): Promise<void> {
  const project = await inspectProject(options.path);
  if (options.build) await buildProject(project);
  const artifacts = await findProgramArtifacts(project, options.artifact);
  const config = createProgramConfig({
    slot: options.slot,
    name: options.name ?? project.name,
    description: options.description ?? project.description,
    icon: options.icon,
    type: project.type,
    run: options.run,
  });
  const validatedArtifacts = await validateProgramArtifacts(artifacts);
  const bytes = new Uint8Array(
    await Bun.file(validatedArtifacts.hot.path).arrayBuffer(),
  );
  const coldBytes = validatedArtifacts.cold
    ? new Uint8Array(await Bun.file(validatedArtifacts.cold.path).arrayBuffer())
    : undefined;
  await withV5Device(async (device) => {
    let previousState = "";
    const uploaded = await device.brain.uploadProgram(
      config,
      bytes,
      coldBytes,
      (state, current, total) => {
        if (state !== previousState) {
          if (previousState !== "") process.stderr.write("\n");
          previousState = state;
        }
        const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
        const message = `${state.toLowerCase().padEnd(5)} ${percent}%`;
        process.stderr.write(
          process.stderr.isTTY ? `\r${message}` : `${message}\n`,
        );
      },
    );
    if (previousState !== "") process.stderr.write("\n");
    if (!uploaded) throw new Error("the brain rejected the program upload");
    console.log(
      `${options.run ? "uploaded and started" : "uploaded"} ${config.program.name} in slot ${options.slot}`,
    );
  });
}
