# ADR-0001: Independent companion server, not a fork

Status: Accepted

## Context

The documentation layer could have been built as a fork of, or plugin inside,
codebase-memory-mcp. During discovery the locally configured
codebase-memory-mcp binary was missing entirely, its source and license were
not locally inspectable, and only its MCP tool surface is public.

## Decision

Build an independent MCP server with its own repository, package identity,
data model, and release cycle. Integration with code-intelligence tools goes
exclusively through the `CodeIntelligenceProvider` interface, implemented in
v1 only by a null fallback. Users run both servers side by side; no
MCP-to-MCP orchestration in the first milestone.

## Consequences

- Useful with zero external dependencies; degraded provider = documentation-
  only answers, not failure.
- No coupling to undocumented internals, forks to maintain, or license
  entanglement.
- Cross-referencing code and documentation evidence in one answer is deferred
  until an adapter exists (preconditions recorded in
  docs/integrations/codebase-memory.md).
