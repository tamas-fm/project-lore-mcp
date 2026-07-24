# Contributing

Thanks for considering a contribution.

## Setup

```bash
npm install
npm test          # full suite, must pass
npm run typecheck # strict TypeScript, no `any`
npm run eval      # deterministic retrieval benchmark
```

Node ≥ 22 required. No other services or containers are needed — the index is
plain SQLite.

## Ground rules

- **Deterministic first.** New extraction must be rule-based and record
  provenance. AI-derived enrichment, if ever added, must be opt-in and marked
  `ai_proposed` — it can never be stored as documented fact.
- **Bounded outputs.** Tools return sections and excerpts, never whole files.
- **Security defaults are non-negotiable:** no network access in core paths,
  no shell execution from document content, secret exclusion and redaction
  stay on, symlink-escape protection stays on.
- **Tests are behavior tests.** A change to ranking, parsing, or freshness
  needs an eval or unit case that fails without it. `test/eval.test.ts` is the
  retrieval quality gate.
- **Every dependency needs a reason.** Prefer the standard library; record
  significant choices as ADRs in `docs/adr/`.

## Making changes

1. Branch from `main` (`feature/...`, `fix/...`).
2. Add or update tests alongside code.
3. `npm test && npm run typecheck` must pass.
4. Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:` …).
5. Write an ADR when you add a dependency, change a core mechanism, or make a
   deliberate trade-off.

## Extension points

- **Code-intelligence providers** — implement `CodeIntelligenceProvider`
  (`src/types.ts`); see `docs/integrations/codebase-memory.md`.
- **Classification** — built-in heuristics live in `src/classify.ts`; user
  overrides go through `classification.rules` in configuration, not new
  hard-coded conventions.
- **Retrieval** — scoring is isolated in `src/retrieval.ts`; embeddings, if
  ever added, belong behind an interface and off by default.

## Reporting issues

Use the issue templates. For anything security-sensitive, see
[SECURITY.md](SECURITY.md) — do not open a public issue.
