// A guest's reactions and comments, carried onto the player they claim.
//
// The two identity columns dedup independently — one unique for members, a
// partial one for guest keys — so a 🔥 left as a guest and a 🔥 tapped after
// claiming were two rows the database was happy to hold. toggleReaction only
// looks under the identity of the request, and a member session always wins, so
// the guest one could never be taken back off. These pin the claim moving them.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, seedEvent, sql } from "./helpers";

const GUEST = "00000000-0000-4000-8000-00000000de05";
const OTHER_GUEST = "00000000-0000-4000-8000-00000000de06";
const USER = "00000000-0000-4000-8000-00000000ac05";

afterAll(closeDb);
beforeEach(seedEvent);

/** Bob's card: the one everybody below is reacting to. */
async function card(): Promise<string> {
  const [row] = await sql<{ id: string }>(
    "SELECT id::text FROM public.event_participants WHERE event_id = $1 AND participant_id = $2",
    [IDS.event, IDS.bob],
  );
  return row.id;
}

async function guestReacts(ep: string, emoji: string, guest = GUEST) {
  await sql(
    `INSERT INTO public.card_reactions (event_participant_id, guest_key, guest_name, emoji)
     VALUES ($1, $2, 'Guest', $3)`,
    [ep, guest, emoji],
  );
}

async function memberReacts(ep: string, emoji: string, participant = IDS.alice) {
  await sql(
    `INSERT INTO public.card_reactions (event_participant_id, participant_id, emoji)
     VALUES ($1, $2, $3)`,
    [ep, participant, emoji],
  );
}

async function guestComments(ep: string, body: string, guest = GUEST) {
  await sql(
    `INSERT INTO public.card_comments (event_participant_id, guest_key, guest_name, body)
     VALUES ($1, $2, 'Guest', $3)`,
    [ep, guest, body],
  );
}

type Row = { participant_id: string | null; guest_key: string | null; guest_name: string | null };

function reactions() {
  return sql<Row & { emoji: string }>(
    `SELECT participant_id::text, guest_key, guest_name, emoji
       FROM public.card_reactions ORDER BY emoji COLLATE "C", guest_key NULLS FIRST`,
  );
}

function comments() {
  return sql<Row & { body: string }>(
    `SELECT participant_id::text, guest_key, guest_name, body
       FROM public.card_comments ORDER BY body`,
  );
}

describe("claim_guest_social", () => {
  it("files the guest's reactions and comments under the player", async () => {
    const ep = await card();
    await guestReacts(ep, "🔥");
    await guestComments(ep, "slow");

    const [res] = await sql<{ claim_guest_social: number }>(
      "SELECT public.claim_guest_social($1, $2)",
      [IDS.alice, GUEST],
    );
    expect(res.claim_guest_social).toBe(2);

    expect(await reactions()).toEqual([
      { participant_id: IDS.alice, guest_key: null, guest_name: null, emoji: "🔥" },
    ]);
    expect(await comments()).toEqual([
      { participant_id: IDS.alice, guest_key: null, guest_name: null, body: "slow" },
    ]);
  });

  it("keeps one reaction when the player already made the same one", async () => {
    // Moved as-is this would trip the member unique and take the whole claim
    // down with it. It is the same reaction twice, so the guest copy goes.
    const ep = await card();
    await guestReacts(ep, "🔥");
    await guestReacts(ep, "💀");
    await memberReacts(ep, "🔥");

    await sql("SELECT public.claim_guest_social($1, $2)", [IDS.alice, GUEST]);

    expect(await reactions()).toEqual([
      { participant_id: IDS.alice, guest_key: null, guest_name: null, emoji: "💀" },
      { participant_id: IDS.alice, guest_key: null, guest_name: null, emoji: "🔥" },
    ]);
  });

  it("leaves the reaction where toggleReaction will find it", async () => {
    // The reported sequence: react as a guest, claim, tap the same emoji. The
    // member's toggle looks under participant_id only, so the row has to be
    // there — and a second one can no longer be inserted beside it.
    const ep = await card();
    await guestReacts(ep, "🔥");

    await sql("SELECT public.claim_guest_social($1, $2)", [IDS.alice, GUEST]);

    const found = await sql(
      `SELECT id FROM public.card_reactions
        WHERE event_participant_id = $1 AND emoji = '🔥' AND participant_id = $2`,
      [ep, IDS.alice],
    );
    expect(found).toHaveLength(1);
    await expect(memberReacts(ep, "🔥")).rejects.toThrow(/duplicate key/);
  });

  it("leaves somebody else's rows alone", async () => {
    const ep = await card();
    await guestReacts(ep, "🔥", OTHER_GUEST);
    await guestComments(ep, "not mine", OTHER_GUEST);
    await memberReacts(ep, "🐐", IDS.carol);

    await sql("SELECT public.claim_guest_social($1, $2)", [IDS.alice, GUEST]);

    expect(await reactions()).toEqual([
      { participant_id: IDS.carol, guest_key: null, guest_name: null, emoji: "🐐" },
      { participant_id: null, guest_key: OTHER_GUEST, guest_name: "Guest", emoji: "🔥" },
    ]);
    expect(await comments()).toEqual([
      { participant_id: null, guest_key: OTHER_GUEST, guest_name: "Guest", body: "not mine" },
    ]);
  });

  it("moves nothing for a player the league has never heard of, or a missing id", async () => {
    const ep = await card();
    await guestReacts(ep, "🔥");

    for (const args of [
      ["00000000-0000-4000-8000-00000000dead", GUEST],
      [null, GUEST],
      [IDS.alice, null],
    ]) {
      const [res] = await sql<{ claim_guest_social: number }>(
        "SELECT public.claim_guest_social($1, $2)",
        args,
      );
      expect(res.claim_guest_social).toBe(0);
    }
    const [row] = await reactions();
    expect(row.guest_key).toBe(GUEST);
  });
});

describe("every way a guest becomes a player", () => {
  // Not just the helper: each of the three flows that fold a guest has to call
  // it, or the flow it was left out of still doubles reactions.
  const flows: [string, () => Promise<unknown>][] = [
    [
      "attach_device_to_player",
      () => sql("SELECT public.attach_device_to_player($1, $2)", [IDS.alice, GUEST]),
    ],
    [
      "bind_account_to_player",
      async () => {
        await sql("INSERT INTO public.account_identities (user_id, guest_id) VALUES ($1, $2)", [
          USER,
          GUEST,
        ]);
        await sql("SELECT public.bind_account_to_player($1, $2)", [USER, IDS.alice]);
      },
    ],
    [
      "merge_guests_into_collector",
      () => sql("SELECT public.merge_guests_into_collector($1, $2)", [IDS.alice, [GUEST]]),
    ],
  ];

  it.each(flows)("%s carries the guest's reactions and comments", async (_name, run) => {
    const ep = await card();
    await guestReacts(ep, "🔥");
    await memberReacts(ep, "😂");
    await guestReacts(ep, "😂");
    await guestComments(ep, "slow");

    await run();

    expect(await reactions()).toEqual([
      { participant_id: IDS.alice, guest_key: null, guest_name: null, emoji: "🔥" },
      { participant_id: IDS.alice, guest_key: null, guest_name: null, emoji: "😂" },
    ]);
    expect(await comments()).toEqual([
      { participant_id: IDS.alice, guest_key: null, guest_name: null, body: "slow" },
    ]);
  });
});
