import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProjectConfig = {
  id: string;
  name: string;
  boardUrl: string;
  discordChannelId: string;
  enabled: boolean;
};

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PROJECTS_FILE = path.join(PROJECT_ROOT, "config", "projects.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slugFromProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "project";
}

function normalizeProject(raw: Record<string, unknown>): ProjectConfig | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const boardUrl = typeof raw.boardUrl === "string" ? raw.boardUrl.trim() : "";
  const discordChannelId =
    typeof raw.discordChannelId === "string" ? raw.discordChannelId.trim() : "";
  const enabled = raw.enabled === false ? false : true;

  if (!id || !name || !boardUrl || !discordChannelId) {
    return null;
  }

  return { id, name, boardUrl, discordChannelId, enabled };
}

function ensureProjectsFile(): void {
  const dir = path.dirname(PROJECTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, "[]\n", "utf8");
  }
}

function parseProjectsFile(): ProjectConfig[] {
  ensureProjectsFile();
  const rawText = fs.readFileSync(PROJECTS_FILE, "utf8").trim();
  if (!rawText) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Invalid JSON in config/projects.json: ${err}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("config/projects.json must be a JSON array");
  }

  const projects: ProjectConfig[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const project = normalizeProject(entry);
    if (project) {
      projects.push(project);
    }
  }
  return projects;
}

function loadProjectsFromEnv(): ProjectConfig[] {
  const boardUrl = process.env.APPTASK_BOARD_URL?.trim();
  const discordChannelId = process.env.AUDIT_DISCORD_CHANNEL_ID?.trim();
  if (!boardUrl || !discordChannelId) {
    return [];
  }

  return [
    {
      id: "default",
      name: process.env.APPTASK_PROJECT_NAME?.trim() || "AppTask Project",
      boardUrl,
      discordChannelId,
      enabled: true,
    },
  ];
}

/** All projects from config/projects.json (creates empty file if missing). */
export function loadProjects(): ProjectConfig[] {
  return parseProjectsFile();
}

export function saveProjects(projects: ProjectConfig[]): void {
  ensureProjectsFile();
  fs.writeFileSync(PROJECTS_FILE, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

/** Enabled projects from file; if none, .env fallback (scheduled / weekly). */
export function getEnabledProjects(): ProjectConfig[] {
  const fromFile = loadProjects().filter((p) => p.enabled);
  if (fromFile.length > 0) {
    return fromFile;
  }
  return loadProjectsFromEnv();
}

export function addProject(input: {
  name: string;
  boardUrl: string;
  discordChannelId: string;
  enabled?: boolean;
}): ProjectConfig {
  const projects = loadProjects();
  const id = slugFromProjectName(input.name);
  const project: ProjectConfig = {
    id,
    name: input.name.trim(),
    boardUrl: input.boardUrl.trim(),
    discordChannelId: input.discordChannelId.trim(),
    enabled: input.enabled !== false,
  };

  const index = projects.findIndex((p) => p.id === id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }

  saveProjects(projects);
  return project;
}

export function removeProject(nameOrId: string): ProjectConfig | null {
  const key = nameOrId.trim().toLowerCase();
  const projects = loadProjects();
  const index = projects.findIndex(
    (p) =>
      p.id.toLowerCase() === key || p.name.trim().toLowerCase() === key,
  );
  if (index < 0) {
    return null;
  }

  const [removed] = projects.splice(index, 1);
  saveProjects(projects);
  return removed ?? null;
}
