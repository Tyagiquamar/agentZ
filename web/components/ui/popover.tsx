"use client"

import * as React from "react"
import {
  Popover as InteriorPopover,
  PopoverPresence,
  PopoverPanel,
} from "@/components/interior/popover"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <InteriorPopover {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  children,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPresence>
      <PopoverPrimitive.Portal forceMount>
        <PopoverPrimitive.Content
          asChild
          forceMount
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
            className
          )}
          {...props}
        >
          <PopoverPanel>{children}</PopoverPanel>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPresence>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
