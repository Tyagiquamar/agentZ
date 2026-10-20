"use client"

import { useId, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { LayoutGroup, motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

export function TabsGroup({ children }: { children: ReactNode }) {
  const id = useId()
  return <LayoutGroup id={id}>{children}</LayoutGroup>
}

export function TabIndicator({ line = false, className }: { line?: boolean; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <motion.span
      aria-hidden="true"
      layoutId={line ? "tab-line" : "tab-fill"}
      className={cn(
        line
          ? "pointer-events-none absolute bg-foreground group-data-[variant=default]/tabs-list:hidden group-data-horizontal/tabs:inset-x-0 group-data-horizontal/tabs:-bottom-1.25 group-data-horizontal/tabs:h-0.5 group-data-vertical/tabs:inset-y-0 group-data-vertical/tabs:-right-1 group-data-vertical/tabs:w-0.5"
          : "pointer-events-none absolute inset-0 -z-1 rounded-[inherit] bg-background group-data-[variant=line]/tabs-list:hidden dark:bg-input/30",
        className
      )}
      initial={false}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 620, damping: 42, mass: 0.35 }
      }
    />
  )
}

export function TabTrigger({
  children,
  "data-state": state,
  ...props
}: Omit<HTMLMotionProps<"button">, "children"> & {
  children?: ReactNode
  "data-state"?: "active" | "inactive"
}) {
  return (
    <motion.button {...props} data-state={state}>
      {state === "active" ? (
        <>
          <TabIndicator />
          <TabIndicator line />
        </>
      ) : null}
      {children}
    </motion.button>
  )
}
