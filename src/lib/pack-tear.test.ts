// The rip, checked as arithmetic.
//
// The property this file exists for: before the tear front reaches a column, the
// wrapper at that column is *intact* — the body clip covers it and the strip clip
// has no area there. That is what makes the pack look like one continuous image
// right up to the moment it comes apart, and it is far easier to prove here than
// to spot in a filmstrip.
import { describe, expect, it } from "vitest";
import {
  bodyClipAt,
  coreClipAt,
  mouthClip,
  ripWaypoints,
  RIP_TIMES,
  seamOpen,
  seamY,
  segmentClipAt,
  segmentLift,
  segmentPose,
  SEGMENT_FLIGHT,
  stripClipAt,
  tearEdge,
  TEAR_SEGMENTS,
} from "./pack-tear";

const STRIP_PCT = 15;
const edge = tearEdge("pack-a", STRIP_PCT);

/** Every `n% m%` pair in a polygon string, as numbers. */
function vertices(clip: string): [number, number][] {
  return [...clip.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map((m) => [+m[1], +m[2]]);
}

describe("the ragged edge", () => {
  it("gives the same pack the same rip every time", () => {
    expect(tearEdge("pack-a", STRIP_PCT)).toEqual(tearEdge("pack-a", STRIP_PCT));
  });

  it("gives two different packs different rips", () => {
    expect(tearEdge("pack-a", STRIP_PCT)).not.toEqual(tearEdge("pack-b", STRIP_PCT));
  });

  it("spans the pack left to right, in order", () => {
    expect(edge[0].x).toBe(0);
    expect(edge[edge.length - 1].x).toBe(100);
    for (let i = 1; i < edge.length; i++) expect(edge[i].x).toBeGreaterThan(edge[i - 1].x);
  });

  /**
   * A deep jitter at any one column used to clip the strip away to nothing
   * there, and a rip with a hole punched through it reads as damage rather than
   * as a tear.
   */
  it("never wanders off the top of the pack, or so far down it is a flap", () => {
    for (const p of edge) {
      expect(p.y).toBeGreaterThanOrEqual(1.5);
      expect(p.y).toBeLessThan(STRIP_PCT + 6);
    }
  });

  it("is ragged rather than straight, which is the whole point of it", () => {
    const ys = new Set(edge.map((p) => p.y.toFixed(3)));
    expect(ys.size).toBeGreaterThan(edge.length / 2);
  });
});

describe("the tear front", () => {
  it("has parted nothing before it starts", () => {
    for (const p of edge) expect(seamOpen(p.x, 0)).toBe(0);
  });

  it("has parted everything once it finishes", () => {
    for (const p of edge) expect(seamOpen(p.x, 1)).toBe(1);
  });

  /**
   * The far corner is the one that catches this. Quoted over 1 rather than over
   * 1 + RAMP, the last column is still mid-shoulder at full travel and the rip
   * ends with a few pixels of wrapper still attached.
   */
  it("finishes at the far edge, not a shoulder short of it", () => {
    expect(seamOpen(100, 1)).toBe(1);
    expect(seamOpen(100, 0.98)).toBeLessThan(1);
  });

  it("only ever opens further as the front travels", () => {
    for (const p of edge) {
      let last = -1;
      for (let f = 0; f <= 1.0001; f += 0.02) {
        const open = seamOpen(p.x, f);
        expect(open).toBeGreaterThanOrEqual(last);
        last = open;
      }
    }
  });

  /**
   * The thing that makes the tear progressive rather than instant: at any front
   * short of the end there is a column to the right of it that has not moved.
   */
  it("leaves the wrapper ahead of it untouched", () => {
    for (const f of [0.2, 0.5, 0.8]) {
      const ahead = edge.filter((p) => p.x / 100 > f * (1 + 0.08));
      expect(ahead.length).toBeGreaterThan(0);
      for (const p of ahead) expect(seamY(p, f)).toBe(0);
    }
  });

  it("has a shoulder rather than a step, so the front is not a corner", () => {
    const partial = edge.map((p) => seamOpen(p.x, 0.5)).filter((o) => o > 0 && o < 1);
    expect(partial.length).toBeGreaterThan(0);
  });
});

describe("the rip finishing on its own", () => {
  /**
   * The one that matters. A fast swipe crosses the 60% commit threshold inside a
   * single pointermove and `tearProgress` clamps at 1, so the rip can commit
   * anywhere up to the far edge. An earlier version quoted its middle waypoints
   * as absolute positions, so committing past one of them sent the tear
   * *backwards* — the wrapper visibly rejoined and the pieces settled again
   * before it reopened.
   */
  it("never travels backwards, from any commit point", () => {
    for (let start = 0; start <= 1.0001; start += 0.02) {
      const points = ripWaypoints(start);
      for (let i = 1; i < points.length; i++) {
        expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]);
      }
    }
  });

  it("starts where the finger left off and finishes at the far edge", () => {
    for (const start of [0, 0.35, 0.6, 0.75, 0.94, 1]) {
      const points = ripWaypoints(start);
      expect(points[0]).toBeCloseTo(start, 10);
      expect(points[points.length - 1]).toBe(1);
    }
  });

  /**
   * The shaping, stated as the thing it is for rather than as a curve. Material
   * under tension resists and then goes, so the opening stretch has to be the
   * slowest of them by a margin somebody can see — a rip that travels evenly is
   * a wipe. What happens after the fast stretch is not pinned: the tail easing
   * off as the tear completes is fine, and is what the current numbers do.
   */
  it("resists before it runs, rather than travelling evenly", () => {
    const points = ripWaypoints(0);
    const rates = points
      .slice(1)
      .map((p, i) => (p - points[i]) / (RIP_TIMES[i + 1] - RIP_TIMES[i]));
    expect(Math.min(...rates)).toBe(rates[0]);
    expect(Math.max(...rates)).toBeGreaterThan(rates[0] * 1.5);
  });

  it("has one time for every waypoint, or motion silently drops some", () => {
    expect(RIP_TIMES.length).toBe(ripWaypoints(0).length);
    expect(RIP_TIMES[0]).toBe(0);
    expect(RIP_TIMES[RIP_TIMES.length - 1]).toBe(1);
  });

  it("survives a commit the gesture should not have been able to make", () => {
    expect(ripWaypoints(1)).toEqual([1, 1, 1, 1]);
    expect(ripWaypoints(-0.5)[0]).toBe(0);
  });
});

describe("body and strip, as one image", () => {
  /**
   * The artwork-continuity guarantee, as arithmetic. At rest the strip layer
   * contributes nothing and the body layer is the whole pack, so what is on
   * screen is a single uninterrupted picture — there is no frame at which the
   * viewer could notice it has become two elements.
   */
  it("is the whole pack and nothing else before the rip starts", () => {
    for (const [, y] of vertices(bodyClipAt(edge, 0)).slice(0, edge.length)) {
      expect(y).toBe(0);
    }
    for (const [, y] of vertices(stripClipAt(edge, 0)).slice(2)) {
      expect(y).toBe(0);
    }
  });

  it("hands the strip the whole tear line once the rip is through", () => {
    const strip = vertices(stripClipAt(edge, 1)).slice(2);
    // Reversed, so compare against the edge read the other way.
    const want = [...edge].reverse().map((p) => +p.y.toFixed(1));
    expect(strip.map(([, y]) => y)).toEqual(want);
  });

  /**
   * Complementary at every front, not just at the ends. Two clip strings kept in
   * step by hand would be one edit away from a hairline of background showing
   * through the middle of the pack.
   */
  it("shares one boundary with the body at every point of the rip", () => {
    for (const f of [0, 0.15, 0.4, 0.63, 0.9, 1]) {
      const body = vertices(bodyClipAt(edge, f)).slice(0, edge.length);
      const strip = vertices(stripClipAt(edge, f)).slice(2).reverse();
      expect(strip).toEqual(body);
    }
  });

  it("keeps a constant vertex count, so it can be animated at all", () => {
    const counts = [0, 0.3, 0.7, 1].map((f) => vertices(bodyClipAt(edge, f)).length);
    expect(new Set(counts).size).toBe(1);
  });
});

describe("the exposed fibre", () => {
  it("sits just under the boundary rather than anywhere of its own", () => {
    const core = vertices(coreClipAt(edge, 0.6));
    const over = core.slice(0, edge.length);
    const under = core.slice(edge.length).reverse();
    for (let i = 0; i < edge.length; i++) {
      expect(under[i][1] - over[i][1]).toBeCloseTo(1.4, 5);
    }
  });
});

describe("the mouth", () => {
  /**
   * motion interpolates between two polygon strings and can only do it when they
   * agree on how many corners they have. This is the invariant that makes the
   * cards read as emerging rather than as appearing.
   */
  it("has the same corners open as it does shut", () => {
    expect(vertices(mouthClip(edge, 0)).length).toBe(vertices(mouthClip(edge, 1)).length);
  });

  it("runs well past the pack, so a spread fan is not clipped by it", () => {
    const xs = vertices(mouthClip(edge, 0)).map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-50);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(150);
  });

  it("drops the tear line clean off the bottom when fully open", () => {
    const shut = vertices(mouthClip(edge, 0));
    const open = vertices(mouthClip(edge, 1));
    for (let i = 2; i < shut.length; i++) {
      expect(open[i][1]).toBeCloseTo(shut[i][1] + 150, 5);
    }
  });
});

describe("the segments", () => {
  it("tile the whole edge with no gap and no overlap", () => {
    expect(TEAR_SEGMENTS[0][0]).toBe(0);
    expect(TEAR_SEGMENTS[TEAR_SEGMENTS.length - 1][1]).toBe(edge.length - 1);
    for (let k = 1; k < TEAR_SEGMENTS.length; k++) {
      expect(TEAR_SEGMENTS[k][0]).toBe(TEAR_SEGMENTS[k - 1][1]);
    }
  });

  /**
   * Sharing the boundary vertex is what stops the strip looking like four pieces
   * that were always there — while they are still together there is no seam.
   */
  it("share their boundary vertices with their neighbours", () => {
    for (let k = 1; k < TEAR_SEGMENTS.length; k++) {
      const left = vertices(segmentClipAt(edge, 1, ...TEAR_SEGMENTS[k - 1]));
      const right = vertices(segmentClipAt(edge, 1, ...TEAR_SEGMENTS[k]));
      // The left piece's last boundary point is the right piece's first.
      expect(left[2][0]).toBeCloseTo(right[right.length - 1][0], 5);
    }
  });

  it("are deliberately unequal, because foil is not", () => {
    const widths = TEAR_SEGMENTS.map(([a, b]) => b - a);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it("has one flight per segment", () => {
    expect(SEGMENT_FLIGHT.length).toBe(TEAR_SEGMENTS.length);
  });

  it("sends every piece up and away, none of them politely straight", () => {
    for (const f of SEGMENT_FLIGHT) {
      expect(f.y).toBeLessThan(-100);
      expect(Math.abs(f.rz)).toBeGreaterThan(5);
      expect(f.rx).toBeGreaterThan(0);
    }
  });

  it("does not let a piece outlive the fan it would be litter behind", () => {
    for (const f of SEGMENT_FLIGHT) expect(f.sec).toBeLessThan(0.6);
  });
});

describe("how the segments let go", () => {
  it("holds every piece down before the rip starts", () => {
    for (let k = 0; k < TEAR_SEGMENTS.length; k++) expect(segmentLift(0, k)).toBe(0);
  });

  it("frees every piece by the time the rip is through", () => {
    for (let k = 0; k < TEAR_SEGMENTS.length; k++) expect(segmentLift(1, k)).toBe(1);
  });

  /**
   * The lag is the flexibility. If every piece lifted together the strip would
   * be a rigid panel again, whatever it is clipped into.
   */
  it("frees them left to right rather than all at once", () => {
    for (const f of [0.3, 0.5, 0.7]) {
      const lifts = TEAR_SEGMENTS.map((_, k) => segmentLift(f, k));
      for (let k = 1; k < lifts.length; k++) {
        expect(lifts[k]).toBeLessThanOrEqual(lifts[k - 1]);
      }
      // And at least one pair genuinely disagrees, or "left to right" is vacuous.
      expect(lifts[0]).toBeGreaterThan(lifts[lifts.length - 1]);
    }
  });

  it("only ever lets go further as the front travels", () => {
    for (let k = 0; k < TEAR_SEGMENTS.length; k++) {
      let last = -1;
      for (let f = 0; f <= 1.0001; f += 0.02) {
        const lift = segmentLift(f, k);
        expect(lift).toBeGreaterThanOrEqual(last);
        last = lift;
      }
    }
  });
});

describe("the deformation", () => {
  it("is the same rip for the same pack, every time", () => {
    expect(segmentPose("pack-a", 2)).toEqual(segmentPose("pack-a", 2));
  });

  it("is a different rip for a different pack", () => {
    expect(segmentPose("pack-a", 2)).not.toEqual(segmentPose("pack-b", 2));
  });

  /** Four pieces that agree are one piece. */
  it("gives every piece its own pose", () => {
    const poses = TEAR_SEGMENTS.map((_, k) => JSON.stringify(segmentPose("pack-a", k)));
    expect(new Set(poses).size).toBe(TEAR_SEGMENTS.length);
  });

  it("curls the far end harder than the near one, as tension would", () => {
    const first = segmentPose("pack-a", 0);
    const last = segmentPose("pack-a", TEAR_SEGMENTS.length - 1);
    expect(last.curl).toBeGreaterThan(first.curl);
    expect(Math.abs(last.lean)).toBeGreaterThan(Math.abs(first.lean));
  });

  it("bends through the middle rather than breathing as one", () => {
    const squeezes = TEAR_SEGMENTS.map((_, k) => segmentPose("pack-a", k).squeeze - 1);
    for (let k = 1; k < squeezes.length; k++) {
      expect(Math.sign(squeezes[k])).not.toBe(Math.sign(squeezes[k - 1]));
    }
  });

  /**
   * Handled rather than broken. Past about 30 degrees of curl the strip folds
   * through itself, and a squeeze past a few percent reads as the artwork
   * stretching rather than as the material flexing.
   */
  it("stays inside the range where it reads as material rather than as a glitch", () => {
    for (let k = 0; k < TEAR_SEGMENTS.length; k++) {
      const pose = segmentPose("pack-a", k);
      expect(pose.curl).toBeGreaterThan(10);
      expect(pose.curl).toBeLessThan(34);
      expect(Math.abs(pose.lean)).toBeLessThan(26);
      expect(pose.lag).toBeGreaterThanOrEqual(0);
      expect(pose.lag).toBeLessThan(8);
      expect(Math.abs(pose.squeeze - 1)).toBeLessThan(0.05);
    }
  });

  /** The brief's own range for the strip as a whole, pinned so it cannot drift. */
  it("rotates the strip by fifteen to twenty-five degrees overall", () => {
    const leans = TEAR_SEGMENTS.map((_, k) => Math.abs(segmentPose("pack-a", k).lean));
    const spread = Math.max(...leans) - Math.min(...leans);
    expect(spread).toBeGreaterThan(8);
    expect(Math.max(...leans)).toBeGreaterThan(15);
    expect(Math.max(...leans)).toBeLessThan(25);
  });
});
