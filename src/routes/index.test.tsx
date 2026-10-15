// What a link-preview crawler reads off "/". The route only redirects, but it is
// the URL people paste, so its head is what the group chat's card is built from —
// and a leaf route's meta wins over the root's for the same name.
import { describe, expect, it } from "vitest";
import { Route as IndexRoute } from "./index";
import { Route as RootRoute } from "./__root";
import { Route as LiveRoute } from "./live";
import { Route as AuthRoute } from "./auth";

type Meta = { name?: string; property?: string; content?: string };

const metaOf = (route: { options: { head?: unknown } }): Meta[] => {
  const head = route.options.head as (() => { meta?: Meta[] }) | undefined;
  return head?.().meta ?? [];
};

const content = (meta: Meta[], key: string) =>
  meta.find((m) => m.name === key || m.property === key)?.content;

describe('the head of "/"', () => {
  it("asks for the small card, as the root does, because no og:image exists", () => {
    expect(content(metaOf(IndexRoute), "twitter:card")).toBe("summary");
  });

  it("only ever asks for a large card where an og:image goes with it", () => {
    // A large card with no image renders as a big empty rectangle in the chat.
    for (const route of [IndexRoute, RootRoute, LiveRoute, AuthRoute]) {
      const meta = metaOf(route);
      if (content(meta, "twitter:card") === "summary_large_image") {
        expect(content(meta, "og:image")).toBeTruthy();
      }
    }
  });
});
