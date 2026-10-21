"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export function SkeletonSwap({
  ready,
  skeleton,
  children,
  className,
}: {
  ready: boolean
  skeleton: ReactNode
  children: ReactNode
  className?: string
}) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (!ready) {
      if (showSkeleton) return
      const timer = setTimeout(() => {
        shownAt.current = performance.now()
        setShowSkeleton(true)
      }, 120)
      return () => clearTimeout(timer)
    }
    if (!showSkeleton) return
    const remaining = Math.max(0, 380 - (performance.now() - shownAt.current))
    const timer = setTimeout(() => setShowSkeleton(false), remaining)
    return () => clearTimeout(timer)
  }, [ready, showSkeleton])
  const reduced = useReducedMotion()
  const loading = !ready || showSkeleton
  return (
    <div aria-busy={!ready} className={cn("grid min-h-0 min-w-0", className)}>
      <motion.div
        className="col-start-1 row-start-1 min-h-0 min-w-0"
        inert={loading}
        aria-hidden={loading || undefined}
        initial={false}
        animate={{ opacity: loading ? 0 : 1 }}
        transition={{ duration: reduced ? 0 : 0.15 }}
      >
        {children}
      </motion.div>
      <AnimatePresence>
        {loading ? (
          <motion.div
            key="skeleton"
            className="col-start-1 row-start-1"
            initial={false}
            animate={{ opacity: showSkeleton ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.12 }}
          >
            {skeleton}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
