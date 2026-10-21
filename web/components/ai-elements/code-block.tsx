"use client"

import { cn } from "@/lib/utils"
import type { CSSProperties, HTMLAttributes } from "react"
import { memo, useEffect, useMemo, useState } from "react"
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from "shiki"
import { createHighlighter } from "shiki"

const TokenSpan = ({ token }: { token: ThemedToken }) => {
  const fontStyle = token.fontStyle ?? 0
  const style: CSSProperties = {
    backgroundColor: token.bgColor,
    color: token.color,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? "bold" : undefined,
    textDecoration: fontStyle & 4 ? "underline" : undefined,
    ...token.htmlStyle,
  }

  return (
    <span className="dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!" style={style}>
      {token.content}
    </span>
  )
}

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

// Highlighter cache (singleton per language)
const highlighterCache = new Map<
  string,
  Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
>()

// Token cache
const tokensCache = new Map<string, TokenizedCode>()

// Subscribers for async token updates
const subscribers = new Map<string, Set<(result: TokenizedCode) => void>>()

const getHighlighter = (
  language: BundledLanguage
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
  const cached = highlighterCache.get(language)
  if (cached) {
    return cached
  }

  const highlighterPromise = createHighlighter({
    langs: [language],
    themes: ["github-light", "github-dark"],
  })

  highlighterCache.set(language, highlighterPromise)
  return highlighterPromise
}

// Create raw tokens for immediate display while highlighting loads
const createRawTokens = (code: string): TokenizedCode => {
  let offset = 0
  const tokens = code.split("\n").map((line) => {
    const lineOffset = offset
    offset += line.length + 1
    return line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
            offset: lineOffset,
          },
        ]
  })

  return {
    bg: "transparent",
    fg: "inherit",
    tokens,
  }
}

// Synchronous highlight with callback for async results
const highlightCode = (
  code: string,
  language: BundledLanguage,
  callback?: (result: TokenizedCode) => void
): TokenizedCode | null => {
  const tokensCacheKey = JSON.stringify([language, code])

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey)
  if (cached) {
    return cached
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set())
    }
    subscribers.get(tokensCacheKey)?.add(callback)
  }

  // Start highlighting in background - fire-and-forget async pattern
  getHighlighter(language)
    .then((highlighter) => {
      const availableLangs = highlighter.getLoadedLanguages()
      const langToUse = availableLangs.includes(language) ? language : "text"

      const result = highlighter.codeToTokens(code, {
        lang: langToUse,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      })

      const tokenized: TokenizedCode = {
        bg: result.bg ?? "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      }

      // Cache the result
      tokensCache.set(tokensCacheKey, tokenized)

      // Notify all subscribers
      const subs = subscribers.get(tokensCacheKey)
      if (subs) {
        for (const sub of subs) {
          sub(tokenized)
        }
        subscribers.delete(tokensCacheKey)
      }
    })
    .catch((error) => {
      console.error("Failed to highlight code:", error)
      subscribers.delete(tokensCacheKey)
    })

  return null
}

const CodeBlockBody = memo(
  ({ tokenized, showLineNumbers }: { tokenized: TokenizedCode; showLineNumbers: boolean }) => {
    const preStyle = useMemo(
      () => ({
        backgroundColor: tokenized.bg,
        color: tokenized.fg,
      }),
      [tokenized.bg, tokenized.fg]
    )

    return (
      <pre
        className="m-0 p-4 text-sm dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!"
        style={preStyle}
      >
        <code
          className={cn(
            "font-mono text-sm",
            showLineNumbers && "[counter-increment:line_0] [counter-reset:line]"
          )}
        >
          {tokenized.tokens.map((line, lineIndex) => (
            <span
              key={`line-${lineIndex}`}
              className={
                showLineNumbers
                  ? "block before:mr-4 before:inline-block before:w-8 before:text-right before:font-mono before:text-muted-foreground/50 before:content-[counter(line)] before:select-none before:[counter-increment:line]"
                  : "block"
              }
            >
              {line.length === 0
                ? "\n"
                : line.map((token, tokenIndex) => (
                    <TokenSpan key={`line-${lineIndex}-${tokenIndex}`} token={token} />
                  ))}
            </span>
          ))}
        </code>
      </pre>
    )
  },
  (prevProps, nextProps) =>
    prevProps.tokenized === nextProps.tokenized &&
    prevProps.showLineNumbers === nextProps.showLineNumbers
)

CodeBlockBody.displayName = "CodeBlockBody"

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false,
}: {
  code: string
  language: BundledLanguage
  showLineNumbers?: boolean
}) => {
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code])

  // Async highlighting result (populated after shiki loads)
  const [asyncTokens, setAsyncTokens] = useState<{
    code: string
    language: BundledLanguage
    tokens: TokenizedCode
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    const cachedResult = highlightCode(code, language, (result) => {
      if (!cancelled) {
        setAsyncTokens({ code, language, tokens: result })
      }
    })
    if (cachedResult && !cancelled) {
      queueMicrotask(() => {
        if (!cancelled) {
          setAsyncTokens({ code, language, tokens: cachedResult })
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [code, language])

  const tokenized =
    asyncTokens?.code === code && asyncTokens.language === language ? asyncTokens.tokens : rawTokens

  return (
    <div className="relative max-w-full overflow-auto">
      <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
    </div>
  )
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  style,
  ...props
}: CodeBlockProps) => (
  <div
    className={cn(
      "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
      className
    )}
    data-language={language}
    style={{ containIntrinsicSize: "auto 200px", contentVisibility: "auto", ...style }}
    {...props}
  >
    {children}
    <CodeBlockContent code={code} language={language} showLineNumbers={showLineNumbers} />
  </div>
)
