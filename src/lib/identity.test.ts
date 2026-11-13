import { describe, expect, it } from "vitest";
import {
  deviceIdentity,
  guestIdentity,
  isDeviceIdentity,
  isMemberIdentity,
  memberIdentity,
  memberIdentityOrNull,
} from "./identity";

describe("identity", () => {
  it("prefixes each kind of owner distinctly", () => {
    expect(memberIdentity("p1")).toBe("m:p1");
    expect(deviceIdentity("p1")).toBe("d:p1");
    expect(guestIdentity("p1")).toBe("g:p1");
  });

  it("is null for a member that does not exist yet", () => {
    expect(memberIdentityOrNull(null)).toBeNull();
    expect(memberIdentityOrNull(undefined)).toBeNull();
    expect(memberIdentityOrNull("")).toBeNull();
    expect(memberIdentityOrNull("p1")).toBe("m:p1");
  });

  it("recognises its own prefixes and nothing else", () => {
    expect(isMemberIdentity("m:p1")).toBe(true);
    expect(isMemberIdentity("d:p1")).toBe(false);
    expect(isDeviceIdentity("d:p1")).toBe(true);
    expect(isDeviceIdentity("g:p1")).toBe(false);
  });
});
