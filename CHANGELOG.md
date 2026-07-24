# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) (pre-1.0: minor bumps may break).

## [Unreleased]

## [0.1.0] — 2026-07-24

First vertical slice.

### Added
- Source discovery over configured local roots with include/exclude patterns,
  symlink-escape protection, secret-file exclusion, and size bounds.
- Deterministic extraction: sections, links, frontmatter, ADR status,
  explicit read-first/depends-on/supersedes relations, manifest task routes
  (heading and table forms), scoped Claude instructions.
- Configurable authority model with deterministic classification.
- SQLite + FTS5 index with content-hash incremental sync and full provenance.
- Freshness reporting: fresh / potentially_stale / stale / unavailable.
- MCP stdio server with `route_task`, `search_project_knowledge`,
  `get_document_context`.
- `CodeIntelligenceProvider` boundary with null fallback.
- Example documented project, deterministic retrieval benchmark, 53 tests.
