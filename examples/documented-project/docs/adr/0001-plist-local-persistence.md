# ADR-0001: Property-list files for local persistence

Status: Superseded by ADR-0002

## Context

Early prototypes stored habit data in property-list files for simplicity.

## Decision

Persist habit data as plist files in the app documents directory.

## Consequences

Simple to ship, but no query capability and fragile migrations. Replaced —
see [ADR-0002](0002-sqlite-local-persistence.md).
