"use client"

import * as React from "react"
import {
  Tooltip as InteriorTooltip,
  TooltipPresence,
  TooltipPanel,
} from "@/components/interior/tooltip-group"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <InteriorTooltip {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPresence>
      <TooltipPrimitive.Portal forceMount>
        <TooltipPrimitive.Content
          asChild
          forceMount
          data-slot="tooltip-content"
          sideOffset={sideOffset}
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className
          )}
          {...props}
        >
          <TooltipPanel>
            {children}
            <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-xs bg-foreground fill-foreground" />
          </TooltipPanel>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPresence>
  )
}

type DisabledReasonProps = {
  reason: string
  children: React.ReactElement
}

function DisabledReason({ reason, children }: DisabledReasonProps) {
  const descriptionId = React.useId()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-describedby={descriptionId}
          className="inline-flex cursor-not-allowed rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&>*]:pointer-events-none"
          tabIndex={0}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
      <span className="sr-only" id={descriptionId}>
        {reason}
      </span>
    </Tooltip>
  )
}

function TruncatedText({ className, value }: { className?: string; value: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = React.useState(false)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [value])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("truncate", className)} ref={ref} tabIndex={truncated ? 0 : undefined}>
          {value}
        </span>
      </TooltipTrigger>
      {truncated ? <TooltipContent>{value}</TooltipContent> : null}
    </Tooltip>
  )
}

export { DisabledReason, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TruncatedText }
