import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContextEngine } from "../src/engine.js";
import { routeTask, searchKnowledge, toFtsQuery } from "../src/retrieval.js";
import { exampleEngine } from "./helpers.js";

let engine: ContextEngine;
beforeAll(() => {
  engine = exampleEngine();
});
afterAll(() => engine.close());

describe("toFtsQuery", () => {
  it("quotes terms and drops stopwords", () => {
    expect(toFtsQuery("Why must the premium UI use gold?")).toBe(
      '"premium" OR "ui" OR "gold"',
    );
  });
  it("returns empty string for stopword-only input", () => {
    expect(toFtsQuery("why is the")).toBe("");
  });
});

describe("searchKnowledge", () => {
  it("ranks the product-intent doc first for the gold question", () => {
    const results = searchKnowledge(engine, "Why must premium UI use gold sparingly?", 5);
    expect(results[0]?.path).toBe("docs/product/intent.md");
    expect(results[0]?.heading).toContain("Premium restraint");
    expect(results[0]?.basis).toBe("documented");
  });

  it("ranks the accepted ADR above the superseded one for persistence", () => {
    const results = searchKnowledge(engine, "Which ADR governs local persistence?", 6);
    const paths = results.map((r) => r.path);
    const accepted = paths.indexOf("docs/adr/0002-sqlite-local-persistence.md");
    const superseded = paths.indexOf("docs/adr/0001-plist-local-persistence.md");
    expect(accepted).toBeGreaterThanOrEqual(0);
    if (superseded >= 0) expect(accepted).toBeLessThan(superseded);
  });

  it("marks the legacy auth design as stale", () => {
    const results = searchKnowledge(engine, "old authentication cookie design", 6);
    const legacy = results.find((r) => r.path === "docs/legacy/auth-design.md");
    expect(legacy).toBeDefined();
    expect(legacy?.freshness).toBe("stale");
    expect(legacy?.status).toBe("superseded");
  });

  it("surfaces scoped mobile instructions with their scope", () => {
    const results = searchKnowledge(engine, "Which animation API is forbidden?", 5);
    const mobile = results.find((r) => r.path === "mobile/CLAUDE.md");
    expect(mobile).toBeDefined();
    expect(mobile?.scope).toBe("mobile");
    expect(mobile?.authority).toBe("instruction");
  });

  it("finds documents from the configured external source", () => {
    const results = searchKnowledge(engine, "brand voice quiet gold", 6);
    expect(results.some((r) => r.sourceId === "design-handoff")).toBe(true);
  });

  it("bounds excerpt size and is deterministic", () => {
    const a = searchKnowledge(engine, "premium gold entitlement", 8);
    const b = searchKnowledge(engine, "premium gold entitlement", 8);
    expect(a.map((r) => r.documentId)).toEqual(b.map((r) => r.documentId));
    for (const r of a) {
      expect(r.excerpt.length).toBeLessThanOrEqual(engine.limits.maxExcerptChars + 1);
    }
  });

  it("returns nothing for unmatched topics instead of guessing", () => {
    expect(searchKnowledge(engine, "kubernetes ingress helm chart", 5)).toEqual([]);
  });
});

describe("routeTask", () => {
  it("routes an onboarding task through the explicit manifest route, in listed order", () => {
    const result = routeTask(engine, "Implement a new animated mobile onboarding screen", 6);
    expect(result.matchedRoute).toMatchObject({
      taskPattern: "Add a new mobile onboarding screen",
      manifestPath: "docs/00-manifest.md",
    });
    expect(result.documents.slice(0, 4).map((d) => d.path)).toEqual([
      "docs/ux/onboarding-flow.md",
      "docs/design/colors.md",
      "docs/design/typography.md",
      "docs/design/mobile-motion.md",
    ]);
    expect(result.documents[0]?.reason).toContain("explicit task route");
  });

  it("routes table-matrix tasks", () => {
    const result = routeTask(engine, "Persist or migrate data", 4);
    expect(result.matchedRoute?.taskPattern).toBe("Persist or migrate data");
    expect(result.documents[0]?.path).toBe("docs/adr/0002-sqlite-local-persistence.md");
  });

  it("falls back to ranked search with an explicit note when no route matches", () => {
    const result = routeTask(engine, "Investigate premium entitlement checks", 4);
    expect(result.matchedRoute).toBeNull();
    expect(result.notes.some((n) => n.includes("No explicit manifest route"))).toBe(true);
    expect(result.documents.length).toBeGreaterThan(0);
  });
});
