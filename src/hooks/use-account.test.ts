import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { signOutAccount } from "./use-account";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
    },
  },
}));

describe("signOutAccount", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
  });

  it("clears the admin token alongside the member token", async () => {
    window.localStorage.setItem("wwbh:admin-token", "event.9999999999999.signature");
    window.localStorage.setItem("wwbh:member-token", "m.participant.9999999999999.signature");

    await signOutAccount();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(window.localStorage.getItem("wwbh:admin-token")).toBeNull();
    expect(window.localStorage.getItem("wwbh:member-token")).toBeNull();
  });
});
