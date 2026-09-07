import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // A FLOOR on a coarse pointer, not a second height.
      //
      // An edit to src/components/ui, which CLAUDE.md says to make rarely — and
      // this is the reason it exists: every stock size (h-8/h-9/h-10) is under
      // the 44px floor of §18, so roughly thirty call sites were each patching
      // around it with their own min-h-11 and about as many were not. The floor
      // belongs to the primitive.
      //
      // `pointer-fine:` and NOT a width breakpoint: 44px is a TOUCH guideline
      // and 24px is the pointer one, and a width does not tell the two apart. A
      // landscape phone and most touch tablets are past 640px with the thumb
      // still the input, and a `sm:` step would have handed the floor back
      // exactly there.
      //
      // `min-h-*` and not `h-*` so a caller's own height still wins: the
      // marshal's start/finish buttons ask for `h-12`, and a responsive `h-*`
      // here would outrank that and shrink them to 36px on the laptop the
      // console is actually run from. A min-height a taller caller clears
      // changes nothing; one a shorter caller does not clear is the whole point.
      size: {
        default: "h-9 min-h-11 px-4 py-2 pointer-fine:min-h-0",
        sm: "h-8 min-h-11 rounded-md px-3 text-xs pointer-fine:min-h-0",
        lg: "h-10 min-h-12 rounded-md px-8 pointer-fine:min-h-0",
        icon: "h-9 w-9 min-h-11 min-w-11 pointer-fine:min-h-0 pointer-fine:min-w-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
