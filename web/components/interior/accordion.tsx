"use client"

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

export function DisclosurePanel(props: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      {...props}
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 38, mass: 0.8 }
      }
    />
  )
}
