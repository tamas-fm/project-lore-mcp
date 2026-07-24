import { describe, expect, it } from "vitest";
import { parseMarkdown, redactSecrets } from "../src/parse.js";

describe("parseMarkdown", () => {
  it("splits sections on h1–h3 and records line ranges", () => {
    const doc = parseMarkdown(
      "# Title\nintro\n\n## Second\nbody text\n\n### Third\ndeep\n\n#### Fourth\nstays inside third\n",
      "fallback",
    );
    expect(doc.title).toBe("Title");
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toEqual(["Title", "Second", "Third"]);
    const third = doc.sections[2];
    expect(third?.text).toContain("stays inside third");
    expect(third?.headingPath).toBe("Title > Second > Third");
    expect(third?.startLine).toBe(7);
  });

  it("keeps preamble before the first heading as an implicit section", () => {
    const doc = parseMarkdown("Just some text.\n\n# Later\nbody\n", "f");
    expect(doc.sections[0]?.heading).toBe("(preamble)");
    expect(doc.sections[0]?.text).toBe("Just some text.");
  });

  it("parses frontmatter and prefers its title", () => {
    const doc = parseMarkdown(
      "---\ntitle: FM Title\nstatus: superseded\n---\n# Body Title\ntext\n",
      "f",
    );
    expect(doc.title).toBe("FM Title");
    expect(doc.frontmatter["status"]).toBe("superseded");
    expect(doc.bodyLineOffset).toBe(4);
  });

  it("extracts links with line numbers and ignores links in code fences", () => {
    const doc = parseMarkdown(
      "# T\nsee [a](docs/a.md)\n```\n[not-a-link](skip.md)\n```\n[b](b.md)\n",
      "f",
    );
    expect(doc.links).toEqual([
      { text: "a", target: "docs/a.md", line: 2 },
      { text: "b", target: "b.md", line: 6 },
    ]);
  });

  it("ignores headings inside code fences", () => {
    const doc = parseMarkdown("# Real\n```\n# fake heading\n```\n", "f");
    expect(doc.sections.map((s) => s.heading)).toEqual(["Real"]);
  });

  it("falls back to plain text on malformed frontmatter", () => {
    const doc = parseMarkdown("---\n: bad: [yaml\n---\n# T\nx\n", "fallback");
    expect(doc.sections.length).toBeGreaterThan(0);
  });
});

describe("redactSecrets", () => {
  it("redacts common credential shapes", () => {
    const input = [
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "key sk-ABCDEFGHIJKLMNOPQRSTuvwx",
      "aws AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = redactSecrets(input);
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("sk-ABCDEF");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(4);
  });

  it("leaves ordinary prose untouched", () => {
    const text = "Use the skeleton-key pattern for feature flags.";
    expect(redactSecrets(text)).toBe(text);
  });
});
