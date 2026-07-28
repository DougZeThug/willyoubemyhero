// Drives the finish celebration on /live and /tv. Firing on the initial load
// would replay every finish of the day at once; not firing on a new result
// means the room misses the moment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFinishWatcher } from "./use-finish-watcher";
import { makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

beforeEach(resetFixtureIds);

function bundleWith(
  runs: ReturnType<typeof makeRun>[],
  parts: ReturnType<typeof makeParticipant>[],
) {
  return makeBundle({ participants: parts, runs });
}

describe("useFinishWatcher", () => {
  it("does nothing without a bundle", () => {
    const onFinish = vi.fn();
    renderHook(() => useFinishWatcher(null, onFinish));
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("stays quiet on the first bundle, however many finishes it holds", () => {
    // Otherwise opening /live mid-event fires a celebration per finished run.
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: "p2", name: "Bob", nickname: null } });
    const onFinish = vi.fn();
    renderHook(() =>
      useFinishWatcher(
        bundleWith(
          [
            makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 }),
            makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 }),
          ],
          [alice, bob],
        ),
        onFinish,
      ),
    );
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("fires once for a run that appears after the first render", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: "p2", name: "Bob", nickname: null } });
    const aliceRun = makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 });
    const onFinish = vi.fn();

    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([aliceRun], [alice, bob]) },
    });
    expect(onFinish).not.toHaveBeenCalled();

    const bobRun = makeRun({ participant_id: bob.participant_id, official_time_ms: 62_500 });
    rerender({ bundle: bundleWith([aliceRun, bobRun], [alice, bob]) });

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ name: "Bob", timeMs: 62_500, deltaMs: 12_500 });
  });

  it("reports a zero gap when the new run takes the lead", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: "p2", name: "Bob", nickname: null } });
    const aliceRun = makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 });
    const onFinish = vi.fn();

    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([aliceRun], [alice, bob]) },
    });
    const bobRun = makeRun({ participant_id: bob.participant_id, official_time_ms: 40_000 });
    rerender({ bundle: bundleWith([aliceRun, bobRun], [alice, bob]) });

    expect(onFinish).toHaveBeenCalledWith({ name: "Bob", timeMs: 40_000, deltaMs: 0 });
  });

  it("does not re-fire when the same bundle renders again", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const aliceRun = makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 });
    const onFinish = vi.fn();

    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([], [alice]) },
    });
    const withRun = bundleWith([aliceRun], [alice]);
    rerender({ bundle: withRun });
    expect(onFinish).toHaveBeenCalledTimes(1);

    // A realtime invalidation refetches and hands back an equivalent bundle.
    rerender({ bundle: bundleWith([aliceRun], [alice]) });
    rerender({ bundle: bundleWith([aliceRun], [alice]) });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("ignores unofficial runs", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const onFinish = vi.fn();
    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([], [alice]) },
    });
    rerender({
      bundle: bundleWith(
        [makeRun({ participant_id: alice.participant_id, is_official: false })],
        [alice],
      ),
    });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("falls back to a generic name for a run with no matching participant", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const onFinish = vi.fn();
    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([], [alice]) },
    });
    rerender({
      bundle: bundleWith(
        [makeRun({ participant_id: "unknown", official_time_ms: 1_000 })],
        [alice],
      ),
    });
    expect(onFinish).toHaveBeenCalledWith({ name: "Athlete", timeMs: 1_000, deltaMs: 0 });
  });

  it("fires for each of several new runs at once", () => {
    const alice = makeParticipant({ participant: { id: "p1", name: "Alice", nickname: null } });
    const bob = makeParticipant({ participant: { id: "p2", name: "Bob", nickname: null } });
    const onFinish = vi.fn();
    const { rerender } = renderHook(({ bundle }) => useFinishWatcher(bundle, onFinish), {
      initialProps: { bundle: bundleWith([], [alice, bob]) },
    });
    rerender({
      bundle: bundleWith(
        [
          makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 }),
          makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 }),
        ],
        [alice, bob],
      ),
    });
    expect(onFinish).toHaveBeenCalledTimes(2);
  });
});
