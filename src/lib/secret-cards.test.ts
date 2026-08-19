import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rarityStyle, type BorderFx, type FoilPattern, type RarityTier } from "./card-rarity";
import {
  groupBySecretCollection,
  SECRET_BORDER_FX_OPTIONS,
  SECRET_COLLECTIONS,
  SECRET_FOIL_OPTIONS,
  SECRET_RARITY,
  secretFoil,
  secretsPulledLabel,
  SECRET_REASON,
  UNSORTED_COLLECTION_LABEL,
} from "./secret-cards";

const RARITY_TIERS: RarityTier[] = [
  "champion",
  "podium",
  "stationKing",
  "penaltyBox",
  "dnf",
  "base",
];

// Every admin-pickable foil, resolved through the same function the app uses.
const FOILS = SECRET_FOIL_OPTIONS.map((o) => ({ id: o.id, rarity: secretFoil(o.id) }));

describe("every secret foil", () => {
  it.each(FOILS)("$id keeps its accent opaque, like every real tier does", ({ rarity }) => {
    // The same invariant card-rarity.test.ts pins for the six tiers: `accent`
    // paints text and glows, and a translucent white there is invisible.
    expect(rarity.accent).not.toMatch(/\/\s*\d+%/);
  });

  it.each(FOILS)("$id stays inside the 0..1 range the holo engine scales by", ({ rarity }) => {
    expect(rarity.strength).toBeGreaterThan(0);
    expect(rarity.strength).toBeLessThanOrEqual(1);
    expect(rarity.sparkle).toBeGreaterThanOrEqual(0);
    expect(rarity.sparkle).toBeLessThanOrEqual(1);
  });

  it.each(FOILS)("$id uses oklch everywhere, like the rest of the palette", ({ rarity }) => {
    for (const colour of [rarity.holoA, rarity.holoB, rarity.border, rarity.accent]) {
      expect(colour).toMatch(/^oklch\(/);
    }
  });

  it.each(FOILS)("$id sits outside the tier ladder", ({ rarity }) => {
    const ranks = RARITY_TIERS.map((t) => rarityStyle(t).rank);
    expect(ranks).not.toContain(rarity.rank);
  });

  it.each(FOILS)("$id wears a prism edge — the tell no earned tier may carry", ({ rarity }) => {
    // Since foils became admin-picked, the green is only the default look; the
    // prism edge is the invariant that marks a secret across every foil.
    expect(rarity.prismEdge).toBe(true);
  });

  it.each(FOILS)("$id still says Secret, never the look's own name", ({ rarity }) => {
    // SecretBackPanel prints rarity.label. "Aurora" on the card back would leak
    // authoring vocabulary onto a player's screen.
    expect(rarity.label).toBe("Secret");
  });

  it.each(FOILS)("$id wears a pattern the holo engine has a rule for", ({ rarity }) => {
    const patterns: FoilPattern[] = [
      "refractor",
      "prismatic",
      "scanline",
      "hazard",
      "matte",
      "rosette",
    ];
    expect(patterns).toContain(rarity.pattern);
  });
});

describe("SECRET_RARITY", () => {
  it("wears a pattern no earned tier can have", () => {
    // Only the *default* foil holds this — the variants deliberately reuse tier
    // textures, because the prism edge (above) took over as the universal tell.
    const tierPatterns = RARITY_TIERS.map((t) => rarityStyle(t).pattern);
    expect(tierPatterns).not.toContain(SECRET_RARITY.pattern);
  });

  it("is the only kind of thing in the app with a prism edge", () => {
    for (const tier of RARITY_TIERS) {
      expect(rarityStyle(tier).prismEdge).toBeUndefined();
    }
  });

  it("does not print a tier reason on the back", () => {
    // SECRET_RARITY carries tier "base" purely to satisfy the type. A card back
    // that looked the reason up would print "Combine athlete" on a card that has
    // never been near a combine, which is why SecretBackPanel hardcodes this.
    expect(SECRET_REASON).toBe("Not on the roster");
  });
});

describe("secretFoil", () => {
  it("falls back for a value nobody has written a treatment for", () => {
    // secret_cards.foil has no CHECK behind it, so this is the same
    // unknown-string-falls-back contract rarityMap has for card_rarity.
    expect(secretFoil("nonsense")).toBe(SECRET_RARITY);
    expect(secretFoil(null)).toBe(SECRET_RARITY);
    expect(secretFoil(undefined)).toBe(SECRET_RARITY);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "falls back for %s rather than resolving an inherited property",
    (id) => {
      // The registry is a plain object literal. Without an own-key check these
      // stored values would return Object.prototype (or a function) as the
      // Rarity, and HoloCard would render with every field undefined.
      expect(secretFoil(id)).toBe(SECRET_RARITY);
      expect(secretFoil(id, "pulse").holoA).toBe(SECRET_RARITY.holoA);
    },
  );

  it("resolves the treatment the migration defaults to", () => {
    expect(secretFoil("rosette")).toBe(SECRET_RARITY);
  });

  it.each(SECRET_FOIL_OPTIONS.filter((o) => o.id !== "rosette"))(
    "has a treatment registered for $id, not just a label",
    ({ id }) => {
      // An option added to the list but not to the registry falls back silently
      // to the default green. The distinctness check below catches it too, but
      // only as a baffling "two foils are identical" failure — this names it.
      expect(secretFoil(id)).not.toBe(SECRET_RARITY);
    },
  );

  it("resolves every foil an admin can pick to its own look", () => {
    const seen = new Set(FOILS.map(({ rarity }) => `${rarity.holoA}|${rarity.holoB}`));
    // Distinct gradients, or two options in the picker are secretly the same.
    expect(seen.size).toBe(SECRET_FOIL_OPTIONS.length);
  });

  it("carries the chosen border animation on the resolved rarity", () => {
    expect(secretFoil("rosette", "pulse").borderFx).toBe("pulse");
    expect(secretFoil("aurora", "shimmer").borderFx).toBe("shimmer");
    expect(secretFoil("aurora", "steady").borderFx).toBe("steady");
  });

  it("treats spin, the column default, as the base object unchanged", () => {
    // holo-card reads `borderFx ?? "spin"`, so an explicit spin needs no variant.
    expect(secretFoil("rosette", "spin")).toBe(SECRET_RARITY);
    expect(secretFoil("rosette", "spin").borderFx).toBeUndefined();
  });

  it("falls back for a border animation nobody has written", () => {
    expect(secretFoil("rosette", "wobble")).toBe(SECRET_RARITY);
    expect(secretFoil("rosette", null)).toBe(SECRET_RARITY);
  });

  it("returns referentially stable objects across calls", () => {
    // Render sites call this every render; a fresh spread each time would make
    // the rarity prop churn and defeat holo-card's memo.
    expect(secretFoil("aurora", "pulse")).toBe(secretFoil("aurora", "pulse"));
    expect(secretFoil("ember")).toBe(secretFoil("ember"));
  });
});

describe("secretsPulledLabel", () => {
  it.each([
    [1, "1 secret pulled"],
    [3, "3 secrets pulled"],
  ])("reads %i as %s", (n, expected) => {
    expect(secretsPulledLabel(n)).toBe(expected);
  });
});

describe("every foil pattern has a rule to render it", () => {
  // The class name is assembled at runtime from `rarity.pattern`, so a pattern
  // with no matching CSS rule is invisible until somebody pulls that card in a
  // garden — and a rule with no pattern is dead weight the scanner cannot see.
  // Resolved from the project root rather than import.meta.url: this file runs in
  // the jsdom project, where import.meta.url is an http URL and not a path.
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const declared = [...css.matchAll(/\.holo-pattern-([a-z-]+)\s*\{/g)].map((m) => m[1]).sort();
  const used: FoilPattern[] = ["refractor", "prismatic", "scanline", "hazard", "matte", "rosette"];

  it("declares a rule for every pattern in the union", () => {
    // `refractor` is the shared chassis in holo-foil and deliberately has no
    // override of its own — it is the geometry every other rule departs from.
    for (const pattern of used.filter((p) => p !== "refractor")) {
      expect(declared).toContain(pattern);
    }
  });

  it("declares no rule for a pattern nothing can ask for", () => {
    for (const pattern of declared) {
      expect(used).toContain(pattern as FoilPattern);
    }
  });

  it("keeps the prism edge and the dupe shimmer as plain rules", () => {
    // Both are toggled from JS, so an @utility would be dropped by the Tailwind
    // class scanner exactly the way the note above .holo-pattern-* explains.
    expect(css).toMatch(/^\.holo-prism-edge\s*\{/m);
    expect(css).toMatch(/^\.secret-dupe-shimmer::after\s*\{/m);
  });
});

describe("every border animation has a rule to render it", () => {
  // Same runtime-assembly story as the patterns: holo-card maps a BorderFx id to
  // an is-* class, so an id with no plain rule is a picker option that does
  // nothing, silently, on a phone, in a garden.
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const animated: Exclude<BorderFx, "steady">[] = ["spin", "pulse", "shimmer"];
  const CLASS: Record<Exclude<BorderFx, "steady">, string> = {
    spin: "is-spinning",
    pulse: "is-pulsing",
    shimmer: "is-shimmering",
  };

  it("offers exactly the ids the picker offers", () => {
    expect(SECRET_BORDER_FX_OPTIONS.map((o) => o.id).sort()).toEqual(
      [...animated, "steady"].sort(),
    );
  });

  it.each(animated)("declares a plain animating rule for %s", (fx) => {
    const rule = new RegExp(
      String.raw`^\.holo-prism-edge\.${CLASS[fx]}\s*\{[^}]*animation:[^}]*holo-prism-`,
      "m",
    );
    expect(css).toMatch(rule);
  });

  it.each(animated)("still turns %s off under reduced motion", (fx) => {
    // Matches the grouped selector list inside the reduced-motion block: no `}`
    // may sit between the class and the `animation: none` that silences it.
    const silenced = new RegExp(
      String.raw`\.holo-prism-edge\.${CLASS[fx]}[^}]*\{[^}]*animation:\s*none`,
    );
    expect(css).toMatch(silenced);
  });

  it("declares no is-* rule nothing can ask for", () => {
    const declared = [...css.matchAll(/\.holo-prism-edge\.(is-[a-z-]+)/g)].map((m) => m[1]);
    for (const cls of declared) {
      expect(Object.values(CLASS)).toContain(cls);
    }
  });
});

describe("groupBySecretCollection", () => {
  const card = (collection: string | null, name: string) => ({ collection, name });

  it("reads the sets in the order the league prints them", () => {
    // The array is the running order for the admin panel and the vault alike, so
    // this is the one place it is asserted rather than assumed.
    expect(SECRET_COLLECTIONS.map((c) => c.id)).toEqual(["cornhole", "wags", "pets", "legacyPets"]);
  });

  it("groups into that order whatever order the cards arrive in", () => {
    const groups = groupBySecretCollection([
      card("legacyPets", "Rufus"),
      card("cornhole", "The Board"),
      card("pets", "Bandit"),
      card("wags", "Steph"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["cornhole", "wags", "pets", "legacyPets"]);
  });

  it("says nothing about a set the holder owns none of", () => {
    // An empty "Pets" heading announces that Pets exists, which is the shape of
    // the set the whole feature withholds.
    const groups = groupBySecretCollection([card("cornhole", "The Board")]);
    expect(groups.map((g) => g.label)).toEqual(["Cornhole Collection"]);
  });

  it("keeps a retired id visible, ahead of the unsorted pile", () => {
    // Ids are add-only, but a set dropped from the list still has rows pointing
    // at it. Those cards render under their own id rather than vanishing.
    const groups = groupBySecretCollection([
      card(null, "Unfiled"),
      card("gazebos", "The Gazebo"),
      card("cornhole", "The Board"),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Cornhole Collection",
      "gazebos",
      UNSORTED_COLLECTION_LABEL,
    ]);
  });
});
