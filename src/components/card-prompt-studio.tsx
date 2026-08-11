import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCopy, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AdminSection } from "@/components/admin-section";
import {
  CardPromptBatch,
  CardPromptHistory,
  CardPromptTemplateManager,
  type PromptHistoryRow,
} from "@/components/card-prompt-tools";
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
import type { StatsBundle } from "@/lib/card-stats";
import { formatKnownPerformanceData, restoredEventParticipantId } from "@/lib/card-prompt-data";
import { listCardPromptTemplates, saveCardPromptRun } from "@/lib/card-prompt.functions";
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

export function CardPromptStudio({ eventId, eventName, bundle, photoUrls }: CardPromptStudioProps) {
  const listTemplatesFn = useServerFn(listCardPromptTemplates);
  const saveRunFn = useServerFn(saveCardPromptRun);
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ["card-prompt-templates"],
    queryFn: () => listTemplatesFn(),
    staleTime: 60_000,
  });
  const [series, setSeries] = useState<CardSeriesId>("draft_combine_player");
  const [eventParticipantId, setEventParticipantId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [association, setAssociation] = useState("");
  const [teamName, setTeamName] = useState("");
  const [colors, setColors] = useState("");
  const [about, setAbout] = useState("");
  const [visualMustHaves, setVisualMustHaves] = useState("");
  const [generated, setGenerated] = useState<{
    prompt: string;
    series: CardSeriesId;
    subjectName: string;
    inputSnapshot: Record<string, unknown>;
    eventParticipantId?: string;
    historyId?: string;
  } | null>(null);
  const [revision, setRevision] = useState("");
  const [revisionSaving, setRevisionSaving] = useState(false);
  const historySave = useRef<Promise<string | undefined> | null>(null);
  const historySaveToken = useRef<object | null>(null);

  const playerSeries = isPlayerSeries(series);
  const selected = bundle?.participants.find(
    (participant) => participant.id === eventParticipantId,
  );
  // The name field is always editable, but a player series still falls back to the
  // roster name so an admin never has to retype it.
  const effectiveName = subjectName.trim() || (playerSeries ? (selected?.participant?.name ?? "") : "");
  const teamSeries = series === "cornhole_player";
  const photoUrl = selected
    ? (urlFromSet(photoUrls?.[selected.id]) ?? selected.participant?.profile_image_url ?? undefined)
    : undefined;
  const subjectReady = playerSeries
    ? !!selected && !!effectiveName
    : !!effectiveName && !!association.trim();
  // A failed request intentionally falls back to the built-in templates. A request
  // still in flight is different: generating then could permanently snapshot stale text.
  const canGenerate = subjectReady && !templates.isPending;

  const knownData = useMemo(
    () =>
      playerSeries && selected && bundle
        ? formatKnownPerformanceData(bundle, selected.participant_id)
        : undefined,
    [bundle, playerSeries, selected],
  );
  const persistedTemplate = templates.data?.templates?.find(
    (item: { slug: string }) => item.slug === series,
  );
  const effectiveMasterPrompt =
    typeof persistedTemplate?.master_prompt === "string" && persistedTemplate.master_prompt.trim()
      ? persistedTemplate.master_prompt
      : CARD_SERIES[series].prompt;

  function generate() {
    if (!canGenerate) return;
    historySave.current = null;
    const inputSnapshot = {
      series,
      eventParticipantId: playerSeries ? (selected?.id ?? null) : null,
      subjectName: effectiveName,
      association,
      teamName,
      colors,
      about,
      visualMustHaves,
    };
    setGenerated({
      prompt: buildCardPrompt({
        series,
        eventName,
        subjectName: effectiveName,
        nickname: playerSeries ? (selected?.participant?.nickname ?? undefined) : undefined,
        association: playerSeries ? undefined : association,
        teamName: teamSeries ? teamName : undefined,
        knownData,
        colors,
        about,
        visualMustHaves,
        referencePhotoUrl: photoUrl,
        masterPrompt: effectiveMasterPrompt,
      }),
      series,
      subjectName: effectiveName,
      inputSnapshot,
      eventParticipantId: playerSeries ? selected?.id : undefined,
    });
  }

  function saveInitialAfterCopy(): Promise<string | undefined> {
    if (!generated) return Promise.resolve(undefined);
    if (generated.historyId) return Promise.resolve(generated.historyId);
    if (historySave.current) return historySave.current;
    const token = {};
    historySaveToken.current = token;
    const task: Promise<string | undefined> = (async () => {
      try {
        const row = await saveRunFn({
          data: {
            eventId,
            templateId: persistedTemplate?.id ?? null,
            templateSlug: generated.series,
            templateName: CARD_SERIES[generated.series].label,
            eventParticipantId: generated.eventParticipantId ?? null,
            subjectName: generated.subjectName,
            inputSnapshot: generated.inputSnapshot,
            generatedPrompt: generated.prompt,
            kind: "initial",
          },
        });
        setGenerated((current) =>
          current?.prompt === generated.prompt ? { ...current, historyId: row.id } : current,
        );
        await qc.invalidateQueries({ queryKey: ["card-prompt-runs", eventId] });
        return row.id as string;
      } catch {
        toast.warning("Prompt copied, but history could not be saved");
        return undefined;
      } finally {
        if (historySaveToken.current === token) {
          historySave.current = null;
          historySaveToken.current = null;
        }
      }
    })();
    historySave.current = task;
    return task;
  }

  async function copyInitial() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.prompt);
      toast.success("Prompt copied");
      void saveInitialAfterCopy();
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  async function copyRevision() {
    if (!generated || !revision.trim() || revisionSaving) return;
    setRevisionSaving(true);
    const prompt = buildRevisionPrompt({
      series: generated.series,
      subjectName: generated.subjectName,
      changes: revision,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Revision prompt copied");
      try {
        const parentId = await saveInitialAfterCopy();
        if (!parentId) throw new Error("Original prompt history unavailable");
        setGenerated((current) => (current ? { ...current, historyId: parentId } : current));
        await saveRunFn({
          data: {
            eventId,
            templateId: persistedTemplate?.id ?? null,
            templateSlug: generated.series,
            templateName: CARD_SERIES[generated.series].label,
            eventParticipantId: generated.eventParticipantId ?? null,
            subjectName: generated.subjectName,
            inputSnapshot: generated.inputSnapshot,
            generatedPrompt: prompt,
            kind: "revision",
            parentPromptId: parentId,
            revisionInstruction: revision,
          },
        });
        await qc.invalidateQueries({ queryKey: ["card-prompt-runs", eventId] });
      } catch {
        toast.warning("Revision copied, but history could not be saved");
      }
    } catch {
      toast.error("Could not copy to clipboard");
    } finally {
      setRevisionSaving(false);
    }
  }

  function loadHistory(row: PromptHistoryRow) {
    const snap = row.input_snapshot ?? {};
    if (typeof snap.series === "string" && snap.series in CARD_SERIES)
      setSeries(snap.series as CardSeriesId);
    const participantId = restoredEventParticipantId(snap, row.event_participant_id);
    if (participantId) setEventParticipantId(participantId);
    if (typeof snap.subjectName === "string") setSubjectName(snap.subjectName);
    if (typeof snap.association === "string") setAssociation(snap.association);
    if (typeof snap.teamName === "string") setTeamName(snap.teamName);
    if (typeof snap.colors === "string") setColors(snap.colors);
    if (typeof snap.about === "string") setAbout(snap.about);
    if (typeof snap.visualMustHaves === "string") setVisualMustHaves(snap.visualMustHaves);
    setRevision(row.kind === "revision" ? (row.revision_instruction ?? "") : "");
    setGenerated({
      prompt: row.generated_prompt,
      series: row.template_slug as CardSeriesId,
      subjectName: row.subject_name,
      inputSnapshot: snap,
      eventParticipantId: row.event_participant_id ?? undefined,
      historyId: row.kind === "initial" ? row.id : (row.parent_prompt_id ?? undefined),
    });
  }

  const fieldClass = "space-y-1.5";
  return (
    <AdminSection icon={<Sparkles className="h-4 w-4 shrink-0" />} title="Card Prompt Studio">
      <div className="mb-4 flex flex-wrap gap-2">
        <CardPromptTemplateManager templates={templates.data?.templates ?? []} />
      </div>
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
            onClick={copyInitial}
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
            disabled={!generated || !revision.trim() || revisionSaving}
            onClick={copyRevision}
          >
            <ClipboardCopy className="mr-2 h-4 w-4" />
            {revisionSaving ? "Saving revision…" : "Copy revision prompt"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Master: {CARD_SERIES[series].label}. Revision instructions preserve everything you do
            not explicitly change.
          </p>
        </div>
      </div>
      <CardPromptBatch
        eventId={eventId}
        eventName={eventName}
        bundle={bundle}
        photoUrls={photoUrls}
        templates={templates.data?.templates ?? []}
        templatesReady={!templates.isPending}
      />
      <CardPromptHistory eventId={eventId} onLoad={loadHistory} />
    </AdminSection>
  );
}
