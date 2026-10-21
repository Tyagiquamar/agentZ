"use client"

import { useEffect } from "react"
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react"
import { cn } from "@/lib/utils"

function Dot({ index, wave, size }: { index: number; wave: MotionValue<number>; size: number }) {
  const lift = useTransform(wave, (value) => {
    let distance = (value - index) % 3
    if (distance < 0) distance += 3
    if (distance > 1.5) distance -= 3
    return Math.max(0, 1 - Math.abs(distance))
  })
  const scale = useTransform(lift, [0, 1], [0.74, 1])
  const opacity = useTransform(lift, [0, 1], [0.32, 1])

  return (
    <motion.span
      className="block rounded-full bg-muted-foreground"
      style={{ width: size, height: size, scale, opacity }}
    />
  )
}

export function TypingIndicator({
  label = "Thinking...",
  size = 20,
  className,
}: {
  label?: string
  size?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const wave = useMotionValue(0)
  useEffect(() => {
    if (reduced) {
      wave.jump(0)
      return
    }
    const controls = animate(wave, 3, {
      duration: 1.25,
      ease: "linear",
      repeat: Infinity,
      repeatType: "loop",
    })
    return () => controls.stop()
  }, [reduced, wave])

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground",
        className
      )}
    >
      <motion.span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full bg-muted"
        style={{ width: size * 2, height: size, gap: Math.round(size * 0.15) }}
        initial={reduced ? false : { opacity: 0, scale: 0.74 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30, mass: 0.8 }
        }
      >
        {[0, 1, 2].map((index) =>
          reduced ? (
            <span
              key={index}
              className="block rounded-full bg-muted-foreground opacity-80"
              style={{ width: Math.round(size * 0.23), height: Math.round(size * 0.23) }}
            />
          ) : (
            <Dot key={index} index={index} wave={wave} size={Math.round(size * 0.23)} />
          )
        )}
      </motion.span>
      <span aria-hidden="true" className="truncate">
        {label}
      </span>
    </span>
  )
}
