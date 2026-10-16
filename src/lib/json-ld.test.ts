import { describe, expect, it } from "vitest";
import { jsonLd } from "./json-ld";

describe("jsonLd", () => {
  it("cannot be broken out of a script element", () => {
    const data = { headline: "</script><script>alert(1)</script><!-- & -->" };
    const out = jsonLd(data);
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out)).toEqual(data);
  });

  it("escapes the line separators and round-trips them", () => {
    const data = { a: "x\u2028y\u2029z" };
    const out = jsonLd(data);
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(out)).toEqual(data);
  });

  it("leaves ordinary data identical to JSON.stringify once parsed", () => {
    const data = { "@context": "https://schema.org", n: 1, list: ["a", null] };
    expect(JSON.parse(jsonLd(data))).toEqual(data);
  });
});
