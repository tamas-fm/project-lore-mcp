/**
 * Deterministic evaluation benchmark over examples/documented-project.
 * Each case encodes an expected retrieval outcome for a representative
 * question; failures here mean retrieval quality regressed. Run alone with
 * `npm run eval`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContextEngine } from "../src/engine.js";
import { routeTask, searchKnowledge } from "../src/retrieval.js";
import { exampleEngine } from "./helpers.js";

let engine: ContextEngine;
beforeAll(() => {
  engine = exampleEngine();
});
afterAll(() => engine.close());

describe("evaluation: routing", () => {
  it("Q1: which documents before adding an onboarding screen? (ordered manifest route)", () => {
    const r = routeTask(engine, "Add a new animated onboarding screen for mobile", 6);
    expect(r.matchedRoute?.manifestPath).toBe("docs/00-manifest.md");
    expect(r.documents.slice(0, 4).map((d) => d.path)).toEqual([
      "docs/ux/onboarding-flow.md",
      "docs/design/colors.md",
      "docs/design/typography.md",
      "docs/design/mobile-motion.md",
    ]);
    // Compactness: routed results quote sections, never whole files.
    const totalChars = r.documents.reduce((n, d) => n + d.excerpt.length, 0);
    expect(totalChars).toBeLessThan(6 * engine.limits.maxExcerptChars);
  });

  it("Q2: why must this interaction avoid urgency? (product intent)", () => {
    const results = searchKnowledge(engine, "Why avoid urgency mechanics and countdowns?", 4);
    expect(results[0]?.path).toBe("docs/product/intent.md");
    expect(results[0]?.heading).toContain("No urgency");
    expect(results[0]?.authority).toBe("canonical");
  });

  it("Q3: which ADR governs local persistence? (accepted over superseded)", () => {
    const results = searchKnowledge(engine, "ADR local persistence sqlite decision", 5);
    expect(results[0]?.path).toBe("docs/adr/0002-sqlite-local-persistence.md");
  });

  it("Q4: is the old authentication design still authoritative? (stale + conflict visible)", () => {
    const results = searchKnowledge(engine, "authentication cookie refresh token design", 6);
    const legacy = results.find((r) => r.path === "docs/legacy/auth-design.md");
    const current = results.find((r) => r.path === "docs/architecture.md");
    expect(legacy?.freshness).toBe("stale");
    expect(legacy?.authority).toBe("historical");
    expect(current).toBeDefined();
    // The current doc must outrank the superseded one.
    expect(results.indexOf(current!)).toBeLessThan(results.indexOf(legacy!));
  });

  it("Q5: which rule applies only to the mobile package? (scoped instructions)", () => {
    const results = searchKnowledge(engine, "reanimated animation rule", 5);
    const scoped = results.find((r) => r.scope === "mobile");
    expect(scoped?.path).toBe("mobile/CLAUDE.md");
  });

  it("Q6: where is the intended emotional progression documented?", () => {
    const results = searchKnowledge(engine, "intended emotional progression onboarding", 4);
    expect(results.some((r) => r.path === "docs/product/intent.md" && r.heading.includes("Emotional progression"))).toBe(true);
  });

  it("Q7: external brand doc is retrievable and identified by source", () => {
    const results = searchKnowledge(engine, "brand gold earned moments", 5);
    const external = results.find((r) => r.sourceId === "design-handoff");
    expect(external?.path).toBe("brand-manifest.md");
  });

  it("Q8: results are reproducible across engines (deterministic index)", () => {
    const other = exampleEngine();
    const q = "premium gold sparingly";
    expect(searchKnowledge(other, q, 6).map((r) => `${r.sourceId}:${r.path}`)).toEqual(
      searchKnowledge(engine, q, 6).map((r) => `${r.sourceId}:${r.path}`),
    );
    other.close();
  });
});
