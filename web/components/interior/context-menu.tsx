"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react"
import { cn } from "@/lib/utils"

type Highlight = { x: number; y: number; width: number; height: number }

export function MenuSurface({
  children,
  className,
  ...props
}: Omit<HTMLMotionProps<"div">, "children"> & { children?: ReactNode }) {
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const frame = useRef(0)
  const reduced = useReducedMotion()
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function follow(root: HTMLDivElement) {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const item = root.querySelector<HTMLElement>("[data-highlighted]:not([data-disabled])")
      if (!item) {
        setHighlight(null)
        return
      }
      const box = item.getBoundingClientRect()
      const parent = root.getBoundingClientRect()
      const next = {
        x: box.left - parent.left + root.scrollLeft,
        y: box.top - parent.top + root.scrollTop,
        width: box.width,
        height: box.height,
      }
      setHighlight((current) =>
        current?.x === next.x &&
        current.y === next.y &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next
      )
    })
  }

  return (
    <motion.div
      {...props}
      className={cn("relative isolate", className)}
      onPointerMove={(event) => {
        props.onPointerMove?.(event)
        follow(event.currentTarget)
      }}
      onFocusCapture={(event) => {
        props.onFocusCapture?.(event)
        follow(event.currentTarget)
      }}
      onPointerLeave={(event) => {
        props.onPointerLeave?.(event)
        cancelAnimationFrame(frame.current)
        setHighlight(null)
      }}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.45 }
      }
    >
      {highlight ? (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute -z-1 rounded-md bg-foreground/10"
          initial={false}
          animate={highlight}
          transition={
            reduced ? { duration: 0 } : { type: "spring", stiffness: 620, damping: 42, mass: 0.35 }
          }
        />
      ) : null}
      {children}
    </motion.div>
  )
}
