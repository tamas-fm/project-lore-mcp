# Integration: codebase-memory-mcp

## Today: coexistence (recommended, zero coupling)

Configure both servers independently in your MCP client:

```bash
claude mcp add codebase-memory -- codebase-memory-mcp
claude mcp add project-lore -- node /path/to/project-lore-mcp/dist/cli.js serve --root .
```

The client's model composes them naturally: structural questions ("who calls
this?") go to codebase-memory; intent questions ("which document governs
this task? why was this decided?") come here. Nothing in this server requires
the other to be installed, and vice versa. This is deliberate — see
[ADR-0001](../adr/0001-independent-companion-server.md).

## Later: an optional adapter

The `CodeIntelligenceProvider` interface (`src/types.ts`) is the only
integration surface:

```ts
interface CodeIntelligenceProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  searchCode(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
}
```

An adapter would let retrieval attach code evidence to documented claims —
e.g. `explain_project_rule` citing both `docs/architecture.md` and the
function that implements the rule. The intended shape:

1. **Spawn codebase-memory-mcp as an MCP client connection** (stdio), calling
   only its published tools (`search_code`, `get_code_snippet`, …). MCP tools
   are its public surface; its internal storage and APIs are not, and must
   not be depended on.
2. Register the adapter behind a config flag (`providers: [codebase-memory]`),
   default off.
3. `isAvailable()` probes the connection once and caches; every retrieval
   path treats `false`/errors as "documentation-only answer", identical to
   the null provider. No feature may require the provider.

## Preconditions before building the adapter

Recorded here so the work starts honestly:

- **Verify the tool surface against an installed version** — tool names and
  schemas must come from its live `tools/list`, not from memory. (At the time
  of writing, the locally configured binary was missing entirely — exactly the
  degraded mode this design must survive.)
- **Verify its license** permits this use and record the finding here. No
  source is copied either way; the integration is protocol-level only.
- **Pin a tested version range** and skip the adapter cleanly on mismatch.

Until those hold, the null provider ships and documentation-only answers are
the contract.
