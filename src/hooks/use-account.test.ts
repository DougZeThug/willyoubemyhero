import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutAccount } from "./use-account";

const signOutMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: () => signOutMock(),
    },
  },
}));

describe("signOutAccount", () => {
  beforeEach(() => {
    window.localStorage.clear();
    signOutMock.mockReset();
    signOutMock.mockResolvedValue({ error: null });
  });

  it("clears the admin token alongside the member token", async () => {
    window.localStorage.setItem("wwbh:admin-token", "event.9999999999999.signature");
    window.localStorage.setItem("wwbh:member-token", "m.participant.9999999999999.signature");

    await signOutAccount();

    expect(signOutMock).toHaveBeenCalled();
    expect(window.localStorage.getItem("wwbh:admin-token")).toBeNull();
    expect(window.localStorage.getItem("wwbh:member-token")).toBeNull();
  });
});
