"use client"

import { Button } from "@/components/ui/button"
import { HoverCard as HoverCardPrimitive } from "radix-ui"
import { Progress } from "@/components/interior/progress-bar"
import { cn } from "@/lib/utils"
import type { LanguageModelUsage } from "ai"
import type { ComponentProps } from "react"
import { createContext, useContext, useMemo } from "react"

const PERCENT_MAX = 100
const ICON_RADIUS = 10
const ICON_VIEWBOX = 24
const ICON_CENTER = 12
const ICON_STROKE_WIDTH = 2
const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  style: "percent",
})
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
})
interface ContextSchema {
  usedTokens: number
  maxTokens: number
  usage?: LanguageModelUsage
}

const ContextContext = createContext<ContextSchema | null>(null)

const useContextValue = () => {
  const context = useContext(ContextContext)

  if (!context) {
    throw new Error("Context components must be used within Context")
  }

  return context
}

type ContextProps = ComponentProps<typeof HoverCardPrimitive.Root> & ContextSchema

export const Context = ({ usedTokens, maxTokens, usage, ...props }: ContextProps) => {
  const contextValue = useMemo(
    () => ({ maxTokens, usage, usedTokens }),
    [maxTokens, usage, usedTokens]
  )

  return (
    <ContextContext.Provider value={contextValue}>
      <HoverCardPrimitive.Root closeDelay={0} openDelay={0} {...props} />
    </ContextContext.Provider>
  )
}

const ContextIcon = () => {
  const { usedTokens, maxTokens } = useContextValue()
  const circumference = 2 * Math.PI * ICON_RADIUS
  const usedPercent = usedTokens / maxTokens
  const dashOffset = circumference * (1 - usedPercent)

  return (
    <svg
      aria-label="Model context usage"
      height="20"
      role="img"
      style={{ color: "currentcolor" }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  )
}

export const ContextTrigger = ({ children, ...props }: ComponentProps<typeof Button>) => {
  const { usedTokens, maxTokens } = useContextValue()
  const renderedPercent = percentFormatter.format(usedTokens / maxTokens)

  return (
    <HoverCardPrimitive.Trigger asChild data-slot="hover-card-trigger">
      {children ?? (
        <Button type="button" variant="ghost" {...props}>
          <span className="font-medium text-muted-foreground">{renderedPercent}</span>
          <ContextIcon />
        </Button>
      )}
    </HoverCardPrimitive.Trigger>
  )
}

export const ContextContent = ({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      data-slot="hover-card-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-64 min-w-60 origin-(--radix-hover-card-content-transform-origin) divide-y overflow-hidden rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      )}
      {...props}
    />
  </HoverCardPrimitive.Portal>
)

export const ContextContentHeader = ({ children, className, ...props }: ComponentProps<"div">) => {
  const { usedTokens, maxTokens } = useContextValue()
  const usedPercent = usedTokens / maxTokens
  const displayPct = percentFormatter.format(usedPercent)
  const used = compactFormatter.format(usedTokens)
  const total = compactFormatter.format(maxTokens)

  return (
    <div className={cn("w-full space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="font-mono text-muted-foreground">
              {used} / {total}
            </p>
          </div>
          <div className="space-y-2">
            <Progress className="bg-muted" value={usedPercent * PERCENT_MAX} />
          </div>
        </>
      )}
    </div>
  )
}

export function ContextUsage({ className }: { className?: string }) {
  const { usage } = useContextValue()
  const rows = [
    ["Input", usage?.inputTokens],
    ["Output", usage?.outputTokens],
    ["Reasoning", usage?.reasoningTokens],
    ["Cache", usage?.cachedInputTokens],
  ] as const

  return (
    <div className={cn("flex w-full flex-col gap-2 p-3", className)}>
      {rows.map(([label, tokens]) =>
        tokens ? (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span>{compactFormatter.format(tokens)}</span>
          </div>
        ) : null
      )}
    </div>
  )
}
