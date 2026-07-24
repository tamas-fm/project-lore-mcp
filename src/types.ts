/**
 * Core domain model. Everything stored in the index is derived from these
 * types; every stored assertion carries {@link Provenance}.
 */

export type AuthorityLevel =
  | "instruction" // explicit agent/project instructions (CLAUDE.md and imports)
  | "canonical" // accepted ADRs, canonical architecture/product docs, manifests
  | "design" // implementation-specific design docs
  | "navigational" // indexes, tables of contents
  | "planning" // TODO files, plans, roadmaps
  | "historical" // superseded or archived documents
  | "generated" // machine-generated summaries
  | "proposed"; // agent-created proposals awaiting review

/** Higher weight = stronger authority in ranking. */
export const AUTHORITY_WEIGHT: Record<AuthorityLevel, number> = {
  instruction: 100,
  canonical: 90,
  design: 70,
  navigational: 60,
  planning: 50,
  historical: 20,
  generated: 15,
  proposed: 10,
};

export type DocumentKind =
  | "claude_instructions"
  | "readme"
  | "adr"
  | "architecture"
  | "design"
  | "product"
  | "ux"
  | "manifest"
  | "plan"
  | "runbook"
  | "api"
  | "reference"
  | "diagram"
  | "unknown";

export type DocumentStatus =
  | "active"
  | "draft"
  | "superseded"
  | "deprecated"
  | "unknown";

export type Freshness =
  | "fresh"
  | "potentially_stale"
  | "stale"
  | "unavailable";

export interface SourceLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  heading?: string;
}

export type Provenance =
  | { type: "source"; documentId: string; location: SourceLocation }
  | { type: "configuration"; configPath: string }
  | { type: "deterministic"; extractor: string; source: SourceLocation }
  | { type: "ai_proposed"; model?: string; createdAt: string }
  | { type: "human_approved"; approvedAt: string };

export interface DocumentRecord {
  id: string;
  sourceId: string;
  /** Path relative to the source root, POSIX separators. */
  path: string;
  title: string;
  kind: DocumentKind;
  authority: AuthorityLevel;
  status: DocumentStatus;
  /**
   * Directory scope for scoped instructions (e.g. a nested CLAUDE.md applies
   * only under its directory). Empty string = whole source.
   */
  scope: string;
  contentHash: string;
  modifiedAt: string;
  indexedAt: string;
  parserVersion: number;
}

export interface SectionRecord {
  id: string;
  documentId: string;
  heading: string;
  /** "H1 > H2 > H3" breadcrumb. */
  headingPath: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
}

export type RelationType =
  | "references"
  | "depends_on"
  | "read_before"
  | "read_with"
  | "supersedes"
  | "implements"
  | "governs";

export type ExtractionMethod =
  | "explicit"
  | "configured"
  | "deterministic"
  | "ai_proposed"
  | "human_approved";

export interface DocumentRelation {
  sourceDocumentId: string;
  targetDocumentId: string;
  type: RelationType;
  extractionMethod: ExtractionMethod;
  confidence: number;
  provenance: Provenance;
}

export interface TaskRoute {
  id: string;
  taskPattern: string;
  /** Ordered document ids as listed by the manifest. */
  documentIds: string[];
  ordering: "listed" | "ranked";
  sourceDocumentId: string;
  provenance: Provenance;
}

/**
 * Optional code-intelligence integration boundary. v1 ships only
 * {@link src/providers/null.ts}; see docs/integrations/codebase-memory.md
 * for how a real adapter plugs in.
 */
export interface CodeSearchQuery {
  query: string;
  limit?: number;
}

export interface CodeSearchResult {
  path: string;
  symbol?: string;
  excerpt?: string;
  providerId: string;
}

export interface CodeIntelligenceProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  searchCode(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
}
