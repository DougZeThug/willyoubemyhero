// The slug is attacker-controlled and head() runs even when no recap exists, so
// the JSON-LD it emits has to survive a hostile one.
import { describe, expect, it, vi } from "vitest";
import { Route } from "./recap.$slug";

vi.mock("@/lib/media.functions", () => ({ getArchivedRecap: vi.fn() }));

type Head = (ctx: { params: { slug: string } }) => {
  scripts: Array<{ type: string; children: string }>;
};

function jsonLdFor(slug: string) {
  const head = Route.options.head as unknown as Head;
  const script = head({ params: { slug } }).scripts[0];
  return script.children;
}

describe("recap route head", () => {
  it("does not let a slug close the JSON-LD script", () => {
    const slug = "</script><script>alert(1)</script>";
    const body = jsonLdFor(slug);
    expect(body.toLowerCase()).not.toContain("</script");
    const parsed = JSON.parse(body);
    expect(parsed["@type"]).toBe("Article");
    expect(parsed.headline).toContain(slug);
    expect(parsed.url).toContain(slug);
  });

  it("emits the same data for an ordinary slug", () => {
    expect(JSON.parse(jsonLdFor("combine-2026"))).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Draft Combine Recap · combine-2026",
      url: "https://willyoubemyhero.com/recap/combine-2026",
    });
  });
});
