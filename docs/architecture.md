# Architecture

## Ownership boundary

**This project owns the documentation layer of project knowledge:** which
documents exist, what governs what, why decisions were made, which sources a
task should route to, and whether that knowledge is still current.

**Code-intelligence tools (e.g. codebase-memory-mcp) own code structure:**
symbols, call graphs, dependencies, change impact. This server never parses
code semantics and never will; the two run side by side as independent MCP
servers in the same client. Optional correlation happens through the
`CodeIntelligenceProvider` boundary (see
[integrations/codebase-memory.md](integrations/codebase-memory.md)), which
v1 ships only as a null fallback — nothing in indexing or retrieval depends
on a provider being present.

## Pipeline

```
config (YAML + zod)          src/config.ts
  → scan sources             src/scan.ts      include/exclude, secret gate,
                                              symlink-escape guard, size bounds
  → parse documents          src/parse.ts     sections, links, frontmatter,
                                              secret redaction
  → classify                 src/classify.ts  kind, authority, status, scope
  → extract relationships    src/manifest.ts  task routes, read-first/
                                              supersedes/depends-on labels
  → store                    src/db.ts        SQLite + FTS5, transactional
  → retrieve                 src/retrieval.ts hybrid ranking, bounded excerpts
  → serve                    src/server.ts    MCP tools (transport-agnostic core)
                             src/cli.ts       stdio entry point
```

The engine (`src/engine.ts`) orchestrates sync and owns freshness; the MCP
layer is a thin adapter over it. Streamable HTTP can be added later by giving
`createServer(engine)` another transport — indexing and retrieval do not
change.

## Canonical vs. derived data

1. **Portable source knowledge** — the documents themselves, plus any future
   investigation records. Lives in Git, owned by humans. This server is
   read-only toward it.
2. **Regenerable index data** — `.project-lore/index.db`. Safe to delete
   at any time; rebuilt from sources. Never committed.
3. **Local configuration** — `project-lore.config.yaml` may contain
   machine-specific paths; commit it only if paths are portable.

## Incremental sync and freshness

Each document row stores a content hash, mtime, and parser version. On sync:
unchanged files (same hash and parser version) are not rewritten; changed
files are re-parsed and replaced transactionally; deleted files are removed;
missing external roots produce warnings and mark their documents
`unavailable` rather than deleting them. A schema or parser version bump
triggers a full rebuild — the index is disposable by design.

Relations and task routes are cheap, so they are re-derived wholesale each
sync; this keeps cross-document links correct when targets appear or move,
while the expensive rows (sections + FTS) stay incremental.

Instead of a background file watcher, the server re-syncs lazily: before
serving any tool call, at most once per 2 seconds. This is deterministic,
testable, tolerant of atomic-save editors, and cannot corrupt the index
concurrently (better-sqlite3 is synchronous, single-connection, WAL). A real
watcher is a milestone-2 option if lazy sync proves too coarse.

Freshness rules (deterministic):

| State | Rule |
| --- | --- |
| `unavailable` | The document's source root is missing/inaccessible. |
| `stale` | Document status is superseded or deprecated. |
| `potentially_stale` | A document it references/depends on changed >2s after it. |
| `fresh` | Otherwise (index re-syncs before every query). |

Stale knowledge is returned with a warning and reason — never hidden.

The `potentially_stale` signal uses filesystem mtime comparison, which is a
heuristic: git checkout, bulk formatters, and file copies can produce misleading
timestamps. It is a signal to prompt verification, not a proof of semantic
staleness.

## External roots and trust boundaries

Sources are explicit opt-in paths. The scanner resolves real paths and skips
anything escaping a source root; secret-file patterns always exclude; token
shapes are redacted at parse time. Document content is untrusted data
end-to-end — see [provenance-and-trust.md](provenance-and-trust.md).

## Known performance follow-up

`classify()` receives `ClassificationRule[]` and calls `picomatch(rule.pattern)`
inside the per-file loop, recompiling each glob on every file. For repositories
with small rule counts (the common case) this is unnoticeable. A future
improvement compiles matchers once per engine construction and passes them as
a `CompiledClassificationRule[]`. Not a v0.1 blocker; revisit if profiling shows
it on large repositories.

## Future provider integration

A provider adapter implements `CodeIntelligenceProvider` and is selected by
configuration. Providers are consulted only at retrieval time (e.g. to attach
code evidence to a documented claim); the documentation index never depends
on provider output, so a missing provider degrades to documentation-only
answers — exactly the v1 behavior.
