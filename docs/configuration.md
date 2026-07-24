# Configuration reference

Configuration is optional. Without a config file, the server indexes the
`--root` directory with defaults. To customize, place
`project-lore.config.yaml` in the root (or pass `--config <file>`).

## Full example

```yaml
sources:
  - id: repository
    type: directory
    path: .
    authority: canonical          # default authority for this source
    include:                      # optional; defaults shown in "Defaults"
      - "**/*.md"
      - "docs/**/*.yaml"
    exclude:
      - "vendor/**"

  - id: product-docs
    type: directory
    path: ../project-product-docs # explicit opt-in external root
    authority: canonical

  - id: design-handoff
    type: directory
    path: ~/Documents/project-design
    authority: design

classification:
  rules:                          # pattern rules override built-in heuristics
    - pattern: "docs/legacy/**"
      authority: historical
    - pattern: "docs/rfcs/*.md"
      kind: design
      authority: proposed

limits:
  maxFileBytes: 1048576           # skip larger files (default 1 MiB)
  maxExcerptChars: 1600           # excerpt bound per result (default 1600)

storage:
  path: .project-lore/index.db # relative to root; delete anytime to rebuild
```

## Sources

- `id` — unique, stable identifier; recorded on every document.
- `path` — absolute, root-relative, or `~/`-prefixed. A missing path produces
  a startup warning and marks its documents `unavailable`; it never fails the
  server or exposes other paths.
- `authority` — fallback authority for documents that no heuristic or rule
  classifies: one of `instruction`, `canonical`, `design`, `navigational`,
  `planning`, `historical`, `generated`, `proposed`.
- `include` / `exclude` — glob patterns relative to the source root.

Only files under configured roots are ever read (real paths are checked;
symlinks escaping a root are skipped). External documents are indexed in
place — they are never copied into the repository; only index data derived
for retrieval is stored.

## Defaults

Included: `md, markdown, mdx, txt, html, json, yaml, yml, mmd, mermaid`.
Structural parsing (headings, links, frontmatter, sections) applies to
Markdown files only; other formats receive plain-text indexing.

Always excluded: `node_modules`, `.git`, `dist`, `build`, `coverage`,
lockfiles, minified files, `.project-lore/`, and credential-shaped files
(`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*credentials*`, `*secrets*`, …).
Secret exclusion applies regardless of `include` patterns and cannot be
disabled by configuration. Files skipped by a secret pattern are reported as
warnings in sync output.

## Classification rules

Rules apply in order after built-in heuristics; the last matching rule wins
for each field it sets. Frontmatter `kind:`/`authority:`/`status:` in a
document are honored between heuristics and config rules. A document whose
status resolves to superseded/deprecated is always demoted to `historical`.

## Claude Code filesystem access

When sources point outside the repository, the MCP server process needs OS
read access to those paths, and Claude Code needs permission to expose them —
add the directories as additional working directories (`--add-dir` or the
`additionalDirectories` setting) or approve the access prompts.
