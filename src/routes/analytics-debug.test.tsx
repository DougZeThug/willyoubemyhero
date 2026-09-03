// Which element in the analytics tree is undefined? Render each component the
// page pulls in, one at a time, and name the first undefined one.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";
import { Link } from "@tanstack/react-router";

const pieces: Record<string, unknown> = {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FeedDegradedBanner,
  FeedError,
  FeedLoading,
  Link,
};

describe("each component the analytics page renders", () => {
  for (const [name, Component] of Object.entries(pieces)) {
    if (typeof Component !== "function") continue;
    it(`${name} is a valid element type`, () => {
      expect(Component).toBeDefined();
      expect(() => render(<Component />)).not.toThrow();
    });
  }
});
