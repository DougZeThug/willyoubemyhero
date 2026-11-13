import { describe, expect, it } from "vitest";
import { parseAdminToken, parsePrefixedToken } from "./token-format";

describe("parsePrefixedToken", () => {
  it("reads a member or guest token and rebuilds what its signature covers", () => {
    expect(parsePrefixedToken("m", "m.person.1700.sig")).toEqual({
      id: "person",
      expiresAt: 1700,
      sig: "sig",
      payload: "m.person.1700",
    });
  });

  it("tells a guest token from a member token by the prefix alone", () => {
    expect(parsePrefixedToken("m", "g.person.1700.sig")).toBeNull();
    expect(parsePrefixedToken("g", "m.person.1700.sig")).toBeNull();
  });

  it("refuses the wrong shape", () => {
    expect(parsePrefixedToken("m", "m.person.1700")).toBeNull();
    expect(parsePrefixedToken("m", "m..1700.sig")).toBeNull();
    expect(parsePrefixedToken("m", "m.person.soon.sig")).toBeNull();
  });
});

describe("parseAdminToken", () => {
  it("reads a PIN token: event, expiry, signature", () => {
    expect(parseAdminToken("evt.1700.sig")).toEqual({
      id: "evt",
      expiresAt: 1700,
      sig: "sig",
      payload: "evt.1700",
    });
  });

  it("reads an account token and names the account", () => {
    expect(parseAdminToken("a.user.evt.1700.sig")).toEqual({
      id: "evt",
      userId: "user",
      expiresAt: 1700,
      sig: "sig",
      payload: "a.user.evt.1700",
    });
  });

  it("never reads a member-shaped token as an admin one", () => {
    expect(parseAdminToken("m.person.1700.sig")).toBeNull();
    expect(parseAdminToken("x.user.evt.1700.sig")).toBeNull();
    expect(parseAdminToken("evt.later.sig")).toBeNull();
  });
});
