import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const authorityLevel = z.enum([
  "instruction",
  "canonical",
  "design",
  "navigational",
  "planning",
  "historical",
  "generated",
  "proposed",
]);

const documentKind = z.enum([
  "claude_instructions",
  "readme",
  "adr",
  "architecture",
  "design",
  "product",
  "ux",
  "manifest",
  "plan",
  "runbook",
  "api",
  "reference",
  "diagram",
  "unknown",
]);

const sourceSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-_]*$/i),
  type: z.literal("directory"),
  path: z.string().min(1),
  authority: authorityLevel.default("canonical"),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const classificationRuleSchema = z.object({
  pattern: z.string().min(1),
  kind: documentKind.optional(),
  authority: authorityLevel.optional(),
});

const configSchema = z.object({
  sources: z.array(sourceSchema).min(1),
  classification: z
    .object({ rules: z.array(classificationRuleSchema).default([]) })
    .default({ rules: [] }),
  limits: z
    .object({
      maxFileBytes: z.number().int().positive().default(1_048_576),
      maxExcerptChars: z.number().int().positive().default(1_600),
    })
    .default({ maxFileBytes: 1_048_576, maxExcerptChars: 1_600 }),
  storage: z
    .object({ path: z.string().default(".project-lore/index.db") })
    .default({ path: ".project-lore/index.db" }),
});

export type SourceConfig = z.infer<typeof sourceSchema>;
export type ClassificationRule = z.infer<typeof classificationRuleSchema>;
export type ProjectConfig = z.infer<typeof configSchema> & {
  /** Absolute path of the primary root the server was started against. */
  rootDir: string;
  /** Config file path if one was loaded, for provenance. */
  configPath?: string;
};

export const CONFIG_FILENAME = "project-lore.config.yaml";

export function expandPath(p: string, rootDir: string): string {
  const expanded = p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p;
  return isAbsolute(expanded) ? expanded : resolve(rootDir, expanded);
}

function defaultConfig(rootDir: string): ProjectConfig {
  return {
    ...configSchema.parse({
      sources: [{ id: "repository", type: "directory", path: "." }],
    }),
    rootDir,
  };
}

/**
 * Loads `project-lore.config.yaml` from the root directory, falling back
 * to an all-defaults config indexing the root itself. Throws with an
 * actionable message when the file exists but is invalid.
 */
export function loadConfig(rootDir: string, configFile?: string): ProjectConfig {
  const path = configFile ?? resolve(rootDir, CONFIG_FILENAME);
  if (!existsSync(path)) {
    if (configFile) {
      throw new Error(`Config file not found: ${configFile}`);
    }
    return defaultConfig(rootDir);
  }
  const raw = parseYaml(readFileSync(path, "utf8"));
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ${path}:\n${issues}`);
  }
  const ids = new Set<string>();
  for (const s of parsed.data.sources) {
    if (ids.has(s.id)) throw new Error(`Duplicate source id "${s.id}" in ${path}`);
    ids.add(s.id);
  }
  return { ...parsed.data, rootDir, configPath: path };
}
