import type { CSSProperties } from "react";
import { Toaster } from "@/components/ui/sonner";

// Sonner's dark theme paints a plain toast pure black with white text, and its
// own rules out-rank the Tailwind classes in ui/sonner.tsx, so those never land.
// The supported hook is the --normal-* custom properties; inline on the toaster
// they beat the theme's stylesheet declaration without !important. Only the
// "normal" family is set, so richColors still gives success/error their own hues.
export const TOAST_THEME = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border-strong)",
  "--normal-bg-hover": "oklch(0.23 0.02 240)",
  "--normal-border-hover": "var(--border-strong)",
} as CSSProperties;

// Sonner draws an action button as the inverse of the toast (text colour as its
// fill), which would be a pale slab here. There is no variable for it, only this
// inline style, so Undo is filled with the primary action colour instead.
export const TOAST_OPTIONS = {
  actionButtonStyle: {
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    fontWeight: 700,
  },
} satisfies NonNullable<React.ComponentProps<typeof Toaster>["toastOptions"]>;

export function AppToaster({ offset }: { offset: { bottom: string } }) {
  return (
    <Toaster
      position="bottom-center"
      richColors
      closeButton
      theme="dark"
      offset={offset}
      mobileOffset={offset}
      style={TOAST_THEME}
      toastOptions={TOAST_OPTIONS}
    />
  );
}
