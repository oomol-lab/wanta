import type { SessionInfo } from "../../../electron/session/common.ts"

import { Search } from "lucide-react"
import * as React from "react"
import { Dialog } from "@/components/ui/dialog"
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

const searchResultPageSize = 100

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
  const [resultLimit, setResultLimit] = React.useState(searchResultPageSize)
  const normalizedQuery = normalizeSearchText(query)
  const deferredQuery = React.useDeferredValue(normalizedQuery)
  const filteredSessions = React.useMemo(
    () =>
      deferredQuery
        ? sessions.filter((session) => normalizeSearchText(session.title).includes(deferredQuery))
        : sessions,
    [deferredQuery, sessions],
  )
  const visibleSessions = filteredSessions.slice(0, resultLimit)
  const hiddenResultCount = filteredSessions.length - visibleSessions.length
  const activeSession = visibleSessions[activeIndex]
  const activeResultId = activeSession ? sessionSearchResultId(activeSession.id) : undefined

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      setResultLimit(searchResultPageSize)
    }
  }, [open])

  React.useEffect(() => {
    setActiveIndex(0)
    setResultLimit(searchResultPageSize)
  }, [normalizedQuery])

  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, visibleSessions.length - 1)))
  }, [visibleSessions.length])

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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("sidebar.search")}
      headerHidden
      initialFocus={() => inputRef.current}
      className="max-w-[520px]"
      contentClassName="p-5"
    >
      <div
        onKeyDown={(event) => {
          if (visibleSessions.length === 0) {
            return
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActiveIndex((index) => (index + 1) % visibleSessions.length)
            return
          }
          if (event.key === "ArrowUp") {
            event.preventDefault()
            setActiveIndex((index) => (index - 1 + visibleSessions.length) % visibleSessions.length)
            return
          }
          if (event.key === "Home") {
            event.preventDefault()
            setActiveIndex(0)
            return
          }
          if (event.key === "End") {
            event.preventDefault()
            setActiveIndex(visibleSessions.length - 1)
            return
          }
          if (event.key === "Enter") {
            event.preventDefault()
            selectSession(visibleSessions[activeIndex])
          }
        }}
      >
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
            {visibleSessions.map((session, index) => (
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
        {hiddenResultCount > 0 ? (
          <button
            type="button"
            className="oo-session-search-result oo-text-label mt-1 flex h-9 min-w-0 items-center rounded-md px-3 text-left"
            onClick={() => setResultLimit((current) => current + searchResultPageSize)}
          >
            {t("sidebar.showMoreSearchResults", {
              count: Math.min(searchResultPageSize, hiddenResultCount),
            })}
          </button>
        ) : null}
      </div>
    </Dialog>
  )
}
