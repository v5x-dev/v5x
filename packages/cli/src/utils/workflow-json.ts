import type { ProjectInfo, ValidatedProgramArtifacts } from "./project";
import type { ProjectToolchain } from "./scaffold";

export interface WorkflowProjectJson {
  path: string;
  type: ProjectInfo["type"];
  name: string;
  description: string;
  artifactPath: string | null;
}

export interface WorkflowArtifactJson {
  role: "hot" | "cold";
  path: string;
  size: number;
}

export interface WorkflowBuildJson {
  command: "build";
  project: WorkflowProjectJson;
  outputFiles: string[];
}

export interface WorkflowCleanJson {
  command: "clean";
  project: WorkflowProjectJson;
  outputFiles: string[];
}

export interface WorkflowUploadJson {
  command: "upload" | "run";
  project: WorkflowProjectJson;
  slot: number;
  name: string;
  description: string;
  icon: string;
  artifactPath: string;
  artifacts: WorkflowArtifactJson[];
  built: boolean;
  started: boolean;
}

export interface WorkflowCreateJson {
  command: "new" | "init";
  projectPath: string;
  projectType: ProjectToolchain;
  created: true;
}

export interface WorkflowInstallJson {
  command: "install";
  toolchain: ProjectToolchain;
  installed: true;
}

export function toWorkflowCreateJson(
  command: WorkflowCreateJson["command"],
  projectPath: string,
  projectType: ProjectToolchain,
): WorkflowCreateJson {
  return {
    command,
    projectPath,
    projectType,
    created: true,
  };
}

export function toWorkflowInstallJson(
  toolchain: ProjectToolchain,
): WorkflowInstallJson {
  return {
    command: "install",
    toolchain,
    installed: true,
  };
}

export function toWorkflowProjectJson(
  project: ProjectInfo,
): WorkflowProjectJson {
  return {
    path: project.path,
    type: project.type,
    name: project.name,
    description: project.description,
    artifactPath: project.artifact ?? null,
  };
}

export function projectOutputFiles(project: ProjectInfo): string[] {
  return project.artifact === undefined ? [] : [project.artifact];
}

export function toWorkflowArtifactJson(
  artifacts: ValidatedProgramArtifacts,
): WorkflowArtifactJson[] {
  const rows: WorkflowArtifactJson[] = [
    { role: "hot", path: artifacts.hot.path, size: artifacts.hot.size },
  ];
  if (artifacts.cold !== undefined) {
    rows.push({
      role: "cold",
      path: artifacts.cold.path,
      size: artifacts.cold.size,
    });
  }
  return rows;
}
