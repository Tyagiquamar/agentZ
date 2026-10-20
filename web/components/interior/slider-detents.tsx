"use client"

import type { ComponentProps } from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export function SliderDetents({
  value,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<typeof SliderPrimitive.Root>, "value" | "defaultValue" | "onValueChange"> & {
  value: number
  onValueChange: (value: number) => void
}) {
  const reduced = useReducedMotion()
  return (
    <SliderPrimitive.Root
      {...props}
      data-slot="slider"
      value={[value]}
      onValueChange={([next = value]) => onValueChange(next)}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        asChild
        data-slot="slider-thumb"
        aria-labelledby={props["aria-labelledby"]}
        aria-label={props["aria-label"]}
        aria-invalid={props["aria-invalid"]}
        className="relative block size-3 shrink-0 rounded-full border border-ring bg-background ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
      >
        <motion.span
          whileTap={reduced ? undefined : { scale: 1.15 }}
          transition={
            reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: 0.45 }
          }
        />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  )
}
