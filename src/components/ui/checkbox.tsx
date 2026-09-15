import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    // Same treatment as ui/switch.tsx, for the same reason: a 16px box is what a
    // checkbox looks like, so the target grows and the drawing does not. A 44px
    // `::before` centred on the box, released on `pointer-fine:`.
    //
    // Worth knowing before trusting a sweep about either: `getBoundingClientRect`
    // does not include a pseudo-element, so an automated tap-target measurement
    // reports this control at 16px however big the thumb's actual target is.
    // e2e/smoke.spec.ts tests the hit area with elementFromPoint instead, which
    // is the thing the rule is actually about.
    className={cn(
      "grid place-content-center peer relative h-4 w-4 shrink-0 rounded-sm border border-primary shadow cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] pointer-fine:before:hidden",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
