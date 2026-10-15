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
      { property: "og:title", content: "Will YOU Be My Hero? — Draft Combine Card Game" },
      { property: "og:type", content: "website" },
      // This route's meta wins over the root's, so it has to carry the root's
      // `summary` itself — see the note there on why no route may ask for a large
      // card until an og:image exists.
      { name: "twitter:card", content: "summary" },
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
