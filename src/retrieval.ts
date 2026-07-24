import type { ContextEngine } from "./engine.js";
import {
  AUTHORITY_WEIGHT,
  type DocumentRecord,
  type Freshness,
  type SectionRecord,
} from "./types.js";

export interface EvidenceResult {
  documentId: string;
  path: string;
  sourceId: string;
  title: string;
  kind: string;
  authority: string;
  status: string;
  scope: string;
  freshness: Freshness;
  freshnessReason?: string;
  heading: string;
  startLine: number;
  endLine: number;
  /** Bounded quotation of the relevant section. Untrusted document content. */
  excerpt: string;
  excerptTruncated: boolean;
  /** Why this result was selected. */
  reason: string;
  /** "documented" = quoted from source; "derived" = deterministic extraction. */
  basis: "documented" | "derived";
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
  "how", "i", "in", "is", "it", "must", "my", "new", "of", "on", "or", "should",
  "that", "the", "this", "to", "use", "we", "what", "when", "where", "which",
  "why", "will", "with",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Builds a safe FTS5 OR-query from free text (terms are quoted). */
export function toFtsQuery(text: string): string {
  const terms = [...new Set(tokenize(text))].slice(0, 12);
  return terms.map((t) => `"${t.replaceAll('"', "")}"`).join(" OR ");
}

function excerptOf(
  section: SectionRecord,
  maxChars: number,
): { excerpt: string; truncated: boolean } {
  const text = section.text;
  if (text.length <= maxChars) return { excerpt: text, truncated: false };
  return { excerpt: `${text.slice(0, maxChars)}…`, truncated: true };
}

function statusPenalty(doc: DocumentRecord): number {
  // Superseded/deprecated docs are already demoted to "historical" authority
  // during classification; penalizing status again would bury them even for
  // queries that explicitly ask about them.
  if (doc.status === "draft") return 0.8;
  return 1;
}

export function toResult(
  engine: ContextEngine,
  doc: DocumentRecord,
  section: SectionRecord,
  reason: string,
  basis: EvidenceResult["basis"],
): EvidenceResult {
  const { freshness, reason: freshnessReason } = engine.freshness(doc);
  const { excerpt, truncated } = excerptOf(section, engine.limits.maxExcerptChars);
  return {
    documentId: doc.id,
    path: doc.path,
    sourceId: doc.sourceId,
    title: doc.title,
    kind: doc.kind,
    authority: doc.authority,
    status: doc.status,
    scope: doc.scope,
    freshness,
    ...(freshnessReason ? { freshnessReason } : {}),
    heading: section.headingPath || section.heading,
    startLine: section.startLine,
    endLine: section.endLine,
    excerpt,
    excerptTruncated: truncated,
    reason,
    basis,
  };
}

/**
 * Hybrid search: FTS5 (bm25) recall, re-ranked by authority weight, document
 * status, freshness, and exact title/heading matches. Returns at most one
 * section per document.
 */
export function searchKnowledge(
  engine: ContextEngine,
  query: string,
  limit: number,
): EvidenceResult[] {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const hits = engine.store.searchSections(ftsQuery, limit * 6);
  const queryTokens = new Set(tokenize(query));

  const scored = hits.map(({ section, rank }) => {
    const doc = engine.store.getDocument(section.documentId);
    if (!doc) return null;
    // bm25 rank is negative (more negative = better match).
    let score = -rank;
    score *= AUTHORITY_WEIGHT[doc.authority] / 100;
    score *= statusPenalty(doc);
    const titleTokens = new Set(tokenize(`${doc.title} ${section.headingPath}`));
    const overlap = [...queryTokens].filter((t) => titleTokens.has(t)).length;
    score *= 1 + 0.35 * overlap;
    return { doc, section, score };
  });

  const byDoc = new Map<string, { doc: DocumentRecord; section: SectionRecord; score: number }>();
  for (const hit of scored) {
    if (!hit) continue;
    const prev = byDoc.get(hit.doc.id);
    if (!prev || hit.score > prev.score) byDoc.set(hit.doc.id, hit);
  }

  return [...byDoc.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, section }) =>
      toResult(
        engine, doc, section,
        `Full-text match in "${section.headingPath || doc.title}" (authority: ${doc.authority}).`,
        "documented",
      ),
    );
}

export interface RouteResultDocument extends EvidenceResult {
  position: number;
}

export interface RouteTaskResult {
  matchedRoute: {
    taskPattern: string;
    manifestPath: string;
    manifestHeading?: string;
    matchScore: number;
  } | null;
  documents: RouteResultDocument[];
  notes: string[];
}

function routeMatchScore(taskTokens: Set<string>, pattern: string): number {
  const patternTokens = tokenize(pattern);
  if (patternTokens.length === 0) return 0;
  const hit = patternTokens.filter((t) => taskTokens.has(t)).length;
  return hit / patternTokens.length;
}

const ROUTE_MATCH_THRESHOLD = 0.4;

/**
 * Task routing: explicit manifest routes first (preserved in listed order),
 * then ranked search fills the remaining slots. Explicit routes are never
 * reordered by similarity — the manifest's ordering is the documented intent.
 */
export function routeTask(
  engine: ContextEngine,
  task: string,
  limit: number,
): RouteTaskResult {
  const taskTokens = new Set(tokenize(task));
  const notes: string[] = [];
  const documents: RouteResultDocument[] = [];
  const seenDocs = new Set<string>();

  const routes = engine.store
    .listTaskRoutes()
    .map((route) => ({ route, score: routeMatchScore(taskTokens, route.taskPattern) }))
    .filter((r) => r.score >= ROUTE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const best = routes[0] ?? null;
  let matchedRoute: RouteTaskResult["matchedRoute"] = null;

  if (best) {
    const manifest = engine.store.getDocument(best.route.sourceDocumentId);
    const loc =
      best.route.provenance.type === "source"
        ? best.route.provenance.location
        : undefined;
    matchedRoute = {
      taskPattern: best.route.taskPattern,
      manifestPath: manifest?.path ?? "(unknown)",
      ...(loc?.heading ? { manifestHeading: loc.heading } : {}),
      matchScore: Number(best.score.toFixed(2)),
    };
    best.route.documentIds.forEach((docId, i) => {
      if (documents.length >= limit || seenDocs.has(docId)) return;
      const doc = engine.store.getDocument(docId);
      if (!doc) return;
      const section = bestSectionForTask(engine, docId, taskTokens);
      if (!section) return;
      seenDocs.add(docId);
      documents.push({
        ...toResult(
          engine, doc, section,
          `Listed by explicit task route "${best.route.taskPattern}" in ${manifest?.path ?? "manifest"}.`,
          "documented",
        ),
        position: i + 1,
      });
    });
  } else {
    notes.push(
      "No explicit manifest route matched this task; results below are ranked search only. " +
        "If this task is common, consider documenting a route in a manifest.",
    );
  }

  if (documents.length < limit) {
    for (const result of searchKnowledge(engine, task, limit * 2)) {
      if (documents.length >= limit) break;
      if (seenDocs.has(result.documentId)) continue;
      seenDocs.add(result.documentId);
      documents.push({ ...result, position: documents.length + 1 });
    }
  }

  const staleCount = documents.filter(
    (d) => d.freshness === "stale" || d.freshness === "potentially_stale",
  ).length;
  if (staleCount > 0) {
    notes.push(
      `${staleCount} result(s) are stale or potentially stale — verify against their freshnessReason before relying on them.`,
    );
  }

  return { matchedRoute, documents, notes };
}

/** Prefers the section most lexically related to the task; falls back to the first section. */
function bestSectionForTask(
  engine: ContextEngine,
  documentId: string,
  taskTokens: Set<string>,
): SectionRecord | null {
  const sections = engine.store.getSections(documentId);
  if (sections.length === 0) return null;
  let best = sections[0] ?? null;
  let bestScore = 0;
  for (const s of sections) {
    const tokens = tokenize(`${s.headingPath} ${s.text.slice(0, 400)}`);
    const score = tokens.filter((t) => taskTokens.has(t)).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
