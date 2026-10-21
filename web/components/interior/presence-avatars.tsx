"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export type PresencePerson = { id: string; name: string; src?: string }

export function PresenceAvatars({
  people,
  max = 3,
  size = 24,
  overlap = 7,
  label = "Participants",
  className,
}: {
  people: readonly PresencePerson[]
  max?: number
  size?: number
  overlap?: number
  label?: string
  className?: string
}) {
  const reduced = useReducedMotion()
  const visible = people.slice(0, Math.max(1, max))
  const hidden = people.slice(visible.length)
  const step = size - overlap
  const chip = size + 8
  let width = 0
  if (visible.length > 0) {
    width = hidden.length ? visible.length * step + chip : (visible.length - 1) * step + size
  }
  const transition = reduced
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const)

  return (
    <span
      role="group"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center", className)}
    >
      <motion.span
        aria-hidden="true"
        className="relative block shrink-0 overflow-hidden"
        style={{ height: size }}
        initial={false}
        animate={{ width }}
        transition={transition}
      >
        <AnimatePresence initial={false}>
          {visible.map((person, index) => (
            <motion.span
              key={person.id}
              title={person.name}
              className="absolute top-0 left-0"
              style={{ width: size, height: size, zIndex: visible.length - index }}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.86, x: index * step }}
              animate={{ opacity: 1, scale: 1, x: index * step }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.86 }}
              transition={transition}
            >
              <Avatar className="size-full">
                <AvatarImage alt="" src={person.src} />
                <AvatarFallback style={{ fontSize: size / 2 }}>
                  {person.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => Array.from(word)[0]?.toUpperCase())
                    .join("") || "?"}
                </AvatarFallback>
              </Avatar>
            </motion.span>
          ))}
          {hidden.length > 0 ? (
            <motion.span
              key="overflow"
              title={hidden.map((person) => person.name).join(", ")}
              className="absolute top-0 left-0 grid place-items-center rounded-full bg-sidebar-control-surface text-[10px] text-sidebar-muted-foreground ring-2 ring-sidebar"
              style={{ width: chip, height: size }}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.86, x: visible.length * step }}
              animate={{ opacity: 1, scale: 1, x: visible.length * step }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.86 }}
              transition={transition}
            >
              +{hidden.length > 99 ? "99+" : hidden.length}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.span>
      <span className="sr-only">{people.map((person) => person.name).join(", ")}</span>
    </span>
  )
}
