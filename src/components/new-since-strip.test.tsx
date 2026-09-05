// What arrived since you last looked (§12).
//
// The strip has exactly two jobs beyond drawing: say NEW or ×N truthfully, and
// tell the vault it has been acted on so the row can go away. Both are checked
// here; that the ×N is computed from the collection rather than sent by the
// server is enforced next door, in acquisitions.functions.test.ts.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewSinceStrip, type NewSinceItem } from "./new-since-strip";
import { rarityStyle } from "@/lib/card-rarity";
import { secretTierLabel } from "@/lib/secret-rarity";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: { id: string };
  }) => (
    <a href={params ? to.replace("$id", params.id) : to} {...rest}>
      {children}
    </a>
  ),
}));

const alice: NewSinceItem = {
  kind: "roster",
  id: "ep-alice",
  name: "Alice Ace",
  urls: null,
  rarity: rarityStyle("champion"),
  edition: "gold",
  label: "NEW",
};

const gary: NewSinceItem = {
  kind: "secret",
  id: "secret-gary",
  name: "Gary The Grill",
  artUrl: null,
  rarity: rarityStyle("base"),
  tier: "epic",
  label: "×2",
};

function strip(items: NewSinceItem[], over: Partial<Parameters<typeof NewSinceStrip>[0]> = {}) {
  const onOpen = vi.fn();
  const onDismiss = vi.fn();
  render(<NewSinceStrip items={items} onOpen={onOpen} onDismiss={onDismiss} {...over} />);
  return { onOpen, onDismiss };
}

describe("NewSinceStrip", () => {
  it("says nothing at all when nothing arrived", () => {
    // Not an empty row with a heading over it: "New since your last visit" above
    // nothing is a worse answer than silence, and it costs height on a screen the
    // audit already faults for its height (§3, §17).
    strip([]);
    expect(screen.queryByTestId("new-since-strip")).toBeNull();
    expect(screen.queryByText(/new since your last visit/i)).toBeNull();
  });

  it("draws a card for each arrival, with its label in the accessible name", () => {
    strip([alice, gary]);
    expect(screen.getByTestId("new-since-strip").children).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Alice Ace — NEW" })).toBeVisible();
    // The level rides in the name: a screen reader moving by control hears only
    // the button, and the level is the whole reason one secret is worth more of a
    // look than another.
    expect(
      screen.getByRole("button", { name: `Gary The Grill — ${secretTierLabel("epic")} — ×2` }),
    ).toBeVisible();
  });

  it("sends a roster card to its own page and a secret to the sheet", () => {
    // A secret is a button and not a link on purpose: it has no URL, which is the
    // one thing about it that must not change. See card-viewer.tsx.
    strip([alice, gary]);
    expect(screen.getByRole("link", { name: /Alice Ace/ })).toHaveAttribute(
      "href",
      "/players/ep-alice",
    );
    expect(screen.queryByRole("link", { name: /Gary/ })).toBeNull();
  });

  it("names the level of a secret copy, so the row is not a wall of same", () => {
    strip([gary]);
    expect(screen.getByLabelText(/level 3 of 5/i)).toBeVisible();
  });

  it("tells the vault it has been acted on, before it navigates", async () => {
    const { onOpen } = strip([alice, gary]);
    await userEvent.click(screen.getByRole("link", { name: /Alice Ace/ }));
    expect(onOpen).toHaveBeenCalledWith(alice);

    await userEvent.click(screen.getByRole("button", { name: /Gary The Grill/ }));
    expect(onOpen).toHaveBeenCalledWith(gary);
  });

  it("can be dismissed by somebody who has read it and wants their screen back", async () => {
    const { onDismiss } = strip([alice]);
    await userEvent.click(screen.getByRole("button", { name: /dismiss what's new/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
