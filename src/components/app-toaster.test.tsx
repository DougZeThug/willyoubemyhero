import { describe, expect, it } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { AppToaster } from "./app-toaster";

// jsdom does not load sonner's stylesheet, so this cannot show a colour. It pins
// the wiring that produces one: the --normal-* variables reach the toaster
// element (where they override the dark theme's black) and the action button
// carries the primary fill and a 44px floor inline, and the close disc has the
// class that extends its hit area. It cannot measure either: the real 44px Undo
// and 44px close hit box were measured in Chromium through the capture spec.
// The primary fill is global, success toasts included (see the commit message). Whether it looks right is the screenshot's job.
// Sonner mounts its list only once a toast exists, hence the toast in each test.
async function showPinToast() {
  render(<AppToaster offset={{ bottom: "0px" }} />);
  act(() => {
    toast("Pinned to Favourites", { action: { label: "Undo", onClick: () => {} } });
  });
  await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull());
}

describe("AppToaster", () => {
  it("points sonner's normal palette at the app tokens, and only the normal one", async () => {
    await showPinToast();
    const el = document.querySelector<HTMLElement>("[data-sonner-toaster]")!;
    expect(el.style.getPropertyValue("--normal-bg")).toBe("var(--popover)");
    expect(el.style.getPropertyValue("--normal-text")).toBe("var(--popover-foreground)");
    expect(el.style.getPropertyValue("--normal-border")).toBe("var(--border-strong)");
    expect(el.style.getPropertyValue("--success-bg")).toBe("");
    expect(el.style.getPropertyValue("--error-bg")).toBe("");
  });

  it("fills the action button with the primary token", async () => {
    await showPinToast();
    const undo = await waitFor(() => {
      const b = document.querySelector<HTMLElement>("[data-button]");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(undo.style.background).toContain("var(--primary)");
    expect(undo.style.color).toContain("var(--primary-foreground)");
    // The repo's 44px touch floor; sonner's own button is 24px.
    expect(undo.style.minHeight).toBe("2.75rem");
  });

  it("widens the close disc's hit area through a class, not by resizing it", async () => {
    await showPinToast();
    const close = await waitFor(() => {
      const b = document.querySelector<HTMLElement>("[data-close-button]");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(close.className).toContain("after:-inset-[13px]");
  });
});
