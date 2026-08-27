import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { SiteNav } from "@/components/site-nav";
import { PresentationProvider } from "@/components/presentation-mode";
import { AccountBridge } from "@/components/account-bridge";
import { TrophyCeremonyHost } from "@/components/trophy-ceremony-host";
import { hydrateCardSfxMuted } from "@/lib/card-sfx";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
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
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
          <SiteNav />
          {/* The bottom nav's reserved space stays reserved while presenting.
              Releasing it is a reflow of the whole page on the exact frame the
              ceremony wants to be the only thing moving — the same trade the
              pack route already makes for its own header row. The nav above it
              is gone from sight and from the tab order either way, which is the
              part that matters. */}
          <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
            <Outlet />
          </main>
        </div>
      </PresentationProvider>
      <Toaster position="top-center" richColors closeButton theme="dark" />
    </QueryClientProvider>
  );
}
