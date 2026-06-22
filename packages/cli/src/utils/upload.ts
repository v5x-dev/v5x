import { connectV5Device } from "../device";
import {
  buildProject,
  createProgramConfig,
  findProgramArtifact,
  inspectProject,
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

export async function uploadProgram(options: UploadOptions): Promise<void> {
  const project = await inspectProject(options.path);
  if (options.build) await buildProject(project);
  const artifact = await findProgramArtifact(project, options.artifact);
  const config = createProgramConfig({
    slot: options.slot,
    name: options.name ?? project.name,
    description: options.description ?? project.description,
    icon: options.icon,
    type: project.type,
    run: options.run,
  });
  const bytes = new Uint8Array(await Bun.file(artifact).arrayBuffer());
  const device = await connectV5Device();

  try {
    let previousState = "";
    const uploaded = await device.brain.uploadProgram(
      config,
      bytes,
      undefined,
      (state, current, total) => {
        if (state !== previousState) {
          if (previousState !== "") process.stderr.write("\n");
          previousState = state;
        }
        const percent = total === 0 ? 0 : Math.floor((current / total) * 100);
        process.stderr.write(`\r${state.toLowerCase().padEnd(5)} ${percent}%`);
      },
    );
    if (previousState !== "") process.stderr.write("\n");
    if (!uploaded) throw new Error("the brain rejected the program upload");
    console.log(
      `${options.run ? "uploaded and started" : "uploaded"} ${config.program.name} in slot ${options.slot}`,
    );
  } finally {
    await device.dispose();
  }
}
