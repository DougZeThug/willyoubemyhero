import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cn, FONT_SIZE_TOKENS } from "./utils";

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
    // ui/drawer.tsx bakes `text-sm` into DrawerDescription's own class list, so
    // three callers hand it a token and rely on the token arriving second and
    // winning. Untested, that is a silent 14px on a line meant to be 12.
    expect(cn("text-sm text-muted-foreground", "text-meta")).toContain("text-meta");
    expect(cn("text-sm text-muted-foreground", "text-meta")).not.toContain("text-sm");
  });

  it("lets a caller override a spacing token, and the other way round", () => {
    // Both directions, because the failure is asymmetric: `px-page-x` matches no
    // tailwind-merge pattern out of the box, so the pair survives — and the
    // named value sorts last in the compiled sheet, so the survivor that paints
    // is the token. A shell that asked for px-6 would silently get 16px.
    expect(cn("px-page-x", "px-6")).toBe("px-6");
    expect(cn("px-4", "px-page-x")).toBe("px-page-x");
    expect(cn("gap-2", "gap-grid-gap")).toBe("gap-grid-gap");
    expect(cn("space-y-4", "space-y-section-gap")).toBe("space-y-section-gap");
    // Still a different axis from `p-*`, which is a conflict pair rather than a
    // dedupe pair and has to keep both.
    expect(cn("p-4", "px-page-x")).toBe("p-4 px-page-x");
    expect(cn("px-page-x", "sm:px-6")).toBe("px-page-x sm:px-6");
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

/** Every `--text-*` size token @theme declares, without the line-height twins. */
function declaredTokens(): string[] {
  // cwd rather than import.meta.url: this file runs in the jsdom project,
  // where import.meta.url is not a file: URL and node:fs refuses it.
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  // Only the size tokens: the paired --text-*--line-height entries are not
  // classes and have no bearing on the merge.
  return [...css.matchAll(/^\s*--text-([a-z-]+):/gm)]
    .map((m) => m[1])
    .filter((name) => !name.endsWith("--line-height"));
}

describe("the font-size token list", () => {
  it("covers every --text-* token in the stylesheet", () => {
    // cn()'s correctness depends on this list matching @theme. A token added to
    // styles.css and forgotten here is filed by tailwind-merge as a text-COLOUR
    // and dropped the moment a real colour shares the call — silently, and on
    // every surface that uses it at once. That is the bug this file exists for,
    // so the list is checked rather than trusted.
    const declared = declaredTokens();
    expect(declared.length).toBeGreaterThan(0);

    // Read back through cn rather than through the list the sibling test reads:
    // what matters here is that the class survives a colour beside it, which is
    // the actual defect. The list itself has no behavioural signature at all,
    // which is why proving it is a separate test and not this one.
    for (const name of declared) {
      expect(cn(`text-${name}`, "text-muted-foreground"), name).toContain(`text-${name}`);
    }
  });

  it("holds nothing the stylesheet no longer declares", () => {
    // The other half of the same contract, and the half a deletion needs. The
    // test above iterates what the CSS declares, so a name left here after its
    // token is gone is never visited — and it cannot fail any other way, because
    // tailwind-merge never reads the stylesheet: an entry matching no utility
    // behaves exactly like one that matches. So this half reads the list.
    expect([...FONT_SIZE_TOKENS].sort()).toEqual([...declaredTokens()].sort());
  });
});
