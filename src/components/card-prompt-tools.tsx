import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Checkbox } from "./ui/checkbox";
import {
  CARD_SERIES,
  CARD_SERIES_OPTIONS,
  isPlayerSeries,
  type CardSeriesId,
} from "@/lib/card-prompt-templates";
import {
  buildBatchPrompts,
  formatKnownPerformanceData,
  standaloneBatchRowsValid,
  type BatchPromptItem,
} from "@/lib/card-prompt-data";
import {
  listCardPromptRuns,
  saveCardPromptRun,
  updateCardPromptTemplate,
} from "@/lib/card-prompt.functions";
import { urlFromSet, type ImageUrlSet } from "@/lib/media";
import type { PromptStudioBundle } from "./card-prompt-studio";

export type PromptTemplateRow = { id: string; slug: string; name: string; master_prompt: string };
export type PromptHistoryRow = {
  id: string;
  template_slug: string;
  template_name_snapshot: string;
  event_participant_id: string | null;
  subject_name: string;
  input_snapshot: Record<string, unknown>;
  generated_prompt: string;
  kind: "initial" | "revision";
  parent_prompt_id: string | null;
  revision_instruction: string | null;
  created_at: string;
};

export function CardPromptTemplateManager({ templates }: { templates: PromptTemplateRow[] }) {
  const updateFn = useServerFn(updateCardPromptTemplate);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState<CardSeriesId>("draft_combine_player");
  const persisted = templates.find((row) => row.slug === slug);
  const effective = persisted?.master_prompt || CARD_SERIES[slug].prompt;
  const [drafts, setDrafts] = useState<Partial<Record<CardSeriesId, string>>>({});
  const draft = drafts[slug] ?? effective;
  async function save(value = draft) {
    try {
      await updateFn({ data: { slug, masterPrompt: value } });
      await qc.invalidateQueries({ queryKey: ["card-prompt-templates"] });
      setDrafts((d) => ({ ...d, [slug]: value }));
      toast.success("Series prompt saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save prompt");
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="min-h-11">
          Manage Series Prompts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Manage Series Prompts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {CARD_SERIES_OPTIONS.map((option) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={slug === option.id ? "default" : "secondary"}
              onClick={() => setSlug(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Label htmlFor="master-prompt">Master prompt</Label>
        <Textarea
          id="master-prompt"
          className="min-h-72 text-base"
          value={draft}
          onChange={(e) => setDrafts((d) => ({ ...d, [slug]: e.target.value }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="min-h-11"
            disabled={draft.trim().length < 20}
            onClick={() => save()}
          >
            Save
          </Button>
          <Button
            type="button"
            className="min-h-11"
            variant="outline"
            onClick={() => {
              if (confirm("Reset this series to its built-in prompt?"))
                void save(CARD_SERIES[slug].prompt);
            }}
          >
            Reset to built-in default
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CardPromptHistory({
  eventId,
  onLoad,
}: {
  eventId: string;
  onLoad: (row: PromptHistoryRow) => void;
}) {
  const listFn = useServerFn(listCardPromptRuns);
  const history = useQuery({
    queryKey: ["card-prompt-runs", eventId],
    queryFn: () => listFn({ data: { eventId, limit: 30 } }),
    staleTime: 10_000,
  });
  const rows = (history.data?.runs ?? []) as PromptHistoryRow[];
  return (
    <details className="mt-5 rounded-md border border-white/10 p-3">
      <summary className="min-h-11 cursor-pointer font-display text-xs font-bold uppercase tracking-widest">
        Recent Prompts ({rows.length})
      </summary>
      <div className="mt-2 max-h-80 space-y-2 overflow-auto">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex min-w-0 flex-col gap-2 rounded border border-white/5 p-2 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{row.subject_name}</p>
              <p className="text-xs text-muted-foreground">
                {row.template_name_snapshot} · {row.kind}
                {row.parent_prompt_id ? " · linked revision" : ""} ·{" "}
                {new Date(row.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => onLoad(row)}>
                Load
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(row.generated_prompt);
                    toast.success("Historical prompt copied");
                  } catch {
                    toast.error("Could not copy to clipboard");
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        ))}
        {history.isError ? (
          <p className="text-xs text-destructive">Prompt history could not be loaded.</p>
        ) : (
          !rows.length && <p className="text-xs text-muted-foreground">No saved prompts yet.</p>
        )}
      </div>
    </details>
  );
}

type SubjectDraft = {
  key: string;
  name: string;
  association: string;
  notes: string;
  colors: string;
  visuals: string;
};
export function CardPromptBatch({
  eventId,
  eventName,
  bundle,
  photoUrls,
  templates,
  templatesReady,
}: {
  eventId: string;
  eventName: string;
  bundle: PromptStudioBundle | null | undefined;
  photoUrls: Record<string, ImageUrlSet | string> | undefined;
  templates: PromptTemplateRow[];
  templatesReady: boolean;
}) {
  const saveFn = useServerFn(saveCardPromptRun);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [series, setSeries] = useState<CardSeriesId>("draft_combine_player");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [shared, setShared] = useState("");
  const [subjects, setSubjects] = useState<SubjectDraft[]>([
    { key: "subject-1", name: "", association: "", notes: "", colors: "", visuals: "" },
  ]);
  const [queue, setQueue] = useState<BatchPromptItem[]>([]);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const saved = useMemo(() => new Map<string, string>(), []);
  const savingKeysRef = useRef(new Set<string>());
  const [savingKeys, setSavingKeys] = useState<ReadonlySet<string>>(new Set());
  const players = useMemo(
    () =>
      [...(bundle?.participants ?? [])].sort(
        (a, b) =>
          ((a as { running_order?: number }).running_order ?? 0) -
          ((b as { running_order?: number }).running_order ?? 0),
      ),
    [bundle],
  );
  const availablePlayers = useMemo(
    () => players.filter((participant) => participant.participant),
    [players],
  );
  const masterPrompt =
    templates.find((row) => row.slug === series)?.master_prompt || CARD_SERIES[series].prompt;
  const standaloneRowsValid = standaloneBatchRowsValid(subjects);
  const batchReady =
    templatesReady &&
    (isPlayerSeries(series)
      ? availablePlayers.some((participant) => selected.has(participant.id))
      : standaloneRowsValid);
  function build() {
    const inputs = isPlayerSeries(series)
      ? players
          .filter((ep) => selected.has(ep.id) && ep.participant)
          .map((ep) => ({
            key: ep.id,
            eventParticipantId: ep.id,
            input: {
              series,
              eventName,
              subjectName: ep.participant!.name,
              nickname: ep.participant!.nickname ?? undefined,
              knownData: bundle ? formatKnownPerformanceData(bundle, ep.participant_id) : undefined,
              about: [shared, notes[ep.id]].filter(Boolean).join("\nSubject-specific notes: "),
              referencePhotoUrl:
                urlFromSet(photoUrls?.[ep.id]) ?? ep.participant!.profile_image_url ?? undefined,
              masterPrompt,
            },
          }))
      : subjects
          .filter((subject) => subject.name.trim() && subject.association.trim())
          .map((subject) => ({
            key: subject.key,
            input: {
              series,
              eventName,
              subjectName: subject.name,
              association: subject.association,
              about: [shared, subject.notes].filter(Boolean).join("\nSubject-specific notes: "),
              colors: subject.colors,
              visualMustHaves: subject.visuals,
              masterPrompt,
            },
          }));
    const next = buildBatchPrompts(inputs);
    setQueue(next);
    setIndex(0);
    setCopied(new Set());
    saved.clear();
    savingKeysRef.current.clear();
    setSavingKeys(new Set());
  }
  async function copyCurrent(advance: boolean) {
    const item = queue[index];
    if (!item) return;
    const needsHistorySave = !saved.has(item.key);
    // State alone is not enough here: two clicks can enter before React commits
    // the disabled button. The ref claims the item synchronously.
    if (needsHistorySave) {
      if (savingKeysRef.current.has(item.key)) return;
      savingKeysRef.current.add(item.key);
      setSavingKeys(new Set(savingKeysRef.current));
    }
    try {
      await navigator.clipboard.writeText(item.prompt);
      setCopied((set) => new Set(set).add(item.key));
      toast.success("Prompt copied");
      if (needsHistorySave) {
        try {
          const template = templates.find((row) => row.slug === series);
          const row = await saveFn({
            data: {
              eventId,
              templateId: template?.id ?? null,
              templateSlug: series,
              templateName: CARD_SERIES[series].label,
              eventParticipantId: item.eventParticipantId ?? null,
              subjectName: item.subjectName,
              inputSnapshot: {
                ...item.input,
                eventParticipantId: item.eventParticipantId ?? null,
                masterPrompt: undefined,
              },
              generatedPrompt: item.prompt,
              kind: "initial",
            },
          });
          saved.set(item.key, row.id);
          void qc.invalidateQueries({ queryKey: ["card-prompt-runs", eventId] });
        } catch {
          toast.warning("Prompt copied, but history could not be saved");
        }
      }
      if (advance) setIndex((i) => Math.min(i + 1, queue.length - 1));
    } catch {
      toast.error("Could not copy to clipboard");
    } finally {
      if (needsHistorySave) {
        savingKeysRef.current.delete(item.key);
        setSavingKeys(new Set(savingKeysRef.current));
      }
    }
  }
  const current = queue[index];
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="mt-5 rounded-md border border-primary/20 p-3"
    >
      <summary className="min-h-11 cursor-pointer font-display text-xs font-bold uppercase tracking-widest">
        Batch Production
      </summary>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap gap-2">
          {CARD_SERIES_OPTIONS.map((option) => (
            <Button
              key={option.id}
              size="sm"
              type="button"
              variant={series === option.id ? "default" : "secondary"}
              onClick={() => {
                setSeries(option.id);
                setQueue([]);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div>
          <Label htmlFor="batch-shared">Shared batch direction</Label>
          <Textarea
            id="batch-shared"
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            placeholder="Set-wide theme or constraints; every card will still be individualized."
          />
        </div>
        {isPlayerSeries(series) ? (
          <div>
            <div className="mb-2 flex gap-2">
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setSelected(new Set(availablePlayers.map((p) => p.id)))}
              >
                Select All
              </Button>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
            <div className="space-y-2">
              {players.map((ep) => (
                <div key={ep.id} className="rounded border border-white/10 p-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      disabled={!ep.participant}
                      checked={selected.has(ep.id)}
                      onCheckedChange={(checked) =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (checked) next.add(ep.id);
                          else next.delete(ep.id);
                          return next;
                        })
                      }
                    />
                    <span>{ep.participant?.name ?? "Unavailable participant"}</span>
                  </label>
                  {selected.has(ep.id) && (
                    <Input
                      aria-label={`Notes for ${ep.participant?.name}`}
                      value={notes[ep.id] ?? ""}
                      onChange={(e) => setNotes((old) => ({ ...old, [ep.id]: e.target.value }))}
                      placeholder="Optional subject-specific note"
                      className="min-h-11"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {subjects.map((subject, i) => (
              <div
                key={subject.key}
                className="grid gap-2 rounded border border-white/10 p-2 sm:grid-cols-2"
              >
                <Input
                  aria-label={`Subject ${i + 1} name`}
                  value={subject.name}
                  onChange={(e) =>
                    setSubjects((rows) =>
                      rows.map((row) =>
                        row.key === subject.key ? { ...row, name: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Name"
                  className="min-h-11"
                />
                <Input
                  value={subject.association}
                  onChange={(e) =>
                    setSubjects((rows) =>
                      rows.map((row) =>
                        row.key === subject.key ? { ...row, association: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Owner / association"
                  className="min-h-11"
                />
                <Input
                  value={subject.notes}
                  onChange={(e) =>
                    setSubjects((rows) =>
                      rows.map((row) =>
                        row.key === subject.key ? { ...row, notes: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Quick personality notes"
                  className="min-h-11"
                />
                <Input
                  value={subject.colors}
                  onChange={(e) =>
                    setSubjects((rows) =>
                      rows.map((row) =>
                        row.key === subject.key ? { ...row, colors: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Colors"
                  className="min-h-11"
                />
                <Input
                  value={subject.visuals}
                  onChange={(e) =>
                    setSubjects((rows) =>
                      rows.map((row) =>
                        row.key === subject.key ? { ...row, visuals: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Visual must-haves"
                  className="min-h-11"
                />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() =>
                    setSubjects((rows) => rows.filter((row) => row.key !== subject.key))
                  }
                >
                  Remove Subject
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() =>
                setSubjects((rows) => [
                  ...rows,
                  {
                    key: `subject-${Date.now()}-${rows.length}`,
                    name: "",
                    association: "",
                    notes: "",
                    colors: "",
                    visuals: "",
                  },
                ])
              }
            >
              Add Subject
            </Button>
          </div>
        )}
        <Button type="button" className="min-h-11 w-full" disabled={!batchReady} onClick={build}>
          {!templatesReady
            ? "Loading series prompts…"
            : isPlayerSeries(series) || standaloneRowsValid
              ? "Build Batch"
              : "Add names and associations"}
        </Button>
        {current && (
          <div className="space-y-2 rounded border border-primary/30 p-3">
            <p className="font-semibold">
              {index + 1} of {queue.length} — {current.subjectName}{" "}
              {copied.has(current.key) ? "✓ copied" : ""}
            </p>
            <Textarea readOnly className="min-h-64 font-mono text-xs" value={current.prompt} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => setIndex((i) => i - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                disabled={savingKeys.has(current.key)}
                onClick={() => copyCurrent(false)}
              >
                {savingKeys.has(current.key) ? "Saving…" : "Copy Prompt"}
              </Button>
              <Button
                type="button"
                disabled={savingKeys.has(current.key)}
                onClick={() => copyCurrent(true)}
              >
                Copy & Next
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={index >= queue.length - 1}
                onClick={() => setIndex((i) => i + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
