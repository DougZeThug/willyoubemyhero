import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderCircle, LogIn, LogOut, ShieldCheck, UserRoundPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { signOutAccount, useAuthUser } from "@/hooks/use-account";
import { useMemberSession } from "@/lib/member-token";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { preserveAccountHandoff } from "@/lib/account-handoff";
import { useAccountSyncState } from "@/lib/account-sync-state";

export const Route = createFileRoute("/auth")({
  // Both optional: /auth stays a plain sign-in page when linked without them.
  // Optional-key annotation: inferred `| undefined` values would otherwise be
  // required search params at every Link/navigate to /auth.
  validateSearch: (search: Record<string, unknown>): { mode?: "signup"; next?: string } => ({
    mode: search["mode"] === "signup" ? ("signup" as const) : undefined,
    // Same-origin paths only — a protocol-relative "//evil.com" is not a path.
    next:
      typeof search["next"] === "string" &&
      search["next"].startsWith("/") &&
      !search["next"].startsWith("//")
        ? search["next"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign In — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content:
          "Create an account to keep your card collection, secret pulls and trades on every device.",
      },
      { property: "og:title", content: "Sign In — Will YOU Be My Hero? Draft Combine" },
      {
        property: "og:description",
        content: "Keep your combine card collection on every phone you play from.",
      },
      { property: "og:type", content: "website" },
      // `summary`, not `summary_large_image`: a large card with no og:image
      // renders as a big empty rectangle, and every link to this app went into
      // a group chat looking like that. Switch it back the day a route sets an
      // og:image worth the space.
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const { mode: modeParam, next } = Route.useSearch();
  const { user, loading } = useAuthUser();
  const member = useMemberSession();
  const sync = useAccountSyncState();
  const [mode, setMode] = useState<Mode>(modeParam ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  /**
   * Whether this visit is a sign-in round trip rather than somebody opening
   * their account screen.
   *
   * Redirecting on `user && sync.ready` alone is the steady state for anybody
   * signed in, so the Account item in the header menu landed on the vault and
   * this whole screen — the email address, the sign-out, and the only in-app
   * route to /claim for a signed-in player — was reachable only while the link
   * was still settling or had failed.
   *
   * A `next` is an explicit "send me on afterwards" from whoever linked here.
   * Otherwise the redirect is armed only when the page was signed OUT when it
   * mounted, so the sign-in that follows still lands where it should.
   */
  const [wasSignedOut, setWasSignedOut] = useState(false);
  useEffect(() => {
    if (!loading && !user) setWasSignedOut(true);
  }, [loading, user]);

  useEffect(() => {
    if (!user || sync.status !== "ready" || sync.userId !== user.id) return;
    if (!next && !wasSignedOut) return;
    void navigate({ to: next ?? "/players" });
  }, [user, sync, navigate, next, wasSignedOut]);

  async function signInWithGoogle() {
    setBusy(true);
    preserveAccountHandoff();
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth`,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in didn't work", { description: result.error.message });
      return;
    }
    if (result.redirected) return;
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        preserveAccountHandoff();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) throw error;
        // With email confirmation on, signUp returns no session — the account is
        // not signed in until the link is clicked.
        if (!data.session) {
          setSentTo(email);
          toast.success("Check your email to confirm your account");
          return;
        }
        toast.success("You're in");
      } else {
        preserveAccountHandoff();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      }
    } catch (err) {
      toast.error(mode === "signup" ? "Couldn't create that account" : "Couldn't sign you in", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <Card className="border-primary/20 bg-card/70">
          <CardContent className="space-y-4 p-6 text-center">
            {sync.status === "ready" ? (
              <ShieldCheck className="mx-auto h-8 w-8 text-primary" />
            ) : (
              <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-primary" />
            )}
            <div>
              <h1 className="font-display text-xl font-black uppercase tracking-[0.18em]">
                {sync.status === "error" ? "Link needs another try" : "Securing your cards"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {sync.status === "error"
                  ? sync.message
                  : sync.status !== "ready"
                    ? "Keep this page open while this phone's collection is linked."
                    : member?.name
                      ? `Your cards are saved to ${member.name}.`
                      : "Your cards are saved to this account — they'll follow you to any phone."}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {sync.status === "error" ? (
                <Button onClick={() => window.location.reload()}>Try linking again</Button>
              ) : (
                <Button asChild disabled={sync.status !== "ready"}>
                  <Link to="/players">Go to the vault</Link>
                </Button>
              )}
              {!member && (
                <Button variant="outline" asChild>
                  <Link to="/claim">I have a player code</Link>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={async () => {
                  await signOutAccount();
                  toast.success("Signed out");
                }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <header className="mb-6 text-center">
        <h1 className="font-display text-2xl font-black uppercase tracking-[0.18em] text-foreground">
          {mode === "signup" ? "Create an account" : "Sign in"}
        </h1>
        {next === "/players/trade" && (
          <p className="mt-2 text-sm font-bold text-primary">
            Trading needs an account — it's how the other player knows who they're swapping with.
          </p>
        )}
        {/* Both, because the rung can now be claimed from home as well as from
            the pack summary (§11) — and somebody who arrived here from a "Sign
            in to claim" needs the reason on the page they landed on, whichever
            of the two sent them. */}
        {(next === "/players/pack" || next === "/players") && (
          <p className="mt-2 text-sm font-bold text-primary">
            Your streak reward is waiting — an account is what keeps the card once you take it.
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          Keep your packs, secret pulls and trades on every phone. Everything this device has
          already collected comes with you.
        </p>
      </header>

      <Card className="border-primary/20 bg-card/70">
        <CardContent className="space-y-5 p-6">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || loading}
            onClick={() => void signInWithGoogle()}
          >
            Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          {sentTo ? (
            <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              Confirmation sent to <span className="text-foreground">{sentTo}</span>. Click the
              link, then come back and sign in.
            </p>
          ) : null}

          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signup" ? (
                <>
                  <UserRoundPlus className="mr-2 h-4 w-4" /> Create account
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" /> Sign in
                </>
              )}
            </Button>
          </form>

          <button
            type="button"
            className={cn(
              "w-full text-center text-xs font-semibold uppercase tracking-[0.2em]",
              "text-muted-foreground transition-colors hover:text-primary",
            )}
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </CardContent>
      </Card>

      {/* The signed-out screen had no route to /claim at all, so somebody
          holding a paper code — who needs no account — was left creating one. */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Got a player code from the commissioner?{" "}
        <Link to="/claim" className="font-bold text-primary underline">
          Claim your player
        </Link>{" "}
        instead — no account needed.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        An account is optional — you can keep playing as a guest on this phone.
      </p>
    </div>
  );
}
