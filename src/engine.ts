import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import type { ProjectConfig } from "./config.js";
import { expandPath } from "./config.js";
import { IndexStore, PARSER_VERSION } from "./db.js";
import { parseMarkdown, type ParsedDocument } from "./parse.js";
import { classify } from "./classify.js";
import { extractRelationHints, extractTaskRoutes } from "./manifest.js";
import { scanSource, type ScannedFile } from "./scan.js";
import type {
  DocumentRecord,
  DocumentRelation,
  Freshness,
  SectionRecord,
  TaskRoute,
} from "./types.js";

export interface SyncStats {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  routes: number;
  relations: number;
  warnings: string[];
}

interface ParsedEntry {
  file: ScannedFile;
  doc: DocumentRecord;
  parsed: ParsedDocument;
  changed: boolean;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function documentId(sourceId: string, relPath: string): string {
  return sha256(`${sourceId}\0${relPath}`).slice(0, 16);
}

/**
 * Resolves a link target written in `fromPath` to a normalized in-source
 * relative path, or null for external/anchor/query links.
 */
export function resolveLinkTarget(fromPath: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
  const clean = target.split("#")[0]?.split("?")[0] ?? "";
  if (!clean) return null;
  const resolved = posix.normalize(
    clean.startsWith("/") ? clean.slice(1) : posix.join(posix.dirname(fromPath), clean),
  );
  if (resolved.startsWith("..")) return null; // never escapes the source root
  return resolved;
}

/**
 * The core engine: owns the SQLite index and exposes sync + lookups.
 * Transport-independent — the MCP server, CLI, and tests all drive this.
 */
export class ContextEngine {
  readonly store: IndexStore;
  private readonly config: ProjectConfig;
  private unavailableSources = new Set<string>();
  private lastSyncMs = 0;
  /** Minimum interval between opportunistic re-syncs (debounce). */
  private static readonly RESYNC_INTERVAL_MS = 2_000;

  constructor(config: ProjectConfig, dbPathOverride?: string) {
    this.config = config;
    const dbPath =
      dbPathOverride ?? expandPath(config.storage.path, config.rootDir);
    this.store = new IndexStore(dbPath);
  }

  /** Re-syncs at most every few seconds; called before serving any query. */
  ensureFresh(): void {
    if (Date.now() - this.lastSyncMs > ContextEngine.RESYNC_INTERVAL_MS) {
      this.sync();
    }
  }

  sync(): SyncStats {
    const stats: SyncStats = {
      scanned: 0, added: 0, updated: 0, removed: 0,
      routes: 0, relations: 0, warnings: [],
    };
    const now = new Date().toISOString();
    const existing = new Map(
      this.store.listDocuments().map((d) => [`${d.sourceId}\0${d.path}`, d]),
    );
    const seen = new Set<string>();
    const entries: ParsedEntry[] = [];
    this.unavailableSources = new Set();

    for (const source of this.config.sources) {
      const result = scanSource(source, this.config.rootDir, this.config.limits.maxFileBytes);
      stats.warnings.push(...result.warnings);
      if (result.warnings.some((w) => w.includes("missing or inaccessible"))) {
        this.unavailableSources.add(source.id);
      }
      for (const file of result.files) {
        stats.scanned += 1;
        const key = `${file.sourceId}\0${file.relPath}`;
        seen.add(key);

        let raw: string;
        try {
          raw = readFileSync(file.absPath, "utf8");
        } catch (err) {
          stats.warnings.push(`Cannot read ${file.relPath}: ${(err as Error).message}`);
          continue;
        }
        const contentHash = sha256(raw);
        const prior = existing.get(key);
        const changed =
          !prior ||
          prior.contentHash !== contentHash ||
          prior.parserVersion !== PARSER_VERSION;

        const parsed = parseMarkdown(raw, posix.basename(file.relPath));
        const cls = classify(
          file.relPath, parsed, source.authority, this.config.classification.rules,
        );
        const doc: DocumentRecord = {
          id: documentId(file.sourceId, file.relPath),
          sourceId: file.sourceId,
          path: file.relPath,
          title: parsed.title,
          kind: cls.kind,
          authority: cls.authority,
          status: cls.status,
          scope: cls.scope,
          contentHash,
          modifiedAt: new Date(file.mtimeMs).toISOString(),
          indexedAt: prior && !changed ? prior.indexedAt : now,
          parserVersion: PARSER_VERSION,
        };
        entries.push({ file, doc, parsed, changed });
      }
    }

    for (const entry of entries) {
      if (!entry.changed) continue;
      const isNew = !existing.has(`${entry.doc.sourceId}\0${entry.doc.path}`);
      const sections: SectionRecord[] = entry.parsed.sections.map((s) => ({
        id: `${entry.doc.id}:${s.startLine}`,
        documentId: entry.doc.id,
        heading: s.heading,
        headingPath: s.headingPath,
        level: s.level,
        startLine: s.startLine + entry.parsed.bodyLineOffset,
        endLine: s.endLine + entry.parsed.bodyLineOffset,
        text: s.text,
      }));
      this.store.upsertDocument(entry.doc, sections);
      if (isNew) stats.added += 1;
      else stats.updated += 1;
    }

    for (const [key, doc] of existing) {
      if (!seen.has(key) && !this.unavailableSources.has(doc.sourceId)) {
        this.store.removeDocument(doc.id);
        stats.removed += 1;
      }
    }

    this.rebuildDerived(entries, stats);
    this.store.setMeta("last_sync", now);
    this.lastSyncMs = Date.now();
    return stats;
  }

  /**
   * Relations and task routes are cheap to derive, so they are rebuilt
   * wholesale each sync — this keeps cross-document links correct when
   * targets appear, move, or disappear. Document/FTS rows stay incremental.
   */
  private rebuildDerived(entries: ParsedEntry[], stats: SyncStats): void {
    const db = this.store.db;
    db.exec("DELETE FROM relations; DELETE FROM task_route_documents; DELETE FROM task_routes;");

    const byPath = new Map(entries.map((e) => [`${e.doc.sourceId}\0${e.doc.path}`, e.doc]));
    const resolveDoc = (sourceId: string, fromPath: string, target: string) => {
      const resolved = resolveLinkTarget(fromPath, target);
      return resolved ? (byPath.get(`${sourceId}\0${resolved}`) ?? null) : null;
    };

    for (const { doc, parsed, file } of entries) {
      const seenRel = new Set<string>();
      const addRelation = (rel: DocumentRelation): void => {
        const k = `${rel.sourceDocumentId}\0${rel.targetDocumentId}\0${rel.type}`;
        if (seenRel.has(k) || rel.sourceDocumentId === rel.targetDocumentId) return;
        seenRel.add(k);
        this.store.insertRelation(rel);
        stats.relations += 1;
      };

      for (const hint of extractRelationHints(parsed)) {
        const target = resolveDoc(file.sourceId, doc.path, hint.target);
        if (!target) continue;
        addRelation({
          sourceDocumentId: doc.id,
          targetDocumentId: target.id,
          type: hint.type,
          extractionMethod: "explicit",
          confidence: 1,
          provenance: {
            type: "deterministic",
            extractor: "relation-labels",
            source: { path: doc.path, startLine: hint.line },
          },
        });
      }

      for (const link of parsed.links) {
        const target = resolveDoc(file.sourceId, doc.path, link.target);
        if (!target) continue;
        addRelation({
          sourceDocumentId: doc.id,
          targetDocumentId: target.id,
          type: "references",
          extractionMethod: "deterministic",
          confidence: 0.8,
          provenance: {
            type: "deterministic",
            extractor: "markdown-links",
            source: { path: doc.path, startLine: link.line },
          },
        });
      }

      if (doc.kind === "manifest") {
        for (const route of extractTaskRoutes(parsed)) {
          const documentIds = route.targets
            .map((t) => resolveDoc(file.sourceId, doc.path, t)?.id)
            .filter((id): id is string => Boolean(id));
          if (documentIds.length === 0) continue;
          const taskRoute: TaskRoute = {
            id: sha256(`${doc.id}\0${route.taskPattern}`).slice(0, 16),
            taskPattern: route.taskPattern,
            documentIds,
            ordering: "listed",
            sourceDocumentId: doc.id,
            provenance: {
              type: "source",
              documentId: doc.id,
              location: {
                path: doc.path,
                startLine: route.startLine,
                heading: route.heading,
              },
            },
          };
          this.store.insertTaskRoute(taskRoute);
          stats.routes += 1;
        }
      }
    }
  }

  /**
   * Freshness rules (deterministic, documented in docs/architecture.md):
   * - source root missing → unavailable
   * - status superseded/deprecated → stale
   * - a document this one references/depends on changed more recently → potentially_stale
   * - otherwise fresh (the index re-syncs before every query).
   */
  freshness(doc: DocumentRecord): { freshness: Freshness; reason?: string } {
    if (this.unavailableSources.has(doc.sourceId)) {
      return { freshness: "unavailable", reason: `Source "${doc.sourceId}" is not accessible.` };
    }
    if (doc.status === "superseded" || doc.status === "deprecated") {
      return { freshness: "stale", reason: `Document status is ${doc.status}.` };
    }
    for (const rel of this.store.relationsFor(doc.id)) {
      if (rel.sourceDocumentId !== doc.id) continue;
      if (!["references", "depends_on", "read_with"].includes(rel.type)) continue;
      const target = this.store.getDocument(rel.targetDocumentId);
      // 2s tolerance: bulk operations (git checkout, formatters) touch many
      // files near-simultaneously without a meaningful ordering.
      if (
        target &&
        Date.parse(target.modifiedAt) > Date.parse(doc.modifiedAt) + 2_000
      ) {
        return {
          freshness: "potentially_stale",
          reason: `Referenced document ${target.path} changed after this document was last modified.`,
        };
      }
    }
    return { freshness: "fresh" };
  }

  get limits(): ProjectConfig["limits"] {
    return this.config.limits;
  }

  close(): void {
    this.store.close();
  }
}
