import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a type-scale token beside a colour class", () => {
    // The default tailwind-merge cannot tell `text-label` from a colour, so it
    // used to drop it here and leave the element at its inherited size —
    // silently, and on every card surface at once.
    expect(cn("text-label font-bold", "text-muted-foreground")).toContain("text-label");
    expect(cn("text-meta font-semibold text-muted-foreground")).toContain("text-meta");
    expect(cn("text-badge", "text-primary")).toContain("text-badge");
    expect(cn("text-card-name text-primary")).toContain("text-card-name");
  });

  it("still lets one size win over another", () => {
    expect(cn("text-label", "text-badge")).toBe("text-badge");
    expect(cn("text-xs", "text-meta")).toBe("text-meta");
  });

  it("still merges everything it always did", () => {
    // A variable rather than a literal `false`: the point is that clsx drops a
    // falsy branch, and eslint reads `false && x` as a constant expression.
    const hidden = false;
    expect(cn("px-2", "px-3")).toBe("px-3");
    expect(cn("text-xs text-muted-foreground")).toBe("text-xs text-muted-foreground");
    expect(cn("flex", hidden && "hidden", undefined, "gap-2")).toBe("flex gap-2");
  });
});

describe("the font-size token list", () => {
  it("covers every --text-* token in the stylesheet", () => {
    // cn()'s correctness depends on this list matching @theme. A token added to
    // styles.css and forgotten here is filed by tailwind-merge as a text-COLOUR
    // and dropped the moment a real colour shares the call — silently, and on
    // every surface that uses it at once. That is the bug this file exists for,
    // so the list is checked rather than trusted.
    // cwd rather than import.meta.url: this file runs in the jsdom project,
    // where import.meta.url is not a file: URL and node:fs refuses it.
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    // Only the size tokens: the paired --text-*--line-height entries are not
    // classes and have no bearing on the merge.
    const declared = [...css.matchAll(/^\s*--text-([a-z-]+):/gm)]
      .map((m) => m[1])
      .filter((name) => !name.endsWith("--line-height"));
    expect(declared.length).toBeGreaterThan(0);

    // Read back through cn rather than importing the private list: what matters
    // is that the class survives a colour beside it, which is the actual defect.
    for (const name of declared) {
      expect(cn(`text-${name}`, "text-muted-foreground"), name).toContain(`text-${name}`);
    }
  });
});
