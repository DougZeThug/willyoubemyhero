import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      // Mirrors __root: this route only redirects to the vault, but a link
      // shared to "/" is the one people actually paste, so it is what a preview
      // card is built from.
      { title: "Will YOU Be My Hero? — The Vault" },
      {
        name: "description",
        content:
          "A pack a day, secret pulls, trades, dust and trophies — and the combine board when game day comes back around.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? — The Vault" },
      {
        property: "og:description",
        content:
          "A pack a day, secret pulls, trades, dust and trophies — and the combine board when game day comes back around.",
      },
    ],
  }),
  // `replace`, so the vault overwrites this entry rather than sitting in front
  // of it: a pushed redirect puts "/" one Back press away, where it redirects
  // forward again and the Back button on the shared URL does nothing.
  component: () => <Navigate to="/players" replace />,
});
