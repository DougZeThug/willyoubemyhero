import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { SiteNav } from "@/components/site-nav";
import { PresentationProvider } from "@/components/presentation-mode";
import { OfflineBanner } from "@/components/offline-banner";
import { AccountBridge } from "@/components/account-bridge";
import { TrophyCeremonyHost } from "@/components/trophy-ceremony-host";
import { useIsPresenting } from "@/hooks/use-presentation";
import { useIsOnline } from "@/hooks/use-online";
import { hydrateCardSfxMuted } from "@/lib/card-sfx";

function NotFoundComponent() {
  return (
    <div className="card-bg flex min-h-screen items-center justify-center px-4">
      <div className="surface-panel w-full max-w-md rounded-xl border p-6 text-center">
        <h1 className="font-display text-7xl font-black leading-none text-primary/70">404</h1>
        <h2 className="mt-4 font-display text-section font-black uppercase tracking-wide">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link to="/" className="neon-btn-sm">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="card-bg flex min-h-screen items-center justify-center px-4">
      <div className="surface-panel w-full max-w-md rounded-xl border p-6 text-center">
        <h1 className="font-display text-section font-black uppercase tracking-wide">
          This page didn&apos;t load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="neon-btn-sm"
          >
            Try again
          </button>
          {/* A raw anchor, not a Link: this is the way out of a router tree that
              has already thrown, and a client-side navigation would stay in it. */}
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-white/15 px-4 text-button font-bold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // "Hero" stays in the title wherever it appears: it is what the app is
      // called, and the smoke suite pins it on the root.
      { title: "Will YOU Be My Hero? — The Vault" },
      {
        name: "description",
        content:
          "A pack a day, secret pulls, trades, dust and trophies — and the combine board when game day comes back around.",
      },
      { name: "author", content: "Will YOU Be My Hero?" },
      { name: "theme-color", content: "#0a1420" },
      { property: "og:title", content: "Will YOU Be My Hero? — The Vault" },
      {
        property: "og:description",
        content:
          "A pack a day, secret pulls, trades, dust and trophies — and the combine board when game day comes back around.",
      },
      { property: "og:type", content: "website" },
      // `summary`, not `summary_large_image`: a large card with no og:image
      // renders as a big empty rectangle, and every link to this app went into
      // a group chat looking like that. Switch it back the day a route sets an
      // og:image worth the space.
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap",
      },
      {
        rel: "manifest",
        href: "https://progressier.app/exUpvbkPunrEKfGQew3K/progressier.json",
      },
    ],
    scripts: [
      {
        src: "https://progressier.app/exUpvbkPunrEKfGQew3K/script.js",
        defer: true,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Focus follows the route. Without this a screen reader stayed wherever
  // the previous page left it while the whole document changed underneath,
  // which is also why the skip link below could only ever be used once.
  const mainRef = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const firstRoute = useRef(true);
  useEffect(() => {
    // Not on the first render: stealing focus on load is its own problem.
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  // The saved mute preference has to be in module state before the first card
  // is tapped, and card-sfx is imported by components far below this one.
  useEffect(() => {
    hydrateCardSfxMuted();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AccountBridge />
      <PresentationProvider>
        {/* Inside the provider, not beside the Toaster: it uses PresentationMode
            to fade the nav, and that context's default is a no-op. A set can close
            while you are anywhere in the app — an admin grant runs on the
            commissioner's phone, and the far side of a trade never sees the accept
            response — so the ceremony for those has to live above the routes
            rather than in one of them. */}
        <TrophyCeremonyHost />
        <div className="flex min-h-screen flex-col">
          {/* The first thing in the tab order, and invisible until it has
              focus. Without it every screen began with the whole nav. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <SiteNav />
          {/* The bottom nav's reserved space stays reserved while presenting.
              Releasing it is a reflow of the whole page on the exact frame the
              ceremony wants to be the only thing moving — the same trade the
              pack route already makes for its own header row. The nav above it
              is gone from sight and from the tab order either way, which is the
              part that matters. */}
          {/* Focused on every route change, so a screen reader lands on the
              new page rather than staying wherever the old one left it.
              tabIndex -1 makes it focusable without adding a tab stop. */}
          <main
            id="main"
            ref={mainRef}
            tabIndex={-1}
            className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] focus:outline-none md:pb-0"
          >
            <Outlet />
          </main>
        </div>
        <ShellFeedback />
      </PresentationProvider>
    </QueryClientProvider>
  );
}

/**
 * The two things that float over every screen: what just happened, and why the
 * buttons have gone quiet.
 *
 * One component because they share a slot. The banner stands in the strip above
 * the tab bar and the toaster stacks on top of it, so the offset the toaster
 * gets depends on whether the banner is there — which is a thing to decide once,
 * here, rather than a number copied into two files.
 *
 * Inside `PresentationProvider` rather than beside it, which is the whole reason
 * this is a component at all: `useIsPresenting` is a context read, and a screen
 * playing something cinematic gets the device to itself. The nav is already
 * faded and inert under a ceremony (see SiteNav); a toast landing over the card
 * you just pulled would be the one piece of chrome that ignored that.
 */
function ShellFeedback() {
  const presenting = useIsPresenting();
  const online = useIsOnline();
  if (presenting) return null;

  // Both offsets, and the same value in each: sonner switches to `mobileOffset`
  // below 600px while the tab bar it is clearing survives to 768px, so the
  // breakpoint that matters is inside the custom property rather than in sonner.
  const offset = { bottom: online ? "var(--above-tab-bar)" : "var(--above-offline-banner)" };
  return (
    <>
      {!online && <OfflineBanner />}
      {/* bottom-center, not top: a phone is held by its bottom half, and a toast
          that reports a trade belongs next to the thumb that just made it. */}
      <Toaster
        position="bottom-center"
        richColors
        closeButton
        theme="dark"
        offset={offset}
        mobileOffset={offset}
      />
    </>
  );
}
