import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold uppercase tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-colt-teal disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-colt-teal text-black font-bold hover:bg-colt-teal-dark shadow-sm hover:shadow-[0_0_20px_rgba(0,215,189,0.35)]",
        destructive: "bg-red-500 text-white hover:bg-red-500/90 shadow-sm",
        outline: "border-2 border-border-strong bg-transparent hover:border-colt-teal hover:text-colt-teal",
        secondary: "bg-bg-elevated text-text-primary hover:bg-bg-hover normal-case font-medium tracking-normal rounded-md",
        ghost: "hover:bg-bg-hover hover:text-text-primary normal-case font-medium tracking-normal rounded-md",
        link: "text-colt-teal underline-offset-4 hover:underline normal-case font-medium tracking-normal",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-8 px-4 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
