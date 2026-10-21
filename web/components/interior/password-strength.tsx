"use client"

import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"
import { passwordFieldDescription, passwordSchema } from "@/lib/password-policy"

export function PasswordStrength({ value }: { value: string }) {
  const reduced = useReducedMotion()
  const result = passwordSchema.safeParse(value)
  const passed = result.success ? 5 : 5 - result.error.issues.length
  return (
    <span className="relative block">
      <span>{passwordFieldDescription}</span>
      <span aria-hidden="true" className="absolute inset-x-0 -bottom-1 flex h-px gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <motion.span
            key={index}
            className={cn(
              "h-full flex-1 rounded-full",
              value && index < passed ? "bg-primary" : "bg-transparent"
            )}
            initial={false}
            animate={{ opacity: value && index < passed ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
          />
        ))}
      </span>
      <span className="sr-only">{value ? `${passed} of 5 password requirements met.` : ""}</span>
    </span>
  )
}
