"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { LoadingButton } from "@/components/interior/loading-button"

export function LoadMore({ onClick, pending, ...props }: ComponentProps<typeof LoadingButton>) {
  const button = useRef<HTMLButtonElement>(null)
  const autoLoads = useRef(0)
  useEffect(() => {
    const node = button.current
    if (!node || pending || autoLoads.current >= 3) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || node.disabled) return
        observer.disconnect()
        autoLoads.current += 1
        node.click()
      },
      { rootMargin: "100px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [pending])
  return <LoadingButton {...props} pending={pending} ref={button} onClick={onClick} />
}
