"use client"

import { useState, type ComponentProps } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowDownIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function NewItemsPill({
  visible,
  latestId,
  scope,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  visible: boolean
  latestId: string | undefined
  scope: string
}) {
  const reduced = useReducedMotion()
  const [seen, setSeen] = useState({ scope, latestId, unread: 0 })
  if (seen.scope !== scope || seen.latestId !== latestId || (!visible && seen.unread > 0)) {
    setSeen({
      scope,
      latestId,
      unread: visible && seen.scope === scope && seen.latestId !== undefined ? seen.unread + 1 : 0,
    })
  }
  const label =
    seen.unread > 0
      ? `${seen.unread} new ${seen.unread === 1 ? "message" : "messages"}. Scroll to latest message`
      : "Scroll to latest message"
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduced ? 0 : 6 }}
          transition={
            reduced ? { duration: 0 } : { type: "spring", stiffness: 540, damping: 34, mass: 0.5 }
          }
          className={props.className}
          style={props.style}
        >
          <Button
            {...props}
            className="rounded-full bg-background/80 shadow-sm backdrop-blur-md"
            style={undefined}
            aria-label={label}
            title={label}
          >
            <ArrowDownIcon />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
