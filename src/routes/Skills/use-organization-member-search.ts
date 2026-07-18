import type { OrganizationMember } from "../../../electron/organizations/common.ts"
import type { MemberSearchState } from "./organization-management-model.ts"

import * as React from "react"
import { errorMessage, minimumMemberSearchLength, userFallback } from "./organization-management-model.ts"
import { searchUsers } from "@/lib/organizations-client"

interface UseOrganizationMemberSearchOptions {
  addMemberOpen: boolean
  members: OrganizationMember[]
}

const memberSearchCacheMs = 60_000

function preferredSearchUserId(
  items: MemberSearchState["items"],
  query: string,
  currentUserId: string | null,
): string | null {
  if (items.length === 0) {
    return null
  }
  if (currentUserId && items.some((user) => user.userId === currentUserId)) {
    return currentUserId
  }

  const normalizedQuery = query.trim().toLowerCase()
  const exactMatch = normalizedQuery
    ? items.find((user) => {
        return (
          user.userId.toLowerCase() === normalizedQuery ||
          user.username.toLowerCase() === normalizedQuery ||
          user.displayName.toLowerCase() === normalizedQuery
        )
      })
    : undefined

  return exactMatch?.userId ?? items[0]?.userId ?? null
}

export function useOrganizationMemberSearch({ addMemberOpen, members }: UseOrganizationMemberSearchOptions) {
  const [memberInput, setMemberInput] = React.useState("")
  const [activeSearchUserId, setActiveSearchUserId] = React.useState<string | null>(null)
  const [selectedSearchUserId, setSelectedSearchUserId] = React.useState<string | null>(null)
  const [memberSearch, setMemberSearch] = React.useState<MemberSearchState>({
    error: null,
    items: [],
    loading: false,
    query: "",
  })
  const memberSearchRequestId = React.useRef(0)
  const searchCache = React.useRef(
    new Map<string, { loadedAt: number; users: Awaited<ReturnType<typeof searchUsers>> }>(),
  )

  const resetMemberSearch = React.useCallback((): void => {
    setMemberInput("")
    setActiveSearchUserId(null)
    setSelectedSearchUserId(null)
    setMemberSearch({ error: null, items: [], loading: false, query: "" })
  }, [])

  React.useEffect(() => {
    const query = memberInput.trim()
    const requestId = memberSearchRequestId.current + 1
    memberSearchRequestId.current = requestId

    if (!addMemberOpen || query.length < minimumMemberSearchLength) {
      setMemberSearch({ error: null, items: [], loading: false, query })
      return
    }

    setMemberSearch({ error: null, items: [], loading: true, query })
    const normalizedQuery = query.toLowerCase()
    const cached = searchCache.current.get(normalizedQuery)
    if (cached && Date.now() - cached.loadedAt < memberSearchCacheMs) {
      const existingMemberIds = new Set(members.map((member) => member.user_id))
      setMemberSearch({
        error: null,
        items: cached.users
          .filter((user) => !existingMemberIds.has(user.user_id))
          .map((user) => {
            const displayName = user.nickname || user.username
            return { ...user, displayName, fallback: userFallback(displayName), userId: user.user_id }
          }),
        loading: false,
        query,
      })
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void searchUsers(query, { signal: controller.signal })
        .then((users) => {
          if (memberSearchRequestId.current !== requestId) {
            return
          }
          searchCache.current.set(normalizedQuery, { loadedAt: Date.now(), users })
          const existingMemberIds = new Set(members.map((member) => member.user_id))
          setMemberSearch({
            error: null,
            items: users
              .filter((user) => !existingMemberIds.has(user.user_id))
              .map((user) => {
                const displayName = user.nickname || user.username
                return { ...user, displayName, fallback: userFallback(displayName), userId: user.user_id }
              }),
            loading: false,
            query,
          })
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return
          }
          if (memberSearchRequestId.current === requestId) {
            setMemberSearch({ error: errorMessage(error), items: [], loading: false, query })
          }
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [addMemberOpen, memberInput, members])

  React.useEffect(() => {
    if (!addMemberOpen) {
      setActiveSearchUserId(null)
      setSelectedSearchUserId(null)
      return
    }

    if (memberSearch.query !== memberInput.trim()) {
      setActiveSearchUserId(null)
      setSelectedSearchUserId(null)
      return
    }

    const currentUserId = selectedSearchUserId ?? activeSearchUserId
    const nextUserId = preferredSearchUserId(memberSearch.items, memberInput, currentUserId)
    setActiveSearchUserId(nextUserId)
    setSelectedSearchUserId(nextUserId)
  }, [activeSearchUserId, addMemberOpen, memberInput, memberSearch.items, selectedSearchUserId])

  const moveActiveSearchUser = React.useCallback(
    (step: -1 | 1 | "first" | "last"): void => {
      if (memberSearch.items.length === 0) {
        setActiveSearchUserId(null)
        setSelectedSearchUserId(null)
        return
      }

      const currentUserId = selectedSearchUserId ?? activeSearchUserId
      let nextUserId: string | null

      if (step === "first") {
        nextUserId = memberSearch.items[0]?.userId ?? null
      } else if (step === "last") {
        nextUserId = memberSearch.items.at(-1)?.userId ?? null
      } else {
        const currentIndex = currentUserId ? memberSearch.items.findIndex((user) => user.userId === currentUserId) : -1
        const fallbackIndex = step > 0 ? -1 : 0
        const nextIndex = currentIndex === -1 ? fallbackIndex + step : currentIndex + step
        const clampedIndex = Math.max(0, Math.min(memberSearch.items.length - 1, nextIndex))
        nextUserId = memberSearch.items[clampedIndex]?.userId ?? null
      }

      setActiveSearchUserId(nextUserId)
      setSelectedSearchUserId(nextUserId)
    },
    [activeSearchUserId, memberSearch.items, selectedSearchUserId],
  )

  return {
    activeSearchUserId,
    memberInput,
    memberSearch,
    moveActiveSearchUser,
    resetMemberSearch,
    selectedSearchUserId,
    setActiveSearchUserId,
    setMemberInput,
    setSelectedSearchUserId,
  }
}
