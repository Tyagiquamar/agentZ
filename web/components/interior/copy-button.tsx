"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Check, Copy, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CopyButton({
  content,
  label = "Copy to clipboard",
}: {
  content: string
  label?: string
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduced = useReducedMotion()

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget
    if (timer.current) clearTimeout(timer.current)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
      } else {
        const input = document.createElement("textarea")
        input.value = content
        input.readOnly = true
        input.style.cssText = "position:fixed;opacity:0;inset:0;pointer-events:none"
        const host = button.closest('[role="dialog"]') ?? document.body
        host.appendChild(input)
        input.select()
        try {
          if (!document.execCommand("copy")) throw new Error("Clipboard access was rejected")
        } finally {
          input.remove()
          button.focus({ preventScroll: true })
        }
      }
      setStatus("copied")
    } catch {
      setStatus("error")
    }
    timer.current = setTimeout(() => setStatus("idle"), 2000)
  }

  const Icon = status === "copied" ? Check : status === "error" ? X : Copy
  const message =
    status === "copied" ? "Copied" : status === "error" ? "Copy failed. Try again." : label

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative size-6"
      aria-label={label}
      title={message}
      onClick={copy}
    >
      <span className="relative grid size-4 place-items-center" aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={status}
            className="col-start-1 row-start-1 inline-flex"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.7 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", stiffness: 520, damping: 34, mass: 0.45 }
            }
          >
            <Icon />
          </motion.span>
        </AnimatePresence>
      </span>
      <span role="status" className="sr-only">
        {status === "idle" ? "" : message}
      </span>
    </Button>
  )
}
