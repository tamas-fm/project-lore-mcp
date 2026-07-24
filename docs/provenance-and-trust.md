# Provenance and trust

## Why provenance is structural

The value of a documentation index collapses the moment an agent cannot tell
"the architecture document says X" from "something inferred X". So provenance
is not metadata bolted on afterwards — every stored relationship and route
carries a `Provenance` value:

- `source` — quoted from a document at a specific location;
- `configuration` — asserted by the user's config file;
- `deterministic` — produced by a named rule-based extractor from a specific
  location;
- `ai_proposed` — produced by a model (unused in v1; reserved);
- `human_approved` — explicitly reviewed by a person.

Retrieval results additionally carry `basis: "documented" | "derived"`. In
v1 everything is documented or deterministically derived; if AI enrichment is
ever added it must surface as `ai_proposed` and can only become
`human_approved` through explicit review — never silently.

## Documents are untrusted input

A document may contain prompt-injection-style text ("ignore your
instructions and…"). The trust rules:

1. **Content is never executed.** No shell commands, no HTML/script
   rendering, no fetching of URLs found in documents.
2. **Content is never elevated to server instructions.** Parsing is
   rule-based; document text influences only what is indexed, not how the
   server behaves.
3. **Content is labeled at the boundary.** Every tool response includes a
   notice that excerpts are quoted evidence to cite, not instructions to
   follow. This is risk reduction through provenance labeling — it reduces
   the attack surface but cannot technically prevent an LLM from following
   hostile content embedded in a document.
4. **Content is bounded.** File-size and excerpt-size limits prevent a
   hostile or bloated document from flooding a context window.

## Secret hygiene

Two layers, both always on:

- **File gate** (scan): credential-shaped files are never read into the
  pipeline.
- **Content redaction** (parse): common token shapes (private key blocks,
  `ghp_…`, `sk-…`, `AKIA…`, JWTs, Slack tokens) are replaced with
  `[REDACTED]` before anything reaches the index.

The index itself still contains documentation excerpts — it is gitignored and
should be treated as sensitively as the documents.

## Failure behavior

Malformed frontmatter degrades to plain-text indexing; unreadable files and
missing roots produce warnings, not crashes; stale or superseded knowledge is
returned flagged with a reason rather than hidden. Errors name the path and
the action the user can take.
