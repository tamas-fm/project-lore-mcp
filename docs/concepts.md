# Concepts

## Documents, sections, and excerpts

A **document** is one file in a configured source, classified by kind
(instructions, ADR, manifest, architecture, design, product, UX, plan, …) and
split into **sections** on h1–h3 headings. Retrieval returns sections as
bounded **excerpts** with exact path and line locations. The retrieval goal is
not maximum context — it is *the smallest evidence set likely to answer the
question or guide the task correctly*.

## Authority

Not every file is equally authoritative. The default hierarchy (strongest
first):

1. `instruction` — explicit agent/project instructions (CLAUDE.md, imports)
2. `canonical` — accepted ADRs, canonical architecture/product docs, manifests
3. `design` — implementation-specific design documents
4. `navigational` — indexes and tables of contents
5. `planning` — TODO files, plans, roadmaps
6. `historical` — superseded or archived material
7. `generated` — machine-generated summaries
8. `proposed` — agent-created proposals awaiting human review

Authority comes from deterministic defaults (path/name/status heuristics),
can be set per-source, and is overridable per-pattern via
`classification.rules` — no organization's conventions are hard-coded. A
superseded or deprecated status always demotes a document to `historical`.

## Scope

A nested `CLAUDE.md` governs only its directory subtree. Its `scope` field
records that; scoped instructions are never flattened into global rules, and
results display scope so an agent knows when a rule does not apply.

## Relationships and task routes

Documents relate through typed edges: `references`, `depends_on`,
`read_before`, `read_with`, `supersedes`, `implements`, `governs`. v1 extracts
these deterministically from Markdown links, labeled lines ("Read first:",
"Depends on:", "Supersedes:"), and frontmatter.

A **manifest** may declare task routes — "for this task, read these documents
in this order" — either as a `## Task: <pattern>` heading over a link list, or
as a task/documents table. Routes are first-class: `route_task` returns the
manifest's listed order verbatim rather than hoping similarity search
reconstructs it.

## Provenance

Every stored relationship records how it was obtained (`source`,
`configuration`, `deterministic`, `ai_proposed`, `human_approved`) and where.
Results distinguish **documented** facts (quoted from a source) from
**derived** structure (extracted deterministically). Nothing AI-inferred can
be silently promoted to documented fact — see
[provenance-and-trust.md](provenance-and-trust.md).

## Freshness

Documents and answers age. Content hashing plus relationship traversal yields
four states — `fresh`, `potentially_stale`, `stale`, `unavailable` — reported
with reasons. Stale sources are returned with warnings, never silently dropped:
knowing that a conclusion may be outdated is itself project knowledge.

## Investigation records (designed, not yet implemented)

A future milestone adds durable, evidence-backed investigation records:
YAML files in Git containing a question, an answer, cited evidence, and the
commit at which they were verified. They become stale when their evidence
changes and are only ever created as `proposed` for human review. The v1 data
model (provenance, hashes, authority) is designed so these can be added
without schema breakage.
