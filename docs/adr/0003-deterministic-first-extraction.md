# ADR-0003: Deterministic extraction before AI inference

Status: Accepted

## Context

Document understanding could lean on an LLM or embedding model from day one.
That would make indexing non-reproducible, slow on modest hardware, costly,
and — worst — would blur the line between what a document says and what a
model guessed it says. The core product promise is evidence-backed answers.

## Decision

v1 extraction is entirely rule-based: headings, sections, links, frontmatter,
ADR status lines, labeled relationships ("Read first:", "Depends on:",
"Supersedes:"), manifest task routes (heading and table forms), content
hashes, and Claude-instruction scope. Every stored assertion records a
`Provenance`; retrieval results carry `basis: documented | derived`. No LLM,
no embeddings, no network access in the core.

AI enrichment, if added later, must be opt-in, marked `ai_proposed`, and can
reach `human_approved` only through explicit review. Embeddings, if added
later, sit behind a retrieval interface and remain optional.

## Consequences

- Fully reproducible index and benchmark; `test/eval.test.ts` is a hard gate.
- Zero-cost, offline, fast on an M1 Pro with 16 GB RAM.
- Recall is bounded by explicit structure and keywords — documents with no
  structure and no manifest route only surface via full-text search. This is
  the accepted price of trustworthy answers; manifests are the documented
  escape hatch.
