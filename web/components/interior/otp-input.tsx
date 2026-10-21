"use client"

import { useState, type ComponentProps } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export function OtpInput({
  value,
  length = 6,
  disabled,
  onChange,
  onSelect,
  className,
  ...props
}: Omit<ComponentProps<"input">, "value" | "type" | "maxLength"> & {
  value: string
  length?: number
}) {
  const [active, setActive] = useState(0)
  const reduced = useReducedMotion()
  return (
    <div className={cn("group/otp relative flex h-8 gap-1.5", disabled && "opacity-50", className)}>
      <input
        {...props}
        disabled={disabled}
        value={value}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="absolute inset-0 z-10 size-full cursor-text opacity-0 disabled:cursor-not-allowed"
        onChange={(event) => {
          event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, length)
          setActive(event.currentTarget.selectionStart ?? 0)
          onChange?.(event)
        }}
        onSelect={(event) => {
          setActive(event.currentTarget.selectionStart ?? 0)
          onSelect?.(event)
        }}
      />
      <div aria-hidden="true" className="flex w-full gap-1.5">
        {Array.from({ length }, (_, index) => (
          <span
            key={index}
            data-invalid={props["aria-invalid"]}
            className={cn(
              "form-control relative flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg border text-sm tabular-nums data-[invalid=true]:border-destructive",
              !disabled &&
                index === Math.min(active, length - 1) &&
                "group-focus-within/otp:border-primary group-focus-within/otp:shadow-[0_0_0_2px_color-mix(in_oklab,var(--primary)_15%,transparent)]"
            )}
          >
            <motion.span
              key={value[index] ?? "empty"}
              initial={reduced ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0 : 0.12 }}
            >
              {value[index] ?? ""}
            </motion.span>
          </span>
        ))}
      </div>
    </div>
  )
}
