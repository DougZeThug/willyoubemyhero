import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { becomeMember } from "./become-member";

const calls: string[] = [];
const log = (name: string) =>
  vi.fn().mockImplementation(() => {
    calls.push(name);
    return Promise.resolve();
  });

const adoptLocalCollection = vi.hoisted(() => vi.fn());
const holdForAdoption = vi.hoisted(() => vi.fn());
const releaseAdoptionHold = vi.hoisted(() => vi.fn());
const carryPackToIdentity = vi.hoisted(() => vi.fn());
const carryTrophySeen = vi.hoisted(() => vi.fn());
const setMemberToken = vi.hoisted(() => vi.fn());
const clearMemberToken = vi.hoisted(() => vi.fn());

vi.mock("./adopt-collection", () => ({
  adoptableIds: () => ["ep-1"],
  adoptLocalCollection,
  holdForAdoption,
  releaseAdoptionHold,
}));
vi.mock("./card-collection", () => ({ carryPackToIdentity }));
vi.mock("./trophy-seen", () => ({ carryTrophySeen }));
vi.mock("./member-token", () => ({ setMemberToken, clearMemberToken }));

const qc = {} as QueryClient;
const base = { participantId: "p1", token: "tok", name: "Ada", held: {}, device: "dev", qc };

beforeEach(() => {
  calls.length = 0;
  adoptLocalCollection.mockReset().mockImplementation(log("adopt"));
  holdForAdoption.mockReset().mockImplementation(log("hold"));
  releaseAdoptionHold.mockReset().mockImplementation(log("release"));
  carryPackToIdentity.mockReset().mockImplementation(log("carryPack"));
  carryTrophySeen.mockReset().mockImplementation(() => calls.push("carryTrophy"));
  setMemberToken.mockReset().mockImplementation(() => calls.push("token"));
  clearMemberToken.mockReset().mockImplementation(() => calls.push("clearToken"));
});

describe("becomeMember", () => {
  it("carries the ceremonies and holds the cards BEFORE the token, and the pack AFTER the adoption", async () => {
    const res = await becomeMember(base);
    expect(res.status).toBe("adopted");
    expect(calls).toEqual(["carryTrophy", "hold", "token", "adopt", "release", "carryPack"]);
    expect(carryPackToIdentity).toHaveBeenCalledWith("d:dev", "m:p1", ["ep-1"]);
  });

  it("retries the adoption once before giving up", async () => {
    adoptLocalCollection.mockReset().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue(1);
    const res = await becomeMember(base);
    expect(res.status).toBe("adopted");
    expect(adoptLocalCollection).toHaveBeenCalledTimes(2);
    expect(clearMemberToken).not.toHaveBeenCalled();
  });

  it("takes the token back off and drops the hold when the adoption will not stick", async () => {
    const boom = new Error("offline");
    adoptLocalCollection.mockReset().mockRejectedValue(boom);
    const res = await becomeMember(base);
    expect(res).toEqual({ status: "failed", error: boom });
    expect(clearMemberToken).toHaveBeenCalled();
    expect(releaseAdoptionHold).toHaveBeenCalledWith("p1", {});
    expect(carryPackToIdentity).not.toHaveBeenCalled();
  });

  it("lets a hold that could not be written stop the handoff before any token", async () => {
    holdForAdoption.mockReset().mockRejectedValue(new Error("Could not protect your cards"));
    await expect(becomeMember(base)).rejects.toThrow("Could not protect");
    expect(setMemberToken).not.toHaveBeenCalled();
  });

  it("stops without a token when overtaken before it lands, and releases the hold", async () => {
    const res = await becomeMember({ ...base, isCurrent: () => false });
    expect(res.status).toBe("stale");
    expect(setMemberToken).not.toHaveBeenCalled();
    expect(releaseAdoptionHold).toHaveBeenCalledWith("p1", {});
  });

  it("leaves the token alone when overtaken after it landed", async () => {
    let live = true;
    adoptLocalCollection.mockReset().mockImplementation(() => {
      live = false;
      return Promise.reject(new Error("late"));
    });
    const res = await becomeMember({ ...base, isCurrent: () => live });
    expect(res.status).toBe("stale");
    expect(clearMemberToken).not.toHaveBeenCalled();
  });

  it("skips the pack when the device has moved on to another account", async () => {
    const res = await becomeMember({ ...base, mayCarryPack: () => false });
    expect(res.status).toBe("adopted");
    expect(carryPackToIdentity).not.toHaveBeenCalled();
  });

  it("has no ceremonies or pack to carry on a device with no id", async () => {
    await becomeMember({ ...base, device: null });
    expect(carryTrophySeen).not.toHaveBeenCalled();
    expect(carryPackToIdentity).not.toHaveBeenCalled();
  });
});
