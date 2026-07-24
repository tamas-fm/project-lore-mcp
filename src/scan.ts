import { readdirSync, statSync, realpathSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import picomatch from "picomatch";
import type { SourceConfig } from "./config.js";
import { expandPath } from "./config.js";

export interface ScannedFile {
  sourceId: string;
  /** POSIX-style path relative to the source root. */
  relPath: string;
  absPath: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: ScannedFile[];
  warnings: string[];
}

export const DEFAULT_INCLUDE = [
  "**/*.md",
  "**/*.markdown",
  "**/*.mdx",
  "**/*.txt",
  "**/*.html",
  "**/*.json",
  "**/*.yaml",
  "**/*.yml",
  "**/*.mmd",
  "**/*.mermaid",
];

export const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.cache/**",
  "**/.project-lore/**",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/*.min.*",
  "**/project-lore.config.yaml",
];

/**
 * Files that plausibly contain credentials are never indexed, regardless of
 * include patterns. Content-level redaction happens later in parsing; this is
 * the file-level gate.
 */
export const SECRET_EXCLUDE = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/*credentials*",
  "**/*secrets*",
  "**/.netrc",
  "**/.npmrc",
  "**/*.tfstate",
  "**/serviceAccountKey*.json",
];

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Walks one configured source directory. Security properties:
 * - only files whose real path stays inside the source root's real path are
 *   returned (symlinks pointing elsewhere are skipped with a warning);
 * - secret-file patterns always exclude;
 * - files over `maxFileBytes` are skipped with a warning.
 */
export function scanSource(
  source: SourceConfig,
  rootDir: string,
  maxFileBytes: number,
): ScanResult {
  const warnings: string[] = [];
  const files: ScannedFile[] = [];
  const rootAbs = expandPath(source.path, rootDir);

  if (!existsSync(rootAbs)) {
    warnings.push(
      `Source "${source.id}" path is missing or inaccessible: ${rootAbs}. ` +
        `Its documents are reported as unavailable.`,
    );
    return { files, warnings };
  }

  const rootReal = realpathSync(rootAbs);
  const isIncluded = picomatch(source.include ?? DEFAULT_INCLUDE, { dot: true });
  const isExcluded = picomatch(
    [...DEFAULT_EXCLUDE, ...(source.exclude ?? [])],
    { dot: true },
  );
  const isSecret = picomatch(SECRET_EXCLUDE, { dot: true, nocase: true });

  // Track canonical real paths of visited directories to detect cycles.
  const visitedDirs = new Set<string>();

  const walk = (dir: string): void => {
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch {
      return; // unresolvable — broken symlink at dir level
    }
    if (visitedDirs.has(realDir)) {
      const rel = toPosix(relative(rootReal, dir));
      warnings.push(`Skipping already-visited directory (symlink cycle): ${rel || "."}`);
      return;
    }
    visitedDirs.add(realDir);

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push(`Cannot read directory ${dir}: ${(err as Error).message}`);
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(rootReal, abs));
      if (isExcluded(rel)) continue;
      if (isSecret(rel)) {
        warnings.push(`Skipping secret-pattern-matched file: ${rel}`);
        continue;
      }

      let real: string;
      try {
        real = realpathSync(abs);
      } catch {
        continue; // broken symlink
      }
      if (real !== rootReal && !real.startsWith(rootReal + sep)) {
        warnings.push(`Skipping symlink escaping source root: ${rel}`);
        continue;
      }

      if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(real).isDirectory())) {
        walk(abs);
        continue;
      }
      if (!isIncluded(rel)) continue;

      const stat = statSync(real);
      if (stat.size > maxFileBytes) {
        warnings.push(`Skipping oversized file (${stat.size} bytes): ${rel}`);
        continue;
      }
      files.push({
        sourceId: source.id,
        relPath: rel,
        absPath: abs,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  };

  walk(rootReal);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { files, warnings };
}
