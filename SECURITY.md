# Security policy

## Model

project-lore-mcp reads potentially sensitive repositories and documents.
Its defaults are conservative:

- **Local-only.** No network access, telemetry, or uploads in core operation.
- **Explicit roots.** Only configured source paths are read. Symlinks that
  resolve outside a source root are skipped and warned about.
- **Secret hygiene.** Credential-shaped files (`.env`, keys, stores) are never
  indexed; common token shapes found inside documents are redacted before
  storage.
- **Untrusted content.** Document text is data, not instructions. It is never
  executed, rendered, or followed (no shell, no HTML/script evaluation, no
  URL fetching). Tool responses label excerpts as quoted evidence so MCP
  clients do not elevate document text into instructions.
- **Bounded.** File size and excerpt size limits apply; parsing failures
  degrade to plain-text indexing rather than crashing.

The local index (`.project-lore/index.db`) contains excerpts of your
documents. It is gitignored by default — treat it with the same sensitivity as
the documents themselves.

## Reporting a vulnerability

Please report vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the repository) rather than public issues.
You should receive a response within 7 days. Coordinated disclosure is
appreciated; credit is given unless you prefer otherwise.

## Supported versions

Only the latest minor release receives security fixes while the project is
pre-1.0.
