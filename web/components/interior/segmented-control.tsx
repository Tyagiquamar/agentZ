"use client"

import { useId, useRef, type ReactNode } from "react"
import { LayoutGroup, motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

type Option<T extends string> = { value: T; label: ReactNode; disabled?: boolean }

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  disabled = false,
  className,
}: {
  options: readonly Option<T>[]
  value: T
  onValueChange: (value: T) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const reduced = useReducedMotion()
  return (
    <LayoutGroup id={id}>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("inline-flex h-8 items-center rounded-lg bg-muted p-[3px]", className)}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={option.disabled}
            aria-disabled={disabled || option.disabled || undefined}
            tabIndex={value === option.value ? 0 : -1}
            ref={(node) => {
              if (node) buttons.current.set(option.value, node)
              else buttons.current.delete(option.value)
            }}
            onClick={() => {
              if (!disabled) onValueChange(option.value)
            }}
            onKeyDown={(event) => {
              if (disabled) return
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
              event.preventDefault()
              const enabled = options.filter((item) => !item.disabled)
              const current = enabled.findIndex((item) => item.value === option.value)
              let next = enabled.at(0)
              if (event.key === "End") next = enabled.at(-1)
              if (event.key === "ArrowRight") next = enabled.at((current + 1) % enabled.length)
              if (event.key === "ArrowLeft")
                next = enabled.at((current - 1 + enabled.length) % enabled.length)
              if (next) {
                onValueChange(next.value)
                buttons.current.get(next.value)?.focus()
              }
            }}
            className={cn(
              "relative isolate inline-flex h-[calc(100%-1px)] min-w-max flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
              value === option.value && "text-foreground shadow-sm dark:border-input"
            )}
          >
            {value === option.value ? (
              <motion.span
                aria-hidden="true"
                layoutId="segment"
                className="pointer-events-none absolute inset-0 -z-1 rounded-[inherit] bg-background dark:bg-input/30"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 520, damping: 34, mass: 0.45 }
                }
              />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>
    </LayoutGroup>
  )
}
