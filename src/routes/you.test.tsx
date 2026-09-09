// The profile screen: one home for everything that used to be four places.
//
// What is worth pinning here is the branching, not the layout — who this phone
// is, whether the dust section exists at all, and the three device settings,
// which are the ones with no other home in the app.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import YouPage from "./you";
import { EVENT_ID, makeBundle, makeParticipant, resetFixtureIds } from "@/test/fixtures";
import { STREAK_MILESTONES } from "@/lib/streaks";
import { isHapticsOff, setCardSfxMuted, setHapticsOff } from "@/lib/card-sfx";
import { isTiltWanted, setTiltWanted } from "@/lib/gyro";

const useMemberSession = vi.fn();
const useActiveEvent = vi.fn();
const useStreakStatus = vi.fn();
const useQuery = vi.fn();
const requestGyroAccess = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  useQueryClient: () => ({ cancelQueries: vi.fn(async () => {}), clear: vi.fn() }),
}));

/** Five on the roster, so the summary's fraction has a denominator to print. */
const ROSTER = Array.from({ length: 5 }, () => makeParticipant());

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({ participants: ROSTER }),
    error: null,
    loading: false,
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/use-active-event", () => ({ useActiveEvent: () => useActiveEvent() }));
vi.mock("@/hooks/use-daily-secret", () => ({
  useSecretActor: () => "m:me",
  useMySecrets: () => ({ data: { cards: [], pulled: 2 } }),
}));
vi.mock("@/hooks/use-secret-collections", () => ({ useSecretCollections: () => undefined }));
vi.mock("@/hooks/use-collection-trophies", () => ({
  useCollectionTrophies: () => ({ data: { trophies: [] } }),
}));
vi.mock("@/hooks/use-streak", () => ({ useStreakStatus: () => useStreakStatus() }));
vi.mock("@/hooks/use-dust", () => ({ useDustBalance: () => ({ data: { balance: 140 } }) }));
vi.mock("@/hooks/use-my-collection", () => ({
  useMyCollection: () => ({
    collection: {},
    collectedCount: 3,
    packsOpened: 7,
    dupes: 2,
    firstPackOn: null,
    ready: true,
    isMember: true,
    markCollected: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-account", () => ({
  useAuthUser: () => ({ user: null, loading: false }),
  signOutAccount: vi.fn(),
}));

// Partial: the page reads the hook and the WAS_MEMBER_KEY constant from here.
vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => useMemberSession() };
});

// Partial for the same reason: the tilt row calls the permission request, but
// the store beside it is the real one — that is half of what is being asserted.
vi.mock("@/lib/gyro", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, requestGyroAccess: () => requestGyroAccess() };
});

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubs[name] =
      typeof value === "function"
        ? (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />
        : value;
  }
  return stubs;
});

const streak = {
  kind: "member" as const,
  current: 4,
  startedOn: "2026-08-21",
  lastOpenedOn: "2026-08-24",
  openedToday: true,
  today: "2026-08-24",
  canClaim: true,
  milestones: STREAK_MILESTONES.map((m) => ({
    days: m.days,
    label: m.label,
    blurb: m.blurb,
    tierFloor: m.tierFloor,
    earned: m.days <= 4,
    claimed: false,
  })),
};

beforeEach(() => {
  resetFixtureIds();
  useMemberSession.mockReturnValue({ participantId: "p-me", name: "Bob Blitz", expiresAt: 0, token: "t" }); // prettier-ignore
  useActiveEvent.mockReturnValue({ data: { id: EVENT_ID, dust_enabled: false } });
  useStreakStatus.mockReturnValue({ data: streak, isPending: false });
  useQuery.mockReturnValue({ data: [], isPending: false });
  requestGyroAccess.mockResolvedValue("granted");
  setCardSfxMuted(false);
  setHapticsOff(false);
  setTiltWanted(false);
});

describe("/you", () => {
  it("names the player this phone is holding", () => {
    render(<YouPage />);
    expect(screen.getByText("Bob Blitz")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /switch player/i })).toHaveAttribute("href", "/claim");
  });

  it("offers the code to a phone with nothing claimed on it", () => {
    useMemberSession.mockReturnValue(null);
    render(<YouPage />);
    expect(screen.getByText(/no player claimed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /claim your player/i })).toHaveAttribute(
      "href",
      "/claim",
    );
  });

  it("repeats the collection numbers PR 5 took off the vault's header", () => {
    render(<YouPage />);
    expect(screen.getByText(/roster 3 \/ 5/i)).toBeInTheDocument();
    expect(screen.getByText(/7 packs opened/i)).toBeInTheDocument();
    expect(screen.getByText(/2 spares to trade/i)).toBeInTheDocument();
  });

  it("never prints how many secrets exist", () => {
    // The one rule this whole feature keeps. "across N sets" is a fact about
    // your collection; "of N" would be a fact about the catalogue.
    render(<YouPage />);
    expect(screen.queryByText(/of \d+ secrets/i)).not.toBeInTheDocument();
  });

  it("has no dust section while the commissioner has dust switched off", () => {
    render(<YouPage />);
    expect(screen.queryByText(/burn spares into dust/i)).not.toBeInTheDocument();
  });

  it("points the dust chip at the shop once the switch is on", () => {
    useActiveEvent.mockReturnValue({ data: { id: EVENT_ID, dust_enabled: true } });
    render(<YouPage />);
    expect(screen.getByRole("link", { name: /140 dust/i })).toHaveAttribute(
      "href",
      "/players/shop",
    );
  });

  it("carries the streak ladder", () => {
    render(<YouPage />);
    for (const m of STREAK_MILESTONES) {
      expect(screen.getByText(m.label)).toBeInTheDocument();
    }
  });

  it("mutes the sound from here", async () => {
    render(<YouPage />);
    const sound = screen.getByRole("button", { name: /sound/i });
    expect(sound).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(sound);
    expect(sound).toHaveAttribute("aria-pressed", "false");
  });

  it("gives haptics the switch they have never had anywhere", async () => {
    render(<YouPage />);
    const haptics = screen.getByRole("button", { name: /haptics/i });
    await userEvent.click(haptics);
    expect(isHapticsOff()).toBe(true);
  });

  it("asks for motion access from the tap, and remembers a yes", async () => {
    // iOS only grants orientation from a gesture, and this is the only gesture
    // there is going to be.
    render(<YouPage />);
    await userEvent.click(screen.getByRole("button", { name: /tilt/i }));
    expect(requestGyroAccess).toHaveBeenCalled();
    expect(isTiltWanted()).toBe(true);
  });

  it("does not remember a tilt the device refused", async () => {
    requestGyroAccess.mockResolvedValue("denied");
    render(<YouPage />);
    await userEvent.click(screen.getByRole("button", { name: /tilt/i }));
    expect(isTiltWanted()).toBe(false);
  });

  it("keeps the admin door where the League hub keeps it", () => {
    render(<YouPage />);
    expect(screen.getByRole("link", { name: /admin/i })).toHaveAttribute("href", "/admin");
  });
});
