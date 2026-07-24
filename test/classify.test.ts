import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.js";
import { parseMarkdown } from "../src/parse.js";

const parsed = (raw: string) => parseMarkdown(raw, "f");

describe("classify", () => {
  it("classifies CLAUDE.md as scoped instructions", () => {
    const root = classify("CLAUDE.md", parsed("# Rules"), "canonical", []);
    expect(root).toMatchObject({
      kind: "claude_instructions",
      authority: "instruction",
      scope: "",
    });
    const nested = classify("mobile/CLAUDE.md", parsed("# Rules"), "canonical", []);
    expect(nested.scope).toBe("mobile");
  });

  it("classifies ADRs and parses status lines", () => {
    const accepted = classify(
      "docs/adr/0002-sqlite.md",
      parsed("# ADR-0002\n\nStatus: Accepted\n"),
      "canonical",
      [],
    );
    expect(accepted).toMatchObject({ kind: "adr", authority: "canonical", status: "active" });

    const superseded = classify(
      "docs/adr/0001-plist.md",
      parsed("# ADR-0001\n\nStatus: Superseded by ADR-0002\n"),
      "canonical",
      [],
    );
    expect(superseded.status).toBe("superseded");
    expect(superseded.authority).toBe("historical");
  });

  it("honors frontmatter status", () => {
    const c = classify(
      "docs/design/x.md",
      parsed("---\nstatus: deprecated\n---\n# X\n"),
      "canonical",
      [],
    );
    expect(c.status).toBe("deprecated");
    expect(c.authority).toBe("historical");
  });

  it("applies config rules over built-in heuristics", () => {
    const c = classify("docs/legacy/auth.md", parsed("# Old"), "canonical", [
      { pattern: "docs/legacy/**", authority: "historical" },
    ]);
    expect(c.authority).toBe("historical");
  });

  it("classifies plans and manifests", () => {
    expect(classify("TODO.md", parsed("# TODO"), "canonical", []).authority).toBe("planning");
    expect(classify("docs/00-manifest.md", parsed("# M"), "canonical", []).kind).toBe("manifest");
  });

  it("falls back to the source default authority", () => {
    const c = classify("notes/random.md", parsed("# N"), "design", []);
    expect(c.authority).toBe("design");
    expect(c.kind).toBe("unknown");
  });
});
