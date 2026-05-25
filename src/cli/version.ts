import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BIN_NAME } from "./help";

interface PackageJson {
  readonly version: string;
}

interface BuildInfo {
  readonly gitSha: string;
}

export function versionText(): string {
  const root = findPackageRoot(dirname(import.meta.path));
  const version = root ? readPackageVersion(root) : "unknown";
  const gitSha = root
    ? readGitSha(root)
    : (readGitShaFromEnv() ?? "git unknown");

  return `${BIN_NAME} ${version} (${gitSha})`;
}

function findPackageRoot(startDir: string): string | undefined {
  let current = startDir;

  while (true) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function readPackageVersion(root: string): string {
  const parsed = readJson(join(root, "package.json"));
  if (isPackageJson(parsed)) {
    return parsed.version;
  }

  return "unknown";
}

function readGitSha(root: string): string {
  return (
    readGitShaFromEnv() ??
    readGitShaFromBuildInfo(root) ??
    readGitShaFromGit(root) ??
    "git unknown"
  );
}

function readGitShaFromEnv(): string | undefined {
  const sha = process.env.AI_SESSIONS_GIT_SHA;
  return sha ? `git ${sha}` : undefined;
}

function readGitShaFromBuildInfo(root: string): string | undefined {
  const parsed = readJson(join(root, "build-info.json"));
  if (!isBuildInfo(parsed)) {
    return undefined;
  }

  return `git ${parsed.gitSha}`;
}

function readGitShaFromGit(root: string): string | undefined {
  const result = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }

  const sha = result.stdout.trim();
  return sha ? `git ${sha}` : undefined;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isPackageJson(value: unknown): value is PackageJson {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string"
  );
}

function isBuildInfo(value: unknown): value is BuildInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "gitSha" in value &&
    typeof value.gitSha === "string" &&
    value.gitSha.length > 0
  );
}
