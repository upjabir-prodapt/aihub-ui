"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full bg-colt-teal/20 text-colt-teal font-semibold text-xs items-center justify-center shadow-inner",
      className
    )}
    {...props}
  />
))
Avatar.displayName = "Avatar"

export { Avatar }
