import { describe, expect, it } from "vitest";
import { extractRelationHints, extractTaskRoutes } from "../src/manifest.js";
import { parseMarkdown } from "../src/parse.js";

describe("extractTaskRoutes", () => {
  it("extracts a Task: heading followed by a read-first list, in order", () => {
    const doc = parseMarkdown(
      [
        "# Manifest",
        "## Task: Build a new mobile screen",
        "Read first:",
        "- [Brand](design/brand.md)",
        "- [Colors](design/colors.md)",
        "- [Motion](design/motion.md)",
      ].join("\n"),
      "f",
    );
    const routes = extractTaskRoutes(doc);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.taskPattern).toBe("Build a new mobile screen");
    expect(routes[0]?.targets).toEqual([
      "design/brand.md",
      "design/colors.md",
      "design/motion.md",
    ]);
  });

  it("extracts task→document rows from a matrix table", () => {
    const doc = parseMarkdown(
      [
        "# Manifest",
        "## Matrix",
        "| Task | Read |",
        "| ---- | ---- |",
        "| Persist data | [ADR-2](adr/0002.md) |",
        "| Touch auth | [Arch](architecture.md), [ADR-3](adr/0003.md) |",
      ].join("\n"),
      "f",
    );
    const routes = extractTaskRoutes(doc);
    expect(routes.map((r) => r.taskPattern)).toEqual(["Persist data", "Touch auth"]);
    expect(routes[1]?.targets).toEqual(["architecture.md", "adr/0003.md"]);
  });

  it("skips external URLs and anchors", () => {
    const doc = parseMarkdown(
      "## Task: Deploy\n- [runbook](https://example.com/x)\n- [local](#anchor)\n",
      "f",
    );
    expect(extractTaskRoutes(doc)).toHaveLength(0);
  });
});

describe("extractRelationHints", () => {
  it("extracts read-first, depends-on, and supersedes labels", () => {
    const doc = parseMarkdown(
      [
        "# Doc",
        "Read first:",
        "- [a](a.md)",
        "- [b](b.md)",
        "",
        "Depends on: [c](c.md)",
        "",
        "Supersedes: [old](old.md)",
      ].join("\n"),
      "f",
    );
    const hints = extractRelationHints(doc);
    expect(hints).toEqual([
      { target: "a.md", type: "read_before", line: 3 },
      { target: "b.md", type: "read_before", line: 4 },
      { target: "c.md", type: "depends_on", line: 6 },
      { target: "old.md", type: "supersedes", line: 8 },
    ]);
  });

  it("reads supersedes from frontmatter", () => {
    const doc = parseMarkdown("---\nsupersedes: docs/old.md\n---\n# D\n", "f");
    expect(extractRelationHints(doc)).toContainEqual({
      target: "docs/old.md",
      type: "supersedes",
      line: 1,
    });
  });

  it("does not attribute unrelated list links to a stale label", () => {
    const doc = parseMarkdown(
      "# D\nRead first:\n- [a](a.md)\n\nOther prose here.\n- [b](b.md)\n",
      "f",
    );
    const hints = extractRelationHints(doc);
    expect(hints.map((h) => h.target)).toEqual(["a.md"]);
  });
});
