import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { verifyEventPin } from "@/lib/admin.functions";
import { setAdminToken } from "@/lib/admin-token";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKeyhole } from "lucide-react";

export function PinGate({
  eventId,
  eventName,
  userId,
}: {
  eventId: string;
  eventName: string;
  /** Whoever is signed in as the PIN is typed: the account this console is bound to. */
  userId: string | null;
}) {
  const verifyFn = useServerFn(verifyEventPin);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function attempt(value: string) {
    setBusy(true);
    try {
      const res = await verifyFn({ data: { eventId, pin: value } });
      if (!res.ok) {
        // A locked-out gate must not read as "wrong PIN" — the next CORRECT
        // entry fails too, and "incorrect" would send the commissioner hunting
        // for a PIN they already have.
        toast.error(
          res.reason === "too_many_attempts"
            ? "Too many tries — the gate is resting. Give it a few minutes."
            : "Incorrect PIN",
        );
        setPin("");
        return;
      }
      setAdminToken(res.token, userId);
      toast.success("Admin unlocked");
    } catch {
      toast.error("Could not verify PIN");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    await attempt(pin);
  }

  return (
    <div className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 py-10">
      <Card className="hud-bezel w-full border-white/10">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 text-primary">
              <LockKeyhole className="h-4 w-4" />
              <span className="font-display text-label font-bold uppercase tracking-[0.08em]">
                Console
              </span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none">
              Admin Access
            </h1>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Enter the event PIN for <span className="text-foreground">{eventName}</span> to unlock
            timing and controls on this device.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <Label htmlFor="pin">Event PIN</Label>
            <Input
              id="pin"
              // `text` and not `password`, which is what this said and what cost
              // the keypad. iOS ignores `inputMode` on a password field and
              // opens QWERTY — so a commissioner at a start line, holding a
              // phone in one hand, hunts for four digits on a letter keyboard.
              //
              // The masking comes back as `-webkit-text-security`, which Safari
              // and Chrome both honour and which leaves `inputMode` alone. The
              // trade is explicit: Firefox does not implement it, so the PIN is
              // visible while typing there. That is the right way round for this
              // field — it is a four-digit event PIN shared across a league,
              // guarding a console whose real protection is the HMAC'd token
              // the server issues, and the phone is where it is actually typed.
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={4}
              value={pin}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPin(next);
                if (next.length === 4 && !busy) void attempt(next);
              }}
              // The one place wide tracking survives the §16 cap: a code is read
              // and typed character by character, and the gaps are what let a
              // thumb find its place in it.
              // Stated twice for the reason the member code box gives: the
              // primitive's `pointer-fine:` release would otherwise take this to
              // 14px on the laptop the console is usually run from.
              className="text-center font-display text-2xl tracking-[0.4em] [-webkit-text-security:disc] pointer-fine:text-2xl"
            />
            <Button type="submit" disabled={busy || !pin} className="w-full">
              {busy ? "Checking…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
