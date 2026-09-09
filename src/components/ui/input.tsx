import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // The same floor the buttons got, for the same reason (§23 F1).
        //
        // `h-9` is 36px, so the member code on /claim — the app's front door —
        // and both /auth fields sat 8px under the §18 floor while every button
        // beside them cleared it. The call sites had already started paying for
        // that by hand: card-prompt-studio.tsx and card-prompt-tools.tsx pass
        // `min-h-11` at all twelve of theirs. The floor belongs to the
        // primitive.
        //
        // `pointer-fine:` and NOT `md:`, which is what this line used to say —
        // and here the variant carries the font size as well as the height.
        // Under 16px iOS Safari zooms the page on focus, and a width breakpoint
        // hands 14px back at 768px, which a landscape phone crosses with the
        // thumb still the input. The zoom would return exactly where a keyboard
        // is hardest to get back out of. It is a media query and not a
        // `useMediaQuery`, so the server render and the first client render are
        // the same bytes and nothing flashes at 36px on the way in.
        //
        // A floor for a TEXT field. A file input centres its
        // `::file-selector-button` differently, so it would sit top-aligned in
        // the extra height — there are none behind this primitive today.
        className={cn(
          "flex h-9 min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 pointer-fine:min-h-0 pointer-fine:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
