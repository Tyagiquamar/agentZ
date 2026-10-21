"use client"

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useRef,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from "react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useRouter } from "@bprogress/next/app"
import {
  encodeSelectionHistory,
  invalidateSelections,
  readSelectionHistory,
  rememberSelection,
  restoreSelection,
  selectionCookie,
  selectionFields,
  selectionGroups,
  selectionPages,
  selectionURL,
  type PageSelection,
  type SelectionHistory,
  type SelectionPage,
} from "@/lib/page-selection"
import type { ResolvedPageSelection } from "@/data/page-selection"

type SelectionContextValue = {
  scope: string
  basePath: string
  history: SelectionHistory
  read: () => SelectionHistory
  remember: (
    page: SelectionPage,
    selected: PageSelection | undefined,
    requested: PageSelection,
    invalid: PageSelection[],
    resolvedAt: number
  ) => boolean
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

/** Share defaults with navigation links without changing the active page in other tabs. */
export function PageSelectionProvider({
  scope,
  basePath,
  initialHistory,
  children,
}: {
  scope: string
  basePath: string
  initialHistory: SelectionHistory
  children: ReactNode
}) {
  const [history, setHistory] = useState(initialHistory)
  const channel = useRef<BroadcastChannel | null>(null)
  const storageUnavailable = useRef(false)
  const invalidated = useRef<{ resource: PageSelection; at: number }[]>([])

  function read() {
    if (storageUnavailable.current) return history
    try {
      const value = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${selectionCookie}=`))
        ?.slice(selectionCookie.length + 1)
      return value ? readSelectionHistory(value) : history
    } catch {
      return history
    }
  }

  const refresh = useEffectEvent(() => setHistory(read()))
  useEffect(() => {
    const update = () => refresh()
    try {
      channel.current = new BroadcastChannel(selectionCookie)
      channel.current.onmessage = (
        event: MessageEvent<{ scope: string; invalid: PageSelection[]; at: number } | null>
      ) => {
        if (event.data?.scope === scope) {
          const { invalid, at } = event.data
          invalidated.current.push(...invalid.map((resource) => ({ resource, at })))
        }
        refresh()
      }
    } catch {
      // Focus still refreshes link defaults when cross-tab messaging is unavailable.
    }
    window.addEventListener("focus", update)
    update()
    return () => {
      channel.current?.close()
      channel.current = null
      window.removeEventListener("focus", update)
    }
  }, [scope])

  function remember(
    page: SelectionPage,
    selected: PageSelection | undefined,
    requested: PageSelection,
    invalid: PageSelection[],
    resolvedAt: number
  ) {
    const at = resolvedAt
    invalidated.current.push(...invalid.map((resource) => ({ resource, at })))
    if (
      selected &&
      invalidated.current.some(
        ({ resource, at }) =>
          at > resolvedAt &&
          selectionFields.every(
            (field) => resource[field] === undefined || selected[field] === resource[field]
          )
      )
    )
      return false
    const current = read()
    let next = invalidateSelections(current, scope, invalid)
    if (selected) next = rememberSelection(next, scope, page, selected, requested)
    const value = encodeSelectionHistory(next)
    if (value === encodeSelectionHistory(current)) return true
    try {
      document.cookie = `${selectionCookie}=${value}; Path=/; Max-Age=15552000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
      storageUnavailable.current = !document.cookie
        .split("; ")
        .includes(`${selectionCookie}=${value}`)
      channel.current?.postMessage({ scope, invalid, at })
    } catch {
      // Keep this tab usable when browser persistence is disabled.
      storageUnavailable.current = true
    }
    setHistory(next)
    return true
  }

  return (
    <SelectionContext value={{ scope, basePath, history, read, remember }}>
      {children}
    </SelectionContext>
  )
}

/** Record only committed, validated server selections; prefetch never writes preferences. */
export function RememberPageSelection({
  selected,
  requested,
  invalid,
  error,
  resolvedAt,
}: Pick<ResolvedPageSelection, "selected" | "requested" | "invalid" | "error" | "resolvedAt">) {
  const context = useContext(SelectionContext)
  const pathname = usePathname()
  const router = useRouter()
  const selectedKey = JSON.stringify(selected)
  const requestedKey = JSON.stringify(requested)
  const invalidKey = JSON.stringify(invalid)
  const commit = useEffectEvent(() => {
    if (!context || document.visibilityState === "hidden") return
    const page = selectionPages.find((page) => pathname === `${context.basePath}/${page}`)
    if (!page || location.pathname !== pathname) return
    const search = new URLSearchParams(location.search)
    if (
      Object.entries(requested).some(([key, value]) => search.has(key) && search.get(key) !== value)
    )
      return
    if (!context.remember(page, error ? undefined : selected, requested, invalid, resolvedAt)) {
      router.replace(selectionURL(pathname, search, {}, true))
      return
    }
    if (error) return
    const changed = selectionGroups(page, requested)
      .flat()
      .some((key) => requested[key] !== selected[key])
    const href = selectionURL(pathname, search, selected, changed) + location.hash
    if (`${location.pathname}${location.search}${location.hash}` !== href)
      window.history.replaceState(null, "", href)
  })
  useEffect(() => {
    commit()
  }, [pathname, selectedKey, requestedKey, invalidKey, error, resolvedAt])
  return error?.code === "not_found" ? (
    <Link href={pathname as Route} className="px-6 py-2 text-sm underline underline-offset-4">
      Choose an available resource
    </Link>
  ) : null
}

/** Keep prefetched URLs and the eventual click aligned with the latest defaults. */
export function SelectionLink<T extends string>({
  href,
  onNavigate,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: Route<T> }) {
  const context = useContext(SelectionContext)
  const router = useRouter()
  function destination(history: SelectionHistory | undefined): Route<T> {
    if (!context || !history) return href
    const url = new URL(href, "http://selection.local")
    const page = selectionPages.find((page) => url.pathname === `${context.basePath}/${page}`)
    if (!page) return href
    const requested: PageSelection = {}
    for (const field of selectionGroups(page, {
      type: url.searchParams.get("type") ?? undefined,
    }).flat()) {
      const value = url.searchParams.get(field)
      if (value !== null) requested[field] = value
    }
    const selected = restoreSelection(history, context.scope, page, requested)
    return (selectionURL(url.pathname, url.searchParams, selected, false, requested) +
      url.hash) as Route<T>
  }
  const target = destination(context?.history)
  return (
    <Link
      {...props}
      href={target}
      onNavigate={(event) => {
        onNavigate?.(event)
        const latest = destination(context?.read())
        if (latest !== target) {
          event.preventDefault()
          router.push(latest)
        }
      }}
    />
  )
}

/** Resource changes are GET navigation; the server validates before rendering any content. */
export function useSelectResource(replace = false) {
  const context = useContext(SelectionContext)
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function select(requested: PageSelection) {
    const page =
      context && selectionPages.find((page) => pathname === `${context.basePath}/${page}`)
    const selected =
      context && page ? restoreSelection(context.read(), context.scope, page, requested) : requested
    const href = selectionURL(pathname, search, selected, true, requested)
    startTransition(() => {
      if (replace) router.replace(href)
      else router.push(href)
    })
  }

  return { pending, select }
}
