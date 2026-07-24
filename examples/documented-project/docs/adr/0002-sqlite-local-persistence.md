# ADR-0002: SQLite for local persistence

Status: Accepted

Supersedes: [ADR-0001](0001-plist-local-persistence.md)

## Context

Habit history needs querying (streak computation, statistics) and reliable
migrations. Plist storage (ADR-0001) cannot support either.

## Decision

Use SQLite as the only local persistence mechanism. Schema migrations are
versioned and forward-only.

## Consequences

- All new features persist through the shared database module.
- No feature may introduce ad-hoc file storage.
