import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DocumentRecord,
  DocumentRelation,
  SectionRecord,
  TaskRoute,
} from "./types.js";

/** Bump when schema or parsing output changes shape → triggers full rebuild. */
export const SCHEMA_VERSION = 1;
export const PARSER_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  authority TEXT NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  modified_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  parser_version INTEGER NOT NULL,
  UNIQUE (source_id, path)
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  level INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_doc ON sections(document_id);

CREATE TABLE IF NOT EXISTS relations (
  source_document_id TEXT NOT NULL,
  target_document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance TEXT NOT NULL,
  PRIMARY KEY (source_document_id, target_document_id, type)
);

CREATE TABLE IF NOT EXISTS task_routes (
  id TEXT PRIMARY KEY,
  task_pattern TEXT NOT NULL,
  ordering TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  provenance TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_route_documents (
  route_id TEXT NOT NULL REFERENCES task_routes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  PRIMARY KEY (route_id, position)
);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  section_id UNINDEXED,
  document_id UNINDEXED,
  title,
  heading,
  body,
  tokenize = 'porter unicode61'
);
`;

export class IndexStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version !== 0 && version !== SCHEMA_VERSION) {
      // Index data is regenerable: on schema change, rebuild from scratch.
      this.db.exec(`
        DROP TABLE IF EXISTS sections_fts;
        DROP TABLE IF EXISTS task_route_documents;
        DROP TABLE IF EXISTS task_routes;
        DROP TABLE IF EXISTS relations;
        DROP TABLE IF EXISTS sections;
        DROP TABLE IF EXISTS documents;
        DROP TABLE IF EXISTS meta;
      `);
    }
    this.db.exec(SCHEMA);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  listDocuments(): DocumentRecord[] {
    return (this.db.prepare("SELECT * FROM documents").all() as DocRow[]).map(
      rowToDocument,
    );
  }

  getDocumentByPath(sourceId: string, path: string): DocumentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE source_id = ? AND path = ?")
      .get(sourceId, path) as DocRow | undefined;
    return row ? rowToDocument(row) : null;
  }

  getDocument(id: string): DocumentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE id = ?")
      .get(id) as DocRow | undefined;
    return row ? rowToDocument(row) : null;
  }

  getSections(documentId: string): SectionRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM sections WHERE document_id = ? ORDER BY start_line")
        .all(documentId) as SectionRow[]
    ).map(rowToSection);
  }

  /** Replaces a document and all derived rows atomically. */
  upsertDocument(doc: DocumentRecord, sections: SectionRecord[]): void {
    this.db.transaction(() => {
      this.deleteDocumentRows(doc.id);
      this.db
        .prepare(
          `INSERT INTO documents
           (id, source_id, path, title, kind, authority, status, scope,
            content_hash, modified_at, indexed_at, parser_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, kind=excluded.kind, authority=excluded.authority,
             status=excluded.status, scope=excluded.scope,
             content_hash=excluded.content_hash, modified_at=excluded.modified_at,
             indexed_at=excluded.indexed_at, parser_version=excluded.parser_version`,
        )
        .run(
          doc.id, doc.sourceId, doc.path, doc.title, doc.kind, doc.authority,
          doc.status, doc.scope, doc.contentHash, doc.modifiedAt, doc.indexedAt,
          doc.parserVersion,
        );
      const insertSection = this.db.prepare(
        `INSERT INTO sections (id, document_id, heading, heading_path, level, start_line, end_line, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.db.prepare(
        `INSERT INTO sections_fts (section_id, document_id, title, heading, body)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const s of sections) {
        insertSection.run(
          s.id, s.documentId, s.heading, s.headingPath, s.level,
          s.startLine, s.endLine, s.text,
        );
        insertFts.run(s.id, s.documentId, doc.title, s.headingPath, s.text);
      }
    })();
  }

  removeDocument(documentId: string): void {
    this.db.transaction(() => {
      this.deleteDocumentRows(documentId);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    })();
  }

  private deleteDocumentRows(documentId: string): void {
    this.db.prepare("DELETE FROM sections WHERE document_id = ?").run(documentId);
    this.db
      .prepare("DELETE FROM sections_fts WHERE document_id = ?")
      .run(documentId);
    this.db
      .prepare(
        "DELETE FROM relations WHERE source_document_id = ? OR target_document_id = ?",
      )
      .run(documentId, documentId);
    const routeIds = this.db
      .prepare("SELECT id FROM task_routes WHERE source_document_id = ?")
      .all(documentId) as Array<{ id: string }>;
    for (const { id } of routeIds) {
      this.db.prepare("DELETE FROM task_route_documents WHERE route_id = ?").run(id);
      this.db.prepare("DELETE FROM task_routes WHERE id = ?").run(id);
    }
  }

  insertRelation(rel: DocumentRelation): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO relations
         (source_document_id, target_document_id, type, extraction_method, confidence, provenance)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rel.sourceDocumentId, rel.targetDocumentId, rel.type,
        rel.extractionMethod, rel.confidence, JSON.stringify(rel.provenance),
      );
  }

  relationsFor(documentId: string): DocumentRelation[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM relations WHERE source_document_id = ? OR target_document_id = ?",
        )
        .all(documentId, documentId) as RelationRow[]
    ).map(rowToRelation);
  }

  insertTaskRoute(route: TaskRoute): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO task_routes (id, task_pattern, ordering, source_document_id, provenance)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          route.id, route.taskPattern, route.ordering, route.sourceDocumentId,
          JSON.stringify(route.provenance),
        );
      this.db.prepare("DELETE FROM task_route_documents WHERE route_id = ?").run(route.id);
      const insert = this.db.prepare(
        "INSERT INTO task_route_documents (route_id, position, document_id) VALUES (?, ?, ?)",
      );
      route.documentIds.forEach((docId, i) => insert.run(route.id, i, docId));
    })();
  }

  listTaskRoutes(): TaskRoute[] {
    const routes = this.db.prepare("SELECT * FROM task_routes").all() as RouteRow[];
    const docsStmt = this.db.prepare(
      "SELECT document_id FROM task_route_documents WHERE route_id = ? ORDER BY position",
    );
    return routes.map((r) => ({
      id: r.id,
      taskPattern: r.task_pattern,
      ordering: r.ordering as TaskRoute["ordering"],
      sourceDocumentId: r.source_document_id,
      provenance: JSON.parse(r.provenance) as TaskRoute["provenance"],
      documentIds: (docsStmt.all(r.id) as Array<{ document_id: string }>).map(
        (d) => d.document_id,
      ),
    }));
  }

  searchSections(
    ftsQuery: string,
    limit: number,
  ): Array<{ section: SectionRecord; rank: number }> {
    const rows = this.db
      .prepare(
        `SELECT s.*, f.rank AS fts_rank
         FROM sections_fts f
         JOIN sections s ON s.id = f.section_id
         WHERE sections_fts MATCH ?
         ORDER BY f.rank
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as Array<SectionRow & { fts_rank: number }>;
    return rows.map((r) => ({ section: rowToSection(r), rank: r.fts_rank }));
  }

  close(): void {
    this.db.close();
  }
}

interface DocRow {
  id: string; source_id: string; path: string; title: string; kind: string;
  authority: string; status: string; scope: string; content_hash: string;
  modified_at: string; indexed_at: string; parser_version: number;
}
interface SectionRow {
  id: string; document_id: string; heading: string; heading_path: string;
  level: number; start_line: number; end_line: number; text: string;
}
interface RelationRow {
  source_document_id: string; target_document_id: string; type: string;
  extraction_method: string; confidence: number; provenance: string;
}
interface RouteRow {
  id: string; task_pattern: string; ordering: string;
  source_document_id: string; provenance: string;
}

function rowToDocument(r: DocRow): DocumentRecord {
  return {
    id: r.id, sourceId: r.source_id, path: r.path, title: r.title,
    kind: r.kind as DocumentRecord["kind"],
    authority: r.authority as DocumentRecord["authority"],
    status: r.status as DocumentRecord["status"],
    scope: r.scope, contentHash: r.content_hash, modifiedAt: r.modified_at,
    indexedAt: r.indexed_at, parserVersion: r.parser_version,
  };
}
function rowToSection(r: SectionRow): SectionRecord {
  return {
    id: r.id, documentId: r.document_id, heading: r.heading,
    headingPath: r.heading_path, level: r.level, startLine: r.start_line,
    endLine: r.end_line, text: r.text,
  };
}
function rowToRelation(r: RelationRow): DocumentRelation {
  return {
    sourceDocumentId: r.source_document_id,
    targetDocumentId: r.target_document_id,
    type: r.type as DocumentRelation["type"],
    extractionMethod: r.extraction_method as DocumentRelation["extractionMethod"],
    confidence: r.confidence,
    provenance: JSON.parse(r.provenance) as DocumentRelation["provenance"],
  };
}
