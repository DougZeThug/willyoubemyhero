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
