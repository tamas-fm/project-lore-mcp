import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { ContextEngine } from "../src/engine.js";

export const EXAMPLE_ROOT = resolve(
  import.meta.dirname,
  "../examples/documented-project",
);

/** Engine over the shipped example fixture, using an in-memory index. */
export function exampleEngine(): ContextEngine {
  const engine = new ContextEngine(loadConfig(EXAMPLE_ROOT), ":memory:");
  engine.sync();
  return engine;
}

export interface TempProject {
  root: string;
  write(relPath: string, content: string): string;
  engine(): ContextEngine;
  cleanup(): void;
}

/** Creates a throwaway project directory for mutation-oriented tests. */
export function tempProject(): TempProject {
  const root = mkdtempSync(join(tmpdir(), "pcm-test-"));
  return {
    root,
    write(relPath, content) {
      const abs = join(root, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      return abs;
    },
    engine() {
      return new ContextEngine(loadConfig(root), ":memory:");
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
