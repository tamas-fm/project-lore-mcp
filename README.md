# project-lore-mcp

A local-first MCP server that routes coding agents to the smallest useful set
of project documentation — decisions, intent, and constraints — with
provenance and freshness.

Code-intelligence tools (such as codebase-memory-mcp) answer *where is this
implemented and what depends on it*. This project answers the complementary
questions: **why was it designed this way, which document governs this task,
and is that knowledge still current?**

## What it does

Point it at a repository (plus optional external documentation roots). It:

1. discovers Markdown, text, HTML, YAML, JSON, Mermaid, and Claude
   instruction files;
2. classifies each document by kind and authority (instructions → canonical →
   design → planning → historical → generated → proposed);
3. extracts headings, sections, links, frontmatter, ADR status, and explicit
   "read first" / "supersedes" / task-routing relationships — deterministically,
   with recorded provenance (structural extraction applies to Markdown; other
   formats receive plain-text indexing);
4. stores a rebuildable local index in SQLite (FTS5), updated incrementally by
   content hash;
5. answers task and knowledge queries with **bounded excerpts and exact source
   locations — never whole files**, flagging stale or superseded sources
   instead of hiding them.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `route_task` | Given a development task, return the ordered documents/sections to read first. Explicit manifest routes win over ranked search. |
| `search_project_knowledge` | Full-text search over documentation, re-ranked by authority and status; freshness is shown per result. |
| `get_document_context` | Sections + typed relationships of one document, without returning the whole file. |

## Install and run

Requires Node.js ≥ 22.

```bash
npm install
npm run build
node dist/cli.js index --root /path/to/your/repo   # one-shot index + stats
node dist/cli.js serve --root /path/to/your/repo   # stdio MCP server
```

### Claude Code

```bash
claude mcp add project-lore -- node /path/to/project-lore-mcp/dist/cli.js serve --root /path/to/your/repo
```

It coexists with codebase-memory-mcp — configure both; they own different
questions. If your configuration references documentation outside the
repository, Claude Code must be granted filesystem access to those paths
(add them as additional working directories or approve the permission
prompts).

### Try the example

```bash
npm run index:example        # index examples/documented-project
npm run serve:example        # serve it over stdio
```

## Configuration

Optional `project-lore.config.yaml` at the repository root:

```yaml
sources:
  - id: repository
    type: directory
    path: .
    authority: canonical
  - id: design-handoff
    type: directory
    path: ../product-docs      # explicit opt-in external root
    authority: design
classification:
  rules:
    - pattern: "docs/legacy/**"
      authority: historical
```

See [docs/configuration.md](docs/configuration.md) for the full reference and
[docs/concepts.md](docs/concepts.md) for the authority model.

## Design principles

> Store and retrieve documented intent conservatively. Derive structure
> automatically. Preserve provenance always.

- **Local-only by default.** No network access, no telemetry, no uploads.
  The index is regenerable and safe to delete (`.project-lore/`, gitignored).
- **Deterministic before AI.** v1 uses no LLM and no embeddings. Every stored
  relationship records how it was extracted; inferred data can never
  masquerade as documented fact.
- **Evidence, not instructions.** Retrieved excerpts are quoted, bounded, and
  attributed. Document content is treated as untrusted data
  (see [docs/provenance-and-trust.md](docs/provenance-and-trust.md)).

## Project status

v0.1.0 — first vertical slice. See [docs/architecture.md](docs/architecture.md),
the ADRs in [docs/adr/](docs/adr/), and [CONTRIBUTING.md](CONTRIBUTING.md).

License: MIT (maintainer sign-off pending before first publish).
