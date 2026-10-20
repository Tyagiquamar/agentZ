"use client"

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "motion/react"

const ModalContext = createContext(false)

export function Modal({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Root>) {
  const [internal, setInternal] = useState(defaultOpen)
  const open = controlled ?? internal
  return (
    <DialogPrimitive.Root
      {...props}
      open={open}
      onOpenChange={(next) => {
        if (controlled === undefined) setInternal(next)
        onOpenChange?.(next)
      }}
    >
      <ModalContext value={open}>{children}</ModalContext>
    </DialogPrimitive.Root>
  )
}

export function ModalPresence({ children }: { children: ReactNode }) {
  const open = useContext(ModalContext)
  return <AnimatePresence>{open ? children : null}</AnimatePresence>
}

export function ModalBackdrop(props: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      {...props}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.12 }}
    />
  )
}

export function ModalPanel({
  side,
  ...props
}: HTMLMotionProps<"div"> & { side?: "top" | "right" | "bottom" | "left" }) {
  const reduced = useReducedMotion()
  let offset = { x: 0, y: 0, scale: 0.96 }
  if (side)
    offset = {
      x: side === "left" ? -24 : side === "right" ? 24 : 0,
      y: side === "top" ? -24 : side === "bottom" ? 24 : 0,
      scale: 1,
    }
  return (
    <motion.div
      {...props}
      initial={reduced ? { opacity: 0 } : { opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, ...offset }}
      transition={
        reduced ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 38, mass: 0.8 }
      }
    />
  )
}

export function useModalFocusRestoration({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: Pick<ComponentProps<typeof DialogPrimitive.Content>, "onOpenAutoFocus" | "onCloseAutoFocus">) {
  const target = useRef<HTMLElement>(null)
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement
      target.current = active instanceof HTMLElement && active !== document.body ? active : null
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event)
      if (!event.defaultPrevented && target.current?.isConnected) {
        event.preventDefault()
        target.current.focus({ preventScroll: true })
      }
    },
  }
}
