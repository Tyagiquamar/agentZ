"use client"

import type { ComponentProps, ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function LoadingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  "aria-busy": busy,
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild"> & {
  pending: boolean
  pendingLabel?: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <Button {...props} disabled={disabled || pending} aria-busy={pending || busy || undefined}>
      <span className="grid place-items-center">
        <motion.span
          className="col-start-1 row-start-1 inline-flex items-center gap-1.5"
          initial={false}
          animate={{ opacity: pending ? 0 : 1, y: pending && !reduced ? -3 : 0 }}
          transition={{ duration: reduced ? 0 : 0.12 }}
          aria-hidden={pending}
        >
          {children}
        </motion.span>
        <motion.span
          className="col-start-1 row-start-1 inline-flex items-center gap-1.5"
          initial={false}
          animate={{ opacity: pending ? 1 : 0, y: !pending && !reduced ? 3 : 0 }}
          transition={{ duration: reduced ? 0 : 0.12 }}
          aria-hidden={!pending}
        >
          <Spinner />
          {pendingLabel ?? <span className="[&_svg]:hidden">{children}</span>}
        </motion.span>
      </span>
    </Button>
  )
}
