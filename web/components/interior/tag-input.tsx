"use client"

import { useState } from "react"

export function useTagInput({
  value: tags,
  onChange,
  parse,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  parse: (candidate: string) => string | undefined
}) {
  const [draft, setDraft] = useState("")
  const [armed, setArmed] = useState(-1)
  const [announcement, setAnnouncement] = useState("")
  const armedIndex = armed >= tags.length ? -1 : armed

  function add(raws: string[]) {
    const next = [...tags]
    let added = 0
    let failure: string | undefined

    for (const raw of raws) {
      const trimmed = raw.trim()
      if (!trimmed) continue
      const candidate = parse(trimmed)
      if (candidate === undefined) {
        failure = `${trimmed} is not allowed here.`
        continue
      }
      if (next.includes(candidate)) {
        failure = `${candidate} is already in the list.`
        continue
      }

      next.push(candidate)
      added += 1
    }

    if (added > 0) {
      onChange(next)
      setDraft("")
      setArmed(-1)
      setAnnouncement(
        `${added === 1 ? next[next.length - 1] : `${added} tags`} added, ${next.length} total.`
      )
    }

    if (failure) setAnnouncement(failure)
  }

  function removeAt(index: number) {
    if (index < 0 || index >= tags.length) return
    const gone = tags[index]
    const next = tags.filter((_, i) => i !== index)
    onChange(next)
    setArmed(-1)
    setAnnouncement(`${gone} removed, ${next.length} left.`)
  }

  function arm(index: number) {
    setArmed(index)
    setAnnouncement(`${tags[index]} selected, press Backspace again to remove it.`)
  }

  const inputProps = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value)
      setArmed(-1)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return

      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault()
        add([draft])
        return
      }

      if (e.key === "Backspace" && draft === "") {
        e.preventDefault()
        if (e.repeat) return
        if (armedIndex >= 0) removeAt(armedIndex)
        else if (tags.length > 0) arm(tags.length - 1)
        return
      }

      if (e.key === "Delete" && armedIndex >= 0) {
        e.preventDefault()
        if (e.repeat) return
        removeAt(armedIndex)
        return
      }

      if (e.key === "ArrowLeft") {
        const start = e.currentTarget.selectionStart
        const end = e.currentTarget.selectionEnd
        if (start !== 0 || end !== 0 || tags.length === 0) return
        e.preventDefault()
        arm(armedIndex < 0 ? tags.length - 1 : Math.max(0, armedIndex - 1))
        return
      }

      if (e.key === "ArrowRight" && armedIndex >= 0) {
        e.preventDefault()
        if (armedIndex >= tags.length - 1) setArmed(-1)
        else arm(armedIndex + 1)
        return
      }

      if (e.key === "Escape" && armedIndex >= 0) {
        e.preventDefault()
        setArmed(-1)
      }
    },
    onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text")
      const pattern = /[,\n\r\t]+/
      if (!pattern.test(text)) return
      e.preventDefault()
      add(text.split(pattern))
    },
    onBlur: () => setArmed(-1),
  }

  return {
    draft,
    armedIndex,
    announcement,
    inputProps,
    add,
    removeAt,
  }
}
