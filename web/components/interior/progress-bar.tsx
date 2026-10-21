"use client"

import type { ComponentProps } from "react"
import { Progress as Primitive } from "radix-ui"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export function Progress({
  className,
  value,
  max = 100,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  const reduced = useReducedMotion()
  const fraction = value == null ? 0 : Math.max(0, Math.min(1, value / max))
  return (
    <Primitive.Root
      {...props}
      value={value}
      max={max}
      data-slot="progress"
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
    >
      <motion.div
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary"
        initial={false}
        animate={{ x: `${fraction * 100 - 100}%` }}
        transition={
          reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 34, mass: 0.9 }
        }
      />
    </Primitive.Root>
  )
}
