"use client"

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react"
import { Tooltip as Primitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

const OpenContext = createContext(false)

export function Tooltip({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  const [internal, setInternal] = useState(defaultOpen)
  const open = controlled ?? internal
  return (
    <Primitive.Root
      {...props}
      open={open}
      onOpenChange={(next) => {
        if (controlled === undefined) setInternal(next)
        onOpenChange?.(next)
      }}
    >
      <OpenContext value={open}>{children}</OpenContext>
    </Primitive.Root>
  )
}

export function TooltipPresence({ children }: { children: ReactNode }) {
  const open = useContext(OpenContext)
  return <AnimatePresence>{open ? children : null}</AnimatePresence>
}

export function TooltipPanel(props: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      {...props}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.45 }
      }
    />
  )
}
