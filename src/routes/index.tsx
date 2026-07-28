import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content:
          "Timed athletic-and-drinking combine that sets the fantasy football draft-pick order.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine" },
      {
        property: "og:description",
        content: "Timed athletic-and-drinking combine that sets the fantasy football draft-pick order.",
      },
    ],
  }),
  component: () => <Navigate to="/players" />,
});

