import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * The one question between a tap on "Sell for N" and a card leaving the vault.
 *
 * A sale cannot be undone — the copy is deleted and the dust is in the ledger —
 * and the thing being tapped is a line of text under a card somebody is
 * scrolling past with a beer in the other hand. So it asks, names the card and
 * the price, and says how many copies are left.
 *
 * The Sell button is a plain Button rather than AlertDialogAction, because
 * Action closes the dialog on click: a refusal has to be read where it
 * happened, beside the button that caused it, and a pending sale must not be
 * dismissed into a state nobody can see.
 */
export function SellSpareDialog({
  open,
  onOpenChange,
  name,
  value,
  copiesLeft,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  value: number;
  /** Copies still held once this one goes, or null when nobody can say. */
  copiesLeft: number | null;
  /** Resolves to null on success, or the line to show on a refusal. */
  onConfirm: () => Promise<string | null>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    const failure = await onConfirm();
    setPending(false);
    if (failure) setError(failure);
    else onOpenChange(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Not while the sale is in the air: closing then would hide whether it
        // went through.
        if (pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sell {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            +{value} dust.{" "}
            {copiesLeft == null
              ? "It leaves your vault."
              : copiesLeft === 0
                ? "It's your only copy — it leaves your vault."
                : `You'll still have ${copiesLeft}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-meta font-semibold text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <Button onClick={() => void confirm()} disabled={pending}>
            {pending ? "Selling…" : `Sell for ${value}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
