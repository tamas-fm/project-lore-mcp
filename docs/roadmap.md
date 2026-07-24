# Roadmap

Direction, not commitment. Ordered by intent.

## Milestone 1 — documentation-aware MCP layer (v0.1, done)

Discovery, deterministic extraction, authority model, SQLite/FTS5 index,
manifest task routing, freshness, `route_task` / `search_project_knowledge` /
`get_document_context`, stdio transport, example project + benchmark.

## Milestone 2 — evidence and staleness deepening

- `explain_project_rule`: strongest evidence for a convention, classified as
  documented / derived / conflicting / potentially stale.
- `check_knowledge_freshness`: what may be stale after a given change.
- Git-aware freshness (commit hashes on records; "changed since commit X").
- Optional file watcher if lazy re-sync proves too coarse.
- MCP resources for browsing manifests and authority maps.

## Milestone 3 — investigation records

Portable YAML records in Git (question, answer, evidence, verified-at
commit), generated as proposals by a CLI for human review; recall via
`recall_investigation`. The server stays read-only toward project knowledge.

## Milestone 4 — providers and transports

- codebase-memory-mcp adapter behind `CodeIntelligenceProvider` (after its
  tool surface and license are verified — see
  integrations/codebase-memory.md).
- Streamable HTTP transport.
- Optional embeddings behind the retrieval interface, off by default.

## Explicit non-goals

Hosted services, accounts, billing, telemetry, plugin marketplaces, GUIs,
team sync, cloud vector databases, OCR/browser automation, generalized agent
memory, autonomous writes to project knowledge.
