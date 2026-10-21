"use client"

import type { ComponentProps } from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export function SliderDetents({
  value,
  onValueChange,
  min = 0,
  max = 100,
  detents = [min, max],
  id,
  ref,
  className,
  ...props
}: Omit<
  ComponentProps<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "orientation"
> & {
  value: number
  onValueChange: (value: number) => void
  detents?: readonly number[]
}) {
  const reduced = useReducedMotion()
  return (
    <SliderPrimitive.Root
      {...props}
      data-slot="slider"
      min={min}
      max={max}
      value={[value]}
      onValueChange={([next = value]) => onValueChange(next)}
      className={cn(
        "relative flex h-9 w-full touch-none items-center pb-2 select-none data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-2.5 w-full grow overflow-hidden rounded-md bg-muted ring-1 ring-border ring-inset"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-2.25 top-6.5">
        {detents.map((detent) => (
          <span
            key={detent}
            data-slot="slider-detent"
            className="absolute h-1.25 w-0.5 -translate-x-1/2 rounded-full bg-muted-foreground/50"
            style={{ left: `${((detent - min) / (max - min)) * 100}%` }}
          />
        ))}
      </div>
      <SliderPrimitive.Thumb
        asChild
        id={id}
        ref={ref}
        data-slot="slider-thumb"
        tabIndex={props.disabled ? -1 : 0}
        aria-disabled={props.disabled || undefined}
        aria-labelledby={props["aria-labelledby"]}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        aria-required={props["aria-required"]}
        aria-valuetext={props["aria-valuetext"]}
        className="relative block h-5 w-4.5 shrink-0 cursor-grab rounded-md border border-input bg-linear-to-b from-background to-muted shadow-xs ring-ring/50 outline-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 active:cursor-grabbing active:ring-3 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
      >
        <motion.span
          whileTap={reduced || props.disabled ? undefined : { scale: 1.08 }}
          transition={
            reduced ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 46, mass: 0.5 }
          }
        />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  )
}
