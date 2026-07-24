# ADR-0002: Local SQLite index via better-sqlite3

Status: Accepted

## Context

The index must be local-only, relational, transactional, full-text searchable,
rebuildable, and light enough for a 16 GB laptop. Candidates: a JSON/flat-file
store (no FTS, no transactions at scale), `node:sqlite` (still experimental in
Node 23, FTS5 availability not guaranteed across versions), better-sqlite3
(native binding, mature, FTS5 built in), or a server database (operationally
unacceptable for a local tool).

## Decision

SQLite through better-sqlite3, with FTS5 for search, WAL mode, and a
`user_version`-based migration scheme that drops and rebuilds on schema
change (the index is derived data, so rebuild *is* the migration strategy).
The index lives in `.project-lore/index.db`, gitignored, deletable at any
time.

## Trade-off: native bindings

better-sqlite3 requires a native module. It ships prebuilt binaries for
current Node versions on macOS/Linux/Windows, and CI runs all three; when no
prebuild matches, installation falls back to compiling, which needs a
toolchain. Accepted because: the synchronous API fits the single-connection
engine, FTS5 is guaranteed, and the alternative (`node:sqlite`) is not yet
stable. Revisit when `node:sqlite` stabilizes with FTS5 across supported
Node versions — the `IndexStore` class is the isolation seam.

## Consequences

- No database server, no Docker; one file to delete for a clean rebuild.
- FTS5 gives keyword retrieval without embeddings or models.
- Contributors on unusual platforms may need a C++ toolchain.
