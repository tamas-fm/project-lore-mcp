import picomatch from "picomatch";
import { posix } from "node:path";
import type { ClassificationRule } from "./config.js";
import type {
  AuthorityLevel,
  DocumentKind,
  DocumentStatus,
} from "./types.js";
import type { ParsedDocument } from "./parse.js";

export interface Classification {
  kind: DocumentKind;
  authority: AuthorityLevel;
  status: DocumentStatus;
  scope: string;
}

const STATUS_RE = /^\s*(?:\*\*|__)?status(?:\*\*|__)?\s*[:=]\s*(.+?)\s*$/im;

function parseStatus(doc: ParsedDocument): DocumentStatus {
  const fmStatus = doc.frontmatter["status"];
  const raw =
    typeof fmStatus === "string"
      ? fmStatus
      : (doc.body.slice(0, 2_000).match(STATUS_RE)?.[1] ?? "");
  const s = raw.toLowerCase();
  if (/supersed/.test(s)) return "superseded";
  if (/deprecat|rejected|obsolete|archiv/.test(s)) return "deprecated";
  if (/draft|proposed/.test(s)) return "draft";
  if (/accept|active|approved|current|final/.test(s)) return "active";
  return "unknown";
}

interface DefaultRule {
  match: (relPath: string, base: string) => boolean;
  kind: DocumentKind;
  authority: AuthorityLevel;
}

const DEFAULT_RULES: DefaultRule[] = [
  {
    match: (_, base) => base === "claude.md" || base === "agents.md",
    kind: "claude_instructions",
    authority: "instruction",
  },
  {
    match: (p, base) =>
      /(^|\/)(adr|adrs|decisions)\//.test(p) || /^\d{3,4}-.+\.md$/.test(base),
    kind: "adr",
    authority: "canonical",
  },
  {
    match: (p, base) => base.includes("manifest") || /(^|\/)00-/.test(p),
    kind: "manifest",
    authority: "canonical",
  },
  {
    match: (_, base) => base === "readme.md" || base === "readme.txt",
    kind: "readme",
    authority: "canonical",
  },
  {
    match: (p) => /(^|\/)architecture/.test(p) || /architecture\.md$/.test(p),
    kind: "architecture",
    authority: "canonical",
  },
  {
    match: (_, base) =>
      base === "todo.md" || base === "roadmap.md" || base === "plan.md",
    kind: "plan",
    authority: "planning",
  },
  {
    match: (p) => /(^|\/)(plans|planning|roadmap)\//.test(p),
    kind: "plan",
    authority: "planning",
  },
  {
    match: (p) => /(^|\/)(archive|legacy|deprecated|old)\//.test(p),
    kind: "unknown",
    authority: "historical",
  },
  {
    match: (p) => /(^|\/)(ux|flows?)\//.test(p) || /ux-|-flow\.md$/.test(p),
    kind: "ux",
    authority: "design",
  },
  {
    match: (p) => /(^|\/)(product|intent|psychology)/.test(p),
    kind: "product",
    authority: "canonical",
  },
  {
    match: (p) => /(^|\/)design\//.test(p),
    kind: "design",
    authority: "design",
  },
  {
    match: (p) => /(^|\/)runbooks?\//.test(p),
    kind: "runbook",
    authority: "design",
  },
  {
    match: (p) => /\.(mmd|mermaid)$/.test(p),
    kind: "diagram",
    authority: "design",
  },
];

/**
 * Deterministic classification. Precedence: config rules (highest) →
 * frontmatter hints → built-in path heuristics → source default authority.
 * Superseded/deprecated status always demotes authority to historical.
 */
export function classify(
  relPath: string,
  doc: ParsedDocument,
  sourceDefaultAuthority: AuthorityLevel,
  configRules: ClassificationRule[],
): Classification {
  const base = posix.basename(relPath).toLowerCase();
  const lower = relPath.toLowerCase();

  let kind: DocumentKind = "unknown";
  let authority: AuthorityLevel | null = null;

  for (const rule of DEFAULT_RULES) {
    if (rule.match(lower, base)) {
      kind = rule.kind;
      authority = rule.authority;
      break;
    }
  }

  const fmKind = doc.frontmatter["kind"];
  if (typeof fmKind === "string" && isDocumentKind(fmKind)) kind = fmKind;
  const fmAuthority = doc.frontmatter["authority"];
  if (typeof fmAuthority === "string" && isAuthorityLevel(fmAuthority)) {
    authority = fmAuthority;
  }

  for (const rule of configRules) {
    if (picomatch(rule.pattern, { dot: true })(relPath)) {
      if (rule.kind) kind = rule.kind;
      if (rule.authority) authority = rule.authority;
    }
  }

  const status = parseStatus(doc);
  let resolved = authority ?? sourceDefaultAuthority;
  if (status === "superseded" || status === "deprecated") resolved = "historical";

  // Scoped instructions: a nested CLAUDE.md governs only its directory.
  const scope =
    kind === "claude_instructions" ? posix.dirname(relPath).replace(/^\.$/, "") : "";

  return { kind, authority: resolved, status, scope };
}

const DOCUMENT_KINDS = new Set([
  "claude_instructions", "readme", "adr", "architecture", "design", "product",
  "ux", "manifest", "plan", "runbook", "api", "reference", "diagram", "unknown",
]);
const AUTHORITY_LEVELS = new Set([
  "instruction", "canonical", "design", "navigational", "planning",
  "historical", "generated", "proposed",
]);

function isDocumentKind(v: string): v is DocumentKind {
  return DOCUMENT_KINDS.has(v);
}
function isAuthorityLevel(v: string): v is AuthorityLevel {
  return AUTHORITY_LEVELS.has(v);
}
