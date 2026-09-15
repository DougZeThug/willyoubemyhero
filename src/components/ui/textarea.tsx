import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        // `pointer-fine:` and not `md:`, the same swap ui/input.tsx made for
        // §23 F2 — read the comment there for the full argument.
        //
        // This one was left behind on purpose at the time: e2e/smoke.spec.ts
        // exempted it because every <Textarea> is the commissioner's, and the
        // console was outside that audit's scope. The third pass took the
        // console inside it, which is the only thing that changed here. A
        // commissioner types a card prompt on the same phone as everyone else,
        // and at 14px iOS Safari zooms the page around the caret on focus.
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
