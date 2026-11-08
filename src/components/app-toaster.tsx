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
    // The repo's 44px floor: Undo is the one control here that matters, pressed
    // one-handed. Sonner's own button is 24px tall.
    minHeight: "2.75rem",
    padding: "0 1rem",
    borderRadius: "9999px",
  },
  classNames: {
    // Sonner's close disc is 20px and absolutely placed. An ::after reaching 13px
    // past each edge makes the hit area 44px (the disc has a 1px border, so 13 not 12) without moving or resizing the disc;
    // sonner styles no ::after, so nothing needs out-ranking.
    closeButton: "after:absolute after:-inset-[13px] after:content-['']",
  },
} satisfies NonNullable<React.ComponentProps<typeof Toaster>["toastOptions"]>;

// The shadcn wrapper's own classNames; toastOptions passed to it replace its
// default object wholesale rather than merging, so they are re-spread here.
export const SHADCN_TOAST_CLASSNAMES = {
  toast:
    "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
  description: "group-[.toast]:text-muted-foreground",
  actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
  cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
};

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
      toastOptions={{
        ...TOAST_OPTIONS,
        classNames: { ...SHADCN_TOAST_CLASSNAMES, ...TOAST_OPTIONS.classNames },
      }}
    />
  );
}
