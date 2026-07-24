import type { ParsedDocument, ParsedSection } from "./parse.js";

export interface ExtractedRoute {
  taskPattern: string;
  /** Ordered link targets as written in the manifest (unresolved paths). */
  targets: string[];
  heading: string;
  startLine: number;
}

export interface ExtractedRelationHint {
  /** Unresolved link target. */
  target: string;
  type: "read_before" | "read_with" | "depends_on" | "supersedes";
  line: number;
}

const LINK_TARGET_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TASK_HEADING_RE = /^task\s*[:\-–]\s*(.+)$/i;
const RELATION_LABELS: Array<[RegExp, ExtractedRelationHint["type"]]> = [
  [/^read\s*(?:this\s*)?first\b/i, "read_before"],
  [/^read\s*with\b|^pairs?\s*with\b/i, "read_with"],
  [/^depends?\s*on\b/i, "depends_on"],
  [/^supersedes\b|^replaces\b/i, "supersedes"],
];

function linkTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LINK_TARGET_RE)) {
    const t = m[1] ?? "";
    if (t && !/^[a-z]+:\/\//i.test(t) && !t.startsWith("#")) out.push(t);
  }
  return out;
}

/**
 * Extracts explicit task→document routes from a manifest-style document.
 * Two deterministic shapes are recognized:
 *
 * 1. A heading `## Task: <pattern>` followed by list items containing local
 *    links (optionally introduced by "Read first:").
 * 2. A two-column Markdown table whose header row contains "task" in the
 *    first column; each row maps the task text to the links in later columns.
 */
export function extractTaskRoutes(doc: ParsedDocument): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  for (const section of doc.sections) {
    const m = section.heading.match(TASK_HEADING_RE);
    if (m && m[1]) {
      const targets = linkTargets(section.text);
      if (targets.length > 0) {
        routes.push({
          taskPattern: m[1].trim(),
          targets,
          heading: section.heading,
          startLine: section.startLine,
        });
      }
    }
    routes.push(...tableRoutes(section));
  }
  return routes;
}

function tableRoutes(section: ParsedSection): ExtractedRoute[] {
  const lines = section.text.split("\n");
  const routes: ExtractedRoute[] = [];
  let headerSeen = false;
  lines.forEach((line, i) => {
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 2) return;
    if (!headerSeen) {
      if (/^task/i.test(cells[0] ?? "")) headerSeen = true;
      return;
    }
    if (/^[-: ]+$/.test(cells[0] ?? "")) return; // separator row
    const targets = linkTargets(cells.slice(1).join(" "));
    const task = (cells[0] ?? "").replace(/\*\*/g, "").trim();
    if (task && targets.length > 0) {
      routes.push({
        taskPattern: task,
        targets,
        heading: section.heading,
        startLine: section.startLine + i,
      });
    }
  });
  return routes;
}

/**
 * Extracts explicit "Read first" / "Pairs with" / "Depends on" / "Supersedes"
 * relationships from any document. A labeled line claims the links on that
 * line and on immediately following list-item lines.
 */
export function extractRelationHints(doc: ParsedDocument): ExtractedRelationHint[] {
  const hints: ExtractedRelationHint[] = [];
  const lines = doc.body.split("\n");
  let active: ExtractedRelationHint["type"] | null = null;

  lines.forEach((line, i) => {
    const stripped = line.replace(/^[\s>*-]+/, "").replace(/\*\*/g, "").trim();
    const label = RELATION_LABELS.find(([re]) => re.test(stripped));
    const isListItem = /^\s*[-*]\s+/.test(line);

    if (label) {
      active = label[1];
      for (const target of linkTargets(line)) {
        hints.push({ target, type: active, line: i + 1 });
      }
    } else if (active && isListItem) {
      for (const target of linkTargets(line)) {
        hints.push({ target, type: active, line: i + 1 });
      }
    } else if (stripped.length > 0 && !isListItem) {
      active = null;
    }
  });

  const fmSupersedes = doc.frontmatter["supersedes"];
  if (typeof fmSupersedes === "string" && fmSupersedes.trim()) {
    hints.push({ target: fmSupersedes.trim(), type: "supersedes", line: 1 });
  }
  return hints;
}
