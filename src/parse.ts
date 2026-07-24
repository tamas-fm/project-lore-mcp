import matter from "gray-matter";

export interface ParsedSection {
  heading: string;
  headingPath: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ParsedLink {
  /** Link target exactly as written (before resolution). */
  target: string;
  text: string;
  line: number;
}

export interface ParsedDocument {
  title: string;
  frontmatter: Record<string, unknown>;
  sections: ParsedSection[];
  links: ParsedLink[];
  /** Full body with frontmatter stripped and secrets redacted. */
  body: string;
  /** Line offset of body start within the original file (frontmatter lines). */
  bodyLineOffset: number;
}

/**
 * Redacts common credential shapes so secrets never enter the index even when
 * a document unexpectedly embeds them. Deliberately conservative patterns.
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|rk)-[A-Za-z0-9_-]{20,}\b/g, // API secret keys (OpenAI/Stripe style)
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Deterministic Markdown parser: frontmatter via gray-matter, sections split
 * on ATX headings (h1–h3 create sections; deeper headings stay inside their
 * parent section), links collected with line numbers. No HTML rendering, no
 * script execution — input is treated as untrusted text.
 */
export function parseMarkdown(raw: string, fallbackTitle: string): ParsedDocument {
  let fm: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    fm = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Malformed frontmatter: index the file as plain text rather than failing.
  }
  body = redactSecrets(body);
  const bodyLineOffset = raw.split("\n").length - body.split("\n").length;

  const lines = body.split("\n");
  const sections: ParsedSection[] = [];
  const links: ParsedLink[] = [];
  const crumb: string[] = [];

  let current: ParsedSection | null = null;
  let inFence = false;

  const push = (endLine: number): void => {
    if (!current) return;
    current.endLine = endLine;
    current.text = lines
      .slice(current.startLine - 1, endLine)
      .join("\n")
      .trim();
    if (current.text.length > 0) sections.push(current);
    current = null;
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;

    const heading = inFence ? null : line.match(HEADING_RE);
    if (heading && heading[1] && heading[2] && heading[1].length <= 3) {
      push(i);
      const level = heading[1].length;
      crumb.length = level - 1;
      crumb[level - 1] = heading[2];
      current = {
        heading: heading[2],
        headingPath: crumb.filter(Boolean).join(" > "),
        level,
        startLine: lineNo,
        endLine: lineNo,
        text: "",
      };
    }

    if (!inFence) {
      for (const m of line.matchAll(LINK_RE)) {
        const target = m[2] ?? "";
        if (target.length > 0) {
          links.push({ text: m[1] ?? "", target, line: lineNo });
        }
      }
    }
  });
  push(lines.length);

  // Preamble before the first heading becomes an implicit section.
  const firstHeadingStart = sections[0]?.startLine ?? lines.length + 1;
  const preamble = lines.slice(0, firstHeadingStart - 1).join("\n").trim();
  if (preamble.length > 0) {
    sections.unshift({
      heading: "(preamble)",
      headingPath: "(preamble)",
      level: 0,
      startLine: 1,
      endLine: firstHeadingStart - 1,
      text: preamble,
    });
  }

  const fmTitle = typeof fm["title"] === "string" ? (fm["title"] as string) : undefined;
  const h1 = sections.find((s) => s.level === 1)?.heading;
  return {
    title: fmTitle ?? h1 ?? fallbackTitle,
    frontmatter: fm,
    sections,
    links,
    body,
    bodyLineOffset,
  };
}
