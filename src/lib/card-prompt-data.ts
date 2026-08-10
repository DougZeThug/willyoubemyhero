import { cardStats, type StatsBundle } from "./card-stats";
import { formatTime } from "./format";
import { buildCardPrompt, type CardPromptInput } from "./card-prompt-templates";

export function formatKnownPerformanceData(bundle: StatsBundle, participantId: string): string {
  const stats = cardStats(bundle, participantId);
  if (!stats.bestRun || stats.bestRun.official_time_ms == null)
    return "Official run: unavailable\nRank: unavailable\nStation splits: unavailable";
  const lines = [
    `Rank: ${stats.rank == null ? "unavailable" : `${stats.rank} of ${stats.fieldSize}`}`,
    `Best official time: ${formatTime(stats.bestRun.official_time_ms)}`,
    "Ordered station segments:",
  ];
  for (const row of stats.ladder) {
    const time = row.ms == null ? "unavailable" : formatTime(row.ms);
    const delta =
      row.deltaMs == null
        ? "median delta unavailable"
        : `${row.deltaMs >= 0 ? "+" : "−"}${formatTime(Math.abs(row.deltaMs))} vs field median`;
    const best =
      row.ms == null ? "station-best unavailable" : row.best ? "station best" : "not station best";
    lines.push(`- ${row.label}: ${time}; ${delta}; ${best}`);
  }
  return lines.join("\n");
}

export type BatchPromptItem = {
  key: string;
  subjectName: string;
  eventParticipantId?: string;
  prompt: string;
  input: CardPromptInput;
};
export function buildBatchPrompts(
  inputs: Array<{ key: string; eventParticipantId?: string; input: CardPromptInput }>,
): BatchPromptItem[] {
  return inputs
    .filter(({ input }) => input.subjectName.trim())
    .map(({ key, eventParticipantId, input }) => ({
      key,
      eventParticipantId,
      subjectName: input.subjectName.trim(),
      prompt: buildCardPrompt(input),
      input,
    }));
}
