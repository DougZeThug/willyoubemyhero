import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  IdCard,
  QrCode,
  RotateCw,
  Share2,
  Smartphone,
} from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { requestGyroPermission } from "@/lib/gyro";
import { ShareCard, type ShareCardData } from "@/components/share-card-graphic";
import { CardBackPanel } from "@/components/card-back-panel";
import { CardSocial } from "@/components/card-social";
import { useEventSocial, useEventAwards } from "@/hooks/use-event-social";
import { awardCategory } from "@/lib/awards";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { exportCardPng } from "@/lib/share-card";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players/$id")({
  head: () => ({
    meta: [
      { title: "Player Card — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Full player trading card for the draft combine." },
      { property: "og:title", content: "Draft Combine — Player Card" },
      { property: "og:description", content: "Tilt it, flip it, send it to the group chat." },
    ],
  }),
  component: PlayerCardPage,
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Player not found.{" "}
      <Link to="/players" className="text-primary underline">
        Back to the vault
      </Link>
    </div>
  ),
});

function PlayerCardPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { event, bundle, loading } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  const social = useEventSocial(event?.id ?? null);
  const awards = useEventAwards(event?.id ?? null);

  const [flipped, setFlipped] = useState(false);
  const [gyro, setGyro] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  // Roster in running order gives prev/next a stable, meaningful sequence.
  const roster = useMemo(
    () => [...(bundle?.participants ?? [])].sort((a, b) => a.running_order - b.running_order),
    [bundle],
  );
  const index = roster.findIndex((p) => p.id === id);
  const prev = index > 0 ? roster[index - 1] : roster[roster.length - 1];
  const next = index >= 0 && index < roster.length - 1 ? roster[index + 1] : roster[0];

  const go = useCallback(
    (targetId: string | undefined) => {
      if (!targetId || targetId === id) return;
      setFlipped(false);
      navigate({ to: "/players/$id", params: { id: targetId } });
    },
    [id, navigate],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") go(prev?.id);
      if (e.key === "ArrowRight") go(next?.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prev?.id, next?.id]);

  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  // QR points at this card so a printed card can link to its digital twin.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const target = `${window.location.origin}/players/${id}`;
    import("qrcode").then(({ default: QR }) =>
      QR.toDataURL(target, {
        margin: 1,
        width: 220,
        color: { dark: "#38bdf8", light: "#0b1220" },
      }).then((d) => {
        if (!cancelled) setQrUrl(d);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const ep = bundle?.participants.find((p) => p.id === id);
  if (!ep) throw notFound();

  const urls = cards.data?.[ep.id];
  const rarity = rarities.get(ep.id) ?? rarityStyle("base");
  const name = ep.participant?.name ?? "—";
  const photoUrl = photos.data?.[ep.id] ?? ep.participant?.profile_image_url ?? null;

  const officialRuns = (bundle?.runs ?? [])
    .filter((r) => r.is_official && r.participant_id === ep.participant_id)
    .sort((a, b) => (a.official_time_ms ?? 0) - (b.official_time_ms ?? 0));
  const bestRun = officialRuns[0];

  // Rank among everyone with an official time.
  const allBest = new Map<string, number>();
  for (const r of bundle?.runs ?? []) {
    if (!r.is_official || r.official_time_ms == null) continue;
    const cur = allBest.get(r.participant_id);
    if (cur == null || r.official_time_ms < cur) allBest.set(r.participant_id, r.official_time_ms);
  }
  const bestMs = bestRun?.official_time_ms ?? null;
  const rank = bestMs != null ? [...allBest.values()].filter((ms) => ms < bestMs).length + 1 : null;

  // Reactions and comments store participant_id; the roster is the only place
  // that maps those back to names.
  const nameOf = (participantId: string) =>
    bundle?.participants.find((p) => p.participant_id === participantId)?.participant?.name ??
    "Someone";

  const cardReactions = (social.data?.reactions ?? []).filter(
    (r) => r.event_participant_id === ep.id,
  );
  const cardComments = (social.data?.comments ?? []).filter(
    (c) => c.event_participant_id === ep.id,
  );
  const myAwards = ep.participant_id ? (awards.byParticipant.get(ep.participant_id) ?? []) : [];

  const shareData: ShareCardData = {
    eventName: event?.name ?? "Draft Combine",
    eventYear: event?.year ?? null,
    name,
    fantasyTeam: ep.participant?.fantasy_team_name ?? null,
    quote: ep.participant?.trash_talk_quote ?? null,
    rarityLabel: rarity.label,
    rarityColor: rarity.border,
    cardUrl: urls?.front ?? null,
    photoUrl,
    runningOrder: ep.running_order,
    draftPick: ep.selected_draft_position ?? null,
    timeMs: bestRun?.official_time_ms ?? null,
    rank,
  };

  async function onShare() {
    setSharing(true);
    try {
      // Signed storage URLs expire after an hour; a stale one rasterises blank.
      await qc.refetchQueries({ queryKey: ["card-urls", event?.id] });
      // Let the refreshed <img> paint before html-to-image walks the DOM.
      await new Promise((r) => setTimeout(r, 350));
      const node = shareRef.current;
      if (!node) throw new Error("Share card not ready");
      await exportCardPng(node, `${name.replace(/\s+/g, "-").toLowerCase()}-card.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export card");
    } finally {
      setSharing(false);
    }
  }

  async function onToggleGyro() {
    if (gyro) {
      setGyro(false);
      return;
    }
    const granted = await requestGyroPermission();
    if (!granted) {
      toast.error("Motion access denied");
      return;
    }
    setGyro(true);
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link
            to="/players"
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.3em] text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Vault
          </Link>
          <div className="flex items-center gap-2 text-primary">
            <IdCard className="h-4 w-4" />
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">
              {rarity.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NavButton
            onClick={() => go(prev?.id)}
            label={`Previous: ${prev?.participant?.name ?? ""}`}
            icon={<ChevronLeft className="h-5 w-5" />}
            disabled={roster.length < 2}
          />
          <div className="mx-auto w-full max-w-sm">
            <HoloCard
              frontUrl={urls?.front ?? null}
              backUrl={urls?.back ?? null}
              name={name}
              rarity={rarity}
              cacheKey={ep.id}
              flipped={flipped}
              onFlippedChange={setFlipped}
              gyro={gyro}
              backContent={<CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />}
            />
          </div>
          <NavButton
            onClick={() => go(next?.id)}
            label={`Next: ${next?.participant?.name ?? ""}`}
            icon={<ChevronRight className="h-5 w-5" />}
            disabled={roster.length < 2}
          />
        </div>

        <div className="mt-4 text-center">
          <h1 className="font-display text-3xl font-black uppercase leading-none">{name}</h1>
          {ep.participant?.fantasy_team_name && (
            <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {ep.participant.fantasy_team_name}
            </div>
          )}
          {myAwards.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {myAwards.map((a) => {
                const cat = a.award_type ? awardCategory(a.award_type) : undefined;
                return (
                  <Link
                    key={`${a.award_type}-${a.award_name}`}
                    to="/awards"
                    className="inline-flex items-center gap-1 rounded-full border border-warn/50 bg-warn/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-warn hover:bg-warn/20"
                  >
                    <span aria-hidden>{cat?.icon ?? "🏅"}</span>
                    {a.award_name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ActionButton
            onClick={() => setFlipped((f) => !f)}
            active={flipped}
            icon={<RotateCw className="h-3.5 w-3.5" />}
          >
            {flipped ? "Front" : urls?.back ? "Flip" : "Stats"}
          </ActionButton>
          <ActionButton
            onClick={onShare}
            disabled={sharing}
            icon={<Share2 className="h-3.5 w-3.5" />}
          >
            {sharing ? "Rendering…" : "Share"}
          </ActionButton>
          <ActionButton
            onClick={onToggleGyro}
            active={gyro}
            icon={<Smartphone className="h-3.5 w-3.5" />}
          >
            Tilt
          </ActionButton>
        </div>

        {ep.participant?.trash_talk_quote && (
          <blockquote
            className="mx-auto mt-6 max-w-md border-l-2 pl-4 text-sm italic text-muted-foreground"
            style={{ borderColor: rarity.border }}
          >
            “{ep.participant.trash_talk_quote}”
          </blockquote>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Order" value={`#${ep.running_order}`} />
          <Stat
            label="Pick"
            value={ep.selected_draft_position != null ? `#${ep.selected_draft_position}` : "—"}
          />
          <Stat label="Time" value={bestRun ? formatTime(bestRun.official_time_ms) : "—"} mono />
          <Stat label="Rank" value={rank != null ? `#${rank}` : "—"} />
        </div>

        {event?.id && (
          <CardSocial
            eventId={event.id}
            eventParticipantId={ep.id}
            reactions={cardReactions}
            comments={cardComments}
            nameOf={nameOf}
          />
        )}

        {qrUrl && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" /> Scan on the printed card
            </div>
            <img
              src={qrUrl}
              alt={`QR code linking to ${name}'s card`}
              className="rounded-lg border border-primary/30"
              width={140}
              height={140}
            />
          </div>
        )}
      </div>

      {/* Offscreen 1080x1350 composite that html-to-image rasterises. */}
      <div style={{ position: "fixed", top: -10000, left: -10000, pointerEvents: "none" }}>
        <ShareCard ref={shareRef} data={shareData} />
      </div>
    </div>
  );
}

function NavButton({
  onClick,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="hud-bezel hidden shrink-0 rounded-full border border-white/10 p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30 sm:block"
    >
      {icon}
    </button>
  );
}

function ActionButton({
  onClick,
  children,
  icon,
  active,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] transition-colors disabled:opacity-50",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-white/10 text-muted-foreground hover:border-primary/50 hover:text-primary",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="hud-bezel rounded-md border border-white/10 px-4 py-2 text-center">
      <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "font-display text-xl font-black text-primary " + (mono ? "timer-digits tabular" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
