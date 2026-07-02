import type { OrganizationMember } from "../../../electron/organizations/common.ts"
import type { MemberSearchState } from "./organization-management-model.ts"

import * as React from "react"
import { errorMessage, minimumMemberSearchLength, userFallback } from "./organization-management-model.ts"
import { searchUsers } from "@/lib/organizations-client"

interface UseOrganizationMemberSearchOptions {
  addMemberOpen: boolean
  members: OrganizationMember[]
}

export function useOrganizationMemberSearch({ addMemberOpen, members }: UseOrganizationMemberSearchOptions) {
  const [memberInput, setMemberInput] = React.useState("")
  const [selectedSearchUserId, setSelectedSearchUserId] = React.useState<string | null>(null)
  const [memberSearch, setMemberSearch] = React.useState<MemberSearchState>({
    error: null,
    items: [],
    loading: false,
    query: "",
  })
  const memberSearchRequestId = React.useRef(0)

  const resetMemberSearch = React.useCallback((): void => {
    setMemberInput("")
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
    const timer = window.setTimeout(() => {
      void searchUsers(query)
        .then((users) => {
          if (memberSearchRequestId.current !== requestId) {
            return
          }
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
          if (memberSearchRequestId.current === requestId) {
            setMemberSearch({ error: errorMessage(error), items: [], loading: false, query })
          }
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [addMemberOpen, memberInput, members])

  return {
    memberInput,
    memberSearch,
    resetMemberSearch,
    selectedSearchUserId,
    setMemberInput,
    setMemberSearch,
    setSelectedSearchUserId,
  }
}
