#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { ContextEngine } from "./engine.js";
import { createServer } from "./server.js";

const USAGE = `project-lore — documentation-aware MCP server

Usage:
  project-lore serve --root <dir> [--config <file>]   Run as stdio MCP server
  project-lore index --root <dir> [--config <file>]   Build/refresh index and print stats

Notes:
  --root defaults to the current working directory.
  Configuration is read from <root>/project-lore.config.yaml when present.
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    process.stderr.write(USAGE);
    process.exit(command ? 0 : 1);
  }

  const rootDir = resolve(arg("root") ?? process.cwd());
  const config = loadConfig(rootDir, arg("config"));
  const engine = new ContextEngine(config);

  if (command === "index") {
    const stats = engine.sync();
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    engine.close();
    return;
  }

  if (command === "serve") {
    const stats = engine.sync();
    // stdout is reserved for the MCP protocol; diagnostics go to stderr.
    for (const warning of stats.warnings) {
      process.stderr.write(`[project-lore] warning: ${warning}\n`);
    }
    process.stderr.write(
      `[project-lore] indexed ${stats.scanned} documents (${stats.added} added, ${stats.updated} updated, ${stats.removed} removed) from ${rootDir}\n`,
    );
    const server = createServer(engine);
    await server.connect(new StdioServerTransport());
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`[project-lore] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
