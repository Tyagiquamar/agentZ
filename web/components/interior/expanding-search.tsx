"use client"

import type { ReactNode } from "react"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

export function ExpandingSearch({
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "children"> & { children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      {...props}
      initial={reduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 38, mass: 0.7 }
      }
    >
      {children}
    </motion.div>
  )
}
