import { useMemo, useState } from "react";
import { ClipboardCopy, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cardStats, type StatsBundle } from "@/lib/card-stats";
import { formatTime } from "@/lib/format";
import { urlFromSet, type ImageUrlSet } from "@/lib/media";
import {
  CARD_SERIES,
  CARD_SERIES_OPTIONS,
  buildCardPrompt,
  buildRevisionPrompt,
  isPlayerSeries,
  type CardSeriesId,
} from "@/lib/card-prompt-templates";

export type PromptStudioBundle = StatsBundle & {
  participants: Array<{
    id: string;
    participant_id: string;
    participant: {
      name: string;
      nickname: string | null;
      profile_image_url?: string | null;
    } | null;
  }>;
};

export type CardPromptStudioProps = {
  eventId: string;
  eventName: string;
  bundle: PromptStudioBundle | null | undefined;
  photoUrls: Record<string, ImageUrlSet | string> | undefined;
};

export function formatKnownPerformanceData(bundle: StatsBundle, participantId: string): string {
  const stats = cardStats(bundle, participantId);
  if (!stats.bestRun || stats.bestRun.official_time_ms == null) {
    return "Official run: unavailable\nRank: unavailable\nStation splits: unavailable";
  }
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

export function CardPromptStudio({ eventName, bundle, photoUrls }: CardPromptStudioProps) {
  const [series, setSeries] = useState<CardSeriesId>("draft_combine_player");
  const [eventParticipantId, setEventParticipantId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [association, setAssociation] = useState("");
  const [colors, setColors] = useState("");
  const [about, setAbout] = useState("");
  const [visualMustHaves, setVisualMustHaves] = useState("");
  const [generated, setGenerated] = useState<{
    prompt: string;
    series: CardSeriesId;
    subjectName: string;
  } | null>(null);
  const [revision, setRevision] = useState("");

  const playerSeries = isPlayerSeries(series);
  const selected = bundle?.participants.find(
    (participant) => participant.id === eventParticipantId,
  );
  const effectiveName = playerSeries ? (selected?.participant?.name ?? "") : subjectName;
  const photoUrl = selected
    ? (urlFromSet(photoUrls?.[selected.id]) ?? selected.participant?.profile_image_url ?? undefined)
    : undefined;
  const canGenerate = playerSeries
    ? !!selected?.participant?.name
    : !!subjectName.trim() && !!association.trim();

  const knownData = useMemo(
    () =>
      playerSeries && selected && bundle
        ? formatKnownPerformanceData(bundle, selected.participant_id)
        : undefined,
    [bundle, playerSeries, selected],
  );

  function generate() {
    if (!canGenerate) return;
    setGenerated({
      prompt: buildCardPrompt({
        series,
        eventName,
        subjectName: effectiveName,
        nickname: playerSeries ? (selected?.participant?.nickname ?? undefined) : undefined,
        association: playerSeries ? undefined : association,
        knownData,
        colors,
        about,
        visualMustHaves,
        referencePhotoUrl: photoUrl,
      }),
      series,
      subjectName: effectiveName,
    });
  }

  async function copy(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(success);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  const fieldClass = "space-y-1.5";
  return (
    <AdminSection icon={<Sparkles className="h-4 w-4 shrink-0" />} title="Card Prompt Studio">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className={fieldClass}>
            <Label htmlFor="prompt-series">Series</Label>
            <Select
              value={series}
              onValueChange={(value: CardSeriesId) => {
                setSeries(value);
                setGenerated(null);
              }}
            >
              <SelectTrigger id="prompt-series" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARD_SERIES_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {playerSeries ? (
            <div className={fieldClass}>
              <Label htmlFor="prompt-participant">Participant</Label>
              <Select value={eventParticipantId} onValueChange={setEventParticipantId}>
                <SelectTrigger id="prompt-participant" className="min-h-11">
                  <SelectValue placeholder="Choose a participant" />
                </SelectTrigger>
                <SelectContent>
                  {(bundle?.participants ?? []).map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      {ep.participant?.name ?? "Unknown"}
                      {ep.participant?.nickname ? ` “${ep.participant.nickname}”` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected?.participant && (
                <p className="text-xs text-muted-foreground">
                  Name: {selected.participant.name}
                  {selected.participant.nickname
                    ? ` · Nickname: ${selected.participant.nickname}`
                    : ""}
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={fieldClass}>
                <Label htmlFor="prompt-subject">Subject name</Label>
                <Input
                  id="prompt-subject"
                  className="min-h-11"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                />
              </div>
              <div className={fieldClass}>
                <Label htmlFor="prompt-association">Owner / association</Label>
                <Input
                  id="prompt-association"
                  className="min-h-11"
                  value={association}
                  onChange={(e) => setAssociation(e.target.value)}
                />
              </div>
            </div>
          )}

          {playerSeries && selected && (
            <div className="rounded-md border border-white/10 p-3">
              {photoUrl ? (
                <div className="flex gap-3">
                  <img
                    src={photoUrl}
                    alt={`${effectiveName} reference`}
                    className="h-24 w-24 rounded object-cover"
                  />
                  <div className="text-xs text-muted-foreground">
                    <a
                      href={photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Open / download photo
                    </a>
                    <p className="mt-2">
                      You must still attach this photograph manually in ChatGPT.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No participant photograph is currently available. Add it in Participant Photos
                  first; this studio does not upload images.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className={fieldClass}>
              <Label htmlFor="prompt-colors">Colors</Label>
              <Input
                id="prompt-colors"
                className="min-h-11"
                value={colors}
                onChange={(e) => setColors(e.target.value)}
                placeholder="Team colors, accents…"
              />
            </div>
            <div className={fieldClass}>
              <Label htmlFor="prompt-visuals">Visual must-haves</Label>
              <Input
                id="prompt-visuals"
                className="min-h-11"
                value={visualMustHaves}
                onChange={(e) => setVisualMustHaves(e.target.value)}
                placeholder="Props, clothes, scenery…"
              />
            </div>
          </div>
          <div className={fieldClass}>
            <Label htmlFor="prompt-about">Tell me about this card</Label>
            <Textarea
              id="prompt-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Personality, stories, inside jokes, tone…"
            />
          </div>
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!canGenerate}
            onClick={generate}
          >
            Generate prompt
          </Button>
        </div>

        <div className="space-y-4">
          <div className={fieldClass}>
            <Label htmlFor="generated-prompt">Generated prompt preview</Label>
            <Textarea
              id="generated-prompt"
              value={generated?.prompt ?? ""}
              readOnly
              className="min-h-72 font-mono text-xs"
              placeholder="Complete the required subject fields, then generate."
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full"
            disabled={!generated}
            onClick={() => generated && copy(generated.prompt, "Prompt copied")}
          >
            <ClipboardCopy className="mr-2 h-4 w-4" /> Copy prompt
          </Button>
          <div className={fieldClass}>
            <Label htmlFor="revision-instructions">Revision instructions</Label>
            <Textarea
              id="revision-instructions"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="Describe only what should change…"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full"
            disabled={!generated || !revision.trim()}
            onClick={() =>
              copy(
                buildRevisionPrompt({
                  series: generated!.series,
                  subjectName: generated!.subjectName,
                  changes: revision,
                }),
                "Revision prompt copied",
              )
            }
          >
            <ClipboardCopy className="mr-2 h-4 w-4" /> Copy revision prompt
          </Button>
          <p className="text-xs text-muted-foreground">
            Master: {CARD_SERIES[series].label}. Revision instructions preserve everything you do
            not explicitly change.
          </p>
        </div>
      </div>
    </AdminSection>
  );
}
