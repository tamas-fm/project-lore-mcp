import { utimesSync, symlinkSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { tempProject, type TempProject } from "./helpers.js";

let project: TempProject | null = null;
afterEach(() => {
  project?.cleanup();
  project = null;
});

describe("ContextEngine.sync", () => {
  it("indexes, then skips unchanged files, updates changed, removes deleted", () => {
    project = tempProject();
    project.write("README.md", "# Hello\nWorld\n");
    project.write("docs/a.md", "# A\nAlpha\n");
    const engine = project.engine();

    const first = engine.sync();
    expect(first).toMatchObject({ scanned: 2, added: 2, updated: 0, removed: 0 });

    const second = engine.sync();
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 0 });

    project.write("docs/a.md", "# A\nAlpha changed\n");
    const third = engine.sync();
    expect(third).toMatchObject({ added: 0, updated: 1 });

    rmSync(join(project.root, "docs/a.md"));
    const fourth = engine.sync();
    expect(fourth).toMatchObject({ removed: 1 });
    expect(engine.store.listDocuments().map((d) => d.path)).toEqual(["README.md"]);
    engine.close();
  });

  it("resolves relative links to relations with provenance", () => {
    project = tempProject();
    project.write("docs/a.md", "# A\nsee [b](../guides/b.md)\n");
    project.write("guides/b.md", "# B\ntext\n");
    const engine = project.engine();
    engine.sync();

    const a = engine.store.getDocumentByPath("repository", "docs/a.md");
    expect(a).not.toBeNull();
    const rels = engine.store.relationsFor(a!.id);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({
      type: "references",
      extractionMethod: "deterministic",
    });
    expect(rels[0]?.provenance).toMatchObject({ type: "deterministic", extractor: "markdown-links" });
    engine.close();
  });

  it("marks a document potentially stale when a referenced document is newer", () => {
    project = tempProject();
    const aPath = project.write("a.md", "# A\nDepends on: [b](b.md)\n");
    const bPath = project.write("b.md", "# B\ntext\n");
    const past = new Date(Date.now() - 60_000);
    utimesSync(aPath, past, past);
    utimesSync(bPath, new Date(), new Date());

    const engine = project.engine();
    engine.sync();
    const a = engine.store.getDocumentByPath("repository", "a.md")!;
    const b = engine.store.getDocumentByPath("repository", "b.md")!;
    expect(engine.freshness(a).freshness).toBe("potentially_stale");
    expect(engine.freshness(b).freshness).toBe("fresh");
    engine.close();
  });

  it("never indexes secret files and redacts embedded tokens", () => {
    project = tempProject();
    project.write(".env", "API_KEY=supersecret\n");
    project.write("credentials.md", "password: hunter2\n");
    project.write("docs/setup.md", "# Setup\ntoken ghp_abcdefghijklmnopqrstuvwxyz0123456789\n");
    const engine = project.engine();
    engine.sync();

    const paths = engine.store.listDocuments().map((d) => d.path);
    expect(paths).toEqual(["docs/setup.md"]);
    const sections = engine.store.getSections(
      engine.store.getDocumentByPath("repository", "docs/setup.md")!.id,
    );
    expect(sections.map((s) => s.text).join()).not.toContain("ghp_");
    engine.close();
  });

  it("skips symlinks that escape the source root, with a warning", () => {
    project = tempProject();
    project.write("inside.md", "# Inside\n");
    const outside = mkdtempSync(join(tmpdir(), "pcm-outside-"));
    writeFileSync(join(outside, "leak.md"), "# Secret outside doc\n");
    symlinkSync(join(outside, "leak.md"), join(project.root, "leak.md"));

    const engine = project.engine();
    const stats = engine.sync();
    expect(engine.store.listDocuments().map((d) => d.path)).toEqual(["inside.md"]);
    expect(stats.warnings.some((w) => w.includes("symlink"))).toBe(true);
    engine.close();
    rmSync(outside, { recursive: true, force: true });
  });

  it("terminates and warns on a self-referential directory symlink", () => {
    project = tempProject();
    project.write("docs/a.md", "# A\n");
    // docs/loop -> docs/ (points back to its own parent)
    symlinkSync(join(project.root, "docs"), join(project.root, "docs/loop"));

    const engine = project.engine();
    const stats = engine.sync();
    // Must complete without hanging.
    expect(stats.warnings.some((w) => w.includes("cycle"))).toBe(true);
    // The real file is still indexed.
    expect(engine.store.listDocuments().map((d) => d.path)).toContain("docs/a.md");
    engine.close();
  });

  it("terminates and warns on a symlink pointing to an ancestor directory", () => {
    project = tempProject();
    project.write("sub/doc.md", "# Doc\n");
    // sub/up -> ..  (points to the project root)
    symlinkSync(project.root, join(project.root, "sub/up"));

    const engine = project.engine();
    const stats = engine.sync();
    expect(stats.warnings.some((w) => w.includes("cycle"))).toBe(true);
    // sub/doc.md still indexed; no duplicates.
    const paths = engine.store.listDocuments().map((d) => d.path);
    expect(paths).toContain("sub/doc.md");
    expect(paths.length).toBe(paths.filter((p, i) => paths.indexOf(p) === i).length);
    engine.close();
  });

  it("does not duplicate files when a sibling directory symlink points to an already-visited directory", () => {
    project = tempProject();
    project.write("actual/a.md", "# A\n");
    project.write("actual/b.md", "# B\n");
    // alias -> actual/ (non-circular, but already visited)
    symlinkSync(join(project.root, "actual"), join(project.root, "alias"));

    const engine = project.engine();
    const stats = engine.sync();
    // Files should be indexed exactly once (2 docs, not 4).
    expect(engine.store.listDocuments().length).toBe(2);
    // A cycle warning is produced for the skipped alias.
    expect(stats.warnings.some((w) => w.includes("cycle"))).toBe(true);
    engine.close();
  });

  it("skips oversized files with a warning", () => {
    project = tempProject();
    project.write("big.md", `# Big\n${"x".repeat(2_000_000)}\n`);
    project.write("small.md", "# Small\n");
    const engine = project.engine();
    const stats = engine.sync();
    expect(engine.store.listDocuments().map((d) => d.path)).toEqual(["small.md"]);
    expect(stats.warnings.some((w) => w.includes("oversized"))).toBe(true);
    engine.close();
  });

  it("warns about a missing external source instead of failing", () => {
    project = tempProject();
    project.write("README.md", "# R\n");
    project.write(
      "project-lore.config.yaml",
      [
        "sources:",
        "  - id: repository",
        "    type: directory",
        "    path: .",
        "  - id: missing",
        "    type: directory",
        "    path: ../does-not-exist-anywhere",
      ].join("\n"),
    );
    mkdirSync(join(project.root, "sub"), { recursive: true });
    const engine = project.engine();
    const stats = engine.sync();
    expect(stats.warnings.some((w) => w.includes("missing or inaccessible"))).toBe(true);
    expect(engine.store.listDocuments().length).toBeGreaterThan(0);
    engine.close();
  });
});
