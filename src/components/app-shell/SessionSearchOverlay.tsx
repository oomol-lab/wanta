import type { SessionInfo } from "../../../electron/session/common.ts"

import { Search } from "lucide-react"
import * as React from "react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { useT } from "@/i18n/i18n"

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function encodedDomIdSegment(value: string): string {
  return Array.from(value, (char) => {
    const codePoint = char.codePointAt(0)
    return codePoint === undefined ? "0" : codePoint.toString(16)
  }).join("-")
}

function sessionSearchResultId(sessionId: string): string {
  return `session-search-result-${encodedDomIdSegment(sessionId)}`
}

export function SessionSearchOverlay({
  sessions,
  open,
  onClose,
  onSelect,
}: {
  sessions: SessionInfo[]
  open: boolean
  onClose: () => void
  onSelect: (session: SessionInfo) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const resultRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const normalizedQuery = normalizeSearchText(query)
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => normalizeSearchText(session.title).includes(normalizedQuery))
    : sessions
  const activeSession = filteredSessions[activeIndex]
  const activeResultId = activeSession ? sessionSearchResultId(activeSession.id) : undefined

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [normalizedQuery])

  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredSessions.length - 1)))
  }, [filteredSessions.length])

  React.useEffect(() => {
    if (!activeSession) {
      return
    }
    resultRefs.current.get(activeSession.id)?.scrollIntoView({ block: "nearest" })
  }, [activeSession])

  const selectSession = (session: SessionInfo | undefined): void => {
    if (!session) {
      return
    }
    onSelect(session)
  }

  if (!open) {
    return null
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.search")}
      className="oo-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
          return
        }
        if (filteredSessions.length === 0) {
          return
        }
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveIndex((index) => (index + 1) % filteredSessions.length)
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveIndex((index) => (index - 1 + filteredSessions.length) % filteredSessions.length)
          return
        }
        if (event.key === "Home") {
          event.preventDefault()
          setActiveIndex(0)
          return
        }
        if (event.key === "End") {
          event.preventDefault()
          setActiveIndex(filteredSessions.length - 1)
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          selectSession(filteredSessions[activeIndex])
        }
      }}
    >
      <section className="oo-modal-surface w-full max-w-[520px] rounded-lg border p-5">
        <InputGroup className="oo-session-search-input h-10 rounded-lg shadow-none">
          <InputGroupAddon align="inline-start">
            <Search className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.searchPlaceholder")}
            aria-label={t("sidebar.searchPlaceholder")}
            aria-activedescendant={activeResultId}
            aria-controls="session-search-results"
            aria-expanded="true"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="oo-text-title h-8 min-w-0"
            role="combobox"
            spellCheck={false}
          />
        </InputGroup>

        <p className="oo-text-control mt-4 px-3 text-muted-foreground">
          {t("sidebar.searchResults", { count: filteredSessions.length })}
        </p>
        <div
          id="session-search-results"
          className="mt-3 max-h-[min(46vh,420px)] overflow-y-auto pr-1"
          role="listbox"
          aria-label={t("sidebar.searchResults", { count: filteredSessions.length })}
        >
          <div className="grid gap-1">
            {filteredSessions.map((session, index) => (
              <button
                key={session.id}
                id={sessionSearchResultId(session.id)}
                ref={(node) => {
                  if (node) {
                    resultRefs.current.set(session.id, node)
                  } else {
                    resultRefs.current.delete(session.id)
                  }
                }}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSession(session)}
                title={session.title}
                className="oo-session-search-result oo-text-label flex h-9 min-w-0 items-center rounded-md px-3 text-left"
              >
                <span className="truncate">{session.title}</span>
              </button>
            ))}
            {filteredSessions.length === 0 && (
              <p className="oo-text-control px-3 py-6 text-muted-foreground">{t("sidebar.searchEmpty")}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
