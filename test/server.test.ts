import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContextEngine } from "../src/engine.js";
import type { ProjectConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { exampleEngine, tempProject, type TempProject } from "./helpers.js";

let engine: ContextEngine;
let client: Client;

beforeAll(async () => {
  engine = exampleEngine();
  const server = createServer(engine);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  engine.close();
});

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.type).toBe("text");
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe("MCP server over the protocol", () => {
  it("exposes exactly the three v1 tools", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "get_document_context",
      "route_task",
      "search_project_knowledge",
    ]);
  });

  it("route_task returns the manifest route with provenance fields", async () => {
    const result = payload(
      await client.callTool({
        name: "route_task",
        arguments: { task: "Add a new mobile onboarding screen", limit: 6 },
      }),
    );
    expect(result["notice"]).toContain("quoted evidence");
    const matched = result["matchedRoute"] as Record<string, unknown>;
    expect(matched["manifestPath"]).toBe("docs/00-manifest.md");
    const docs = result["documents"] as Array<Record<string, unknown>>;
    expect(docs[0]).toMatchObject({
      path: "docs/ux/onboarding-flow.md",
      authority: "design",
      basis: "documented",
    });
    expect(typeof docs[0]?.["startLine"]).toBe("number");
  });

  it("search_project_knowledge returns bounded excerpts", async () => {
    const result = payload(
      await client.callTool({
        name: "search_project_knowledge",
        arguments: { query: "premium gold sparingly" },
      }),
    );
    const results = result["results"] as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect((r["excerpt"] as string).length).toBeLessThanOrEqual(1601);
    }
  });

  it("get_document_context returns sections and typed relations, not the whole file", async () => {
    const result = payload(
      await client.callTool({
        name: "get_document_context",
        arguments: { path: "docs/adr/0002-sqlite-local-persistence.md", heading: "Decision" },
      }),
    );
    const doc = result["document"] as Record<string, unknown>;
    expect(doc["kind"]).toBe("adr");
    expect(doc["status"]).toBe("active");
    const sections = result["sections"] as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(1);
    expect(sections[0]?.["heading"]).toContain("Decision");
    const relations = result["relations"] as Array<Record<string, unknown>>;
    expect(
      relations.some(
        (r) => r["type"] === "supersedes" && r["otherPath"] === "docs/adr/0001-plist-local-persistence.md",
      ),
    ).toBe(true);
  });

  it("returns an actionable error for unknown paths", async () => {
    const result = payload(
      await client.callTool({
        name: "get_document_context",
        arguments: { path: "docs/nope.md" },
      }),
    );
    expect(result["error"]).toContain("No indexed document");
  });

  it("rejects invalid input via schema validation", async () => {
    await expect(
      client.callTool({ name: "route_task", arguments: { task: "x" } }),
    ).resolves.toMatchObject({ isError: true });
  });
});

describe("MCP server: get_document_context path ambiguity", () => {
  let tp: TempProject;
  let ambigEngine: ContextEngine;
  let ambigClient: Client;

  beforeAll(async () => {
    tp = tempProject();
    // Two sources, both containing README.md at the same relative path.
    tp.write("src-a/README.md", "# Source A readme\n");
    tp.write("src-b/README.md", "# Source B readme\n");
    tp.write("project-lore.config.yaml",
      [
        "sources:",
        "  - id: source-a",
        "    type: directory",
        "    path: src-a",
        "    authority: canonical",
        "  - id: source-b",
        "    type: directory",
        "    path: src-b",
        "    authority: canonical",
      ].join("\n"),
    );
    ambigEngine = tp.engine();
    ambigEngine.sync();

    const server = createServer(ambigEngine);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    ambigClient = new Client({ name: "ambig-test-client", version: "0.0.0" });
    await ambigClient.connect(clientTransport);
  });

  afterAll(async () => {
    await ambigClient.close();
    ambigEngine.close();
    tp.cleanup();
  });

  it("returns an error listing all matching sourceIds when path is ambiguous", async () => {
    const result = JSON.parse(
      ((await ambigClient.callTool({
        name: "get_document_context",
        arguments: { path: "README.md" },
      })).content as Array<{ type: string; text: string }>)[0]!.text,
    ) as Record<string, unknown>;
    expect(typeof result["error"]).toBe("string");
    expect(result["error"] as string).toContain("source-a");
    expect(result["error"] as string).toContain("source-b");
    expect(result["error"] as string).toContain("sourceId");
  });

  it("resolves correctly when sourceId is provided", async () => {
    const result = JSON.parse(
      ((await ambigClient.callTool({
        name: "get_document_context",
        arguments: { path: "README.md", sourceId: "source-a" },
      })).content as Array<{ type: string; text: string }>)[0]!.text,
    ) as Record<string, unknown>;
    expect(result["error"]).toBeUndefined();
    const doc = result["document"] as Record<string, unknown>;
    expect(doc["sourceId"]).toBe("source-a");
  });
});
