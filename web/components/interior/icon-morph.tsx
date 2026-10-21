"use client"

import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Eye, EyeOff, Pause, Play } from "lucide-react"

export function IconMorph({
  active,
  preset,
  className,
  ...props
}: ComponentProps<"span"> & { active: boolean; preset: "visibility" | "playback" }) {
  const reduced = useReducedMotion()
  const Icon = preset === "visibility" ? (active ? EyeOff : Eye) : active ? Pause : Play
  return (
    <span {...props} aria-hidden="true" className={cn("inline-grid place-items-center", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={active ? "active" : "idle"}
          className="col-start-1 row-start-1 inline-flex"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 0.7 }}
          transition={
            reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: 0.45 }
          }
        >
          <Icon />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
