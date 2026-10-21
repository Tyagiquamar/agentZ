"use client"

import type { Route } from "next"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { createContext, useContext, useEffect, useTransition } from "react"

import { toast } from "sonner"

/** Remove restoration hints after arrival so copied links retain explicit-link behavior. */
export function RestoredRoute() {
  const pathname = usePathname()
  useEffect(() => {
    const url = new URL(location.href)
    if (!url.searchParams.has("__restore") && !url.searchParams.has("__recovered")) return
    if (url.searchParams.has("__recovered"))
      toast.info("The previously viewed resource is no longer available.")
    url.searchParams.delete("__restore")
    url.searchParams.delete("__recovered")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }, [pathname])
  return null
}

type ScopeTransition = {
  isPending: boolean
  navigate(destination: Route | Promise<Route>): void
}

const ScopeTransitionContext = createContext<ScopeTransition | null>(null)

export function AgentZTransition() {
  return (
    <div
      aria-label="Loading AgentZ"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
      data-agentz-transition=""
      role="status"
    >
      <Image alt="AgentZ" height={84} priority src="/agentz-logo.svg" width={96} />
    </div>
  )
}

export function ScopeTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function navigate(destination: Route | Promise<Route>) {
    startTransition(async () => {
      router.push(await destination)
    })
  }

  return (
    <ScopeTransitionContext value={{ isPending, navigate }}>
      {children}
      {isPending ? <AgentZTransition /> : null}
    </ScopeTransitionContext>
  )
}

export function useScopeTransition(): ScopeTransition {
  const transition = useContext(ScopeTransitionContext)
  if (!transition) {
    throw new Error("useScopeTransition must be used within ScopeTransitionProvider")
  }
  return transition
}
