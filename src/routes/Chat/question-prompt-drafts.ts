import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { QuestionDraftStore, QuestionField, QuestionFieldDraft } from "./question-fields.ts"

import * as React from "react"
import { initialFieldDrafts, isQuestionDraftSnapshotPristine } from "./question-fields.ts"

interface UseQuestionPromptDraftsInput {
  fields: QuestionField[]
  questionDrafts: QuestionDraftStore
  request: ChatQuestionRequest
}

interface UseQuestionPromptDrafts {
  activeFieldIndex: number
  drafts: QuestionFieldDraft[]
  removeDraft: () => void
  selectActiveFieldIndex: (nextIndex: number) => void
  updateDraft: (index: number, updater: (draft: QuestionFieldDraft) => QuestionFieldDraft) => void
}

export function useQuestionPromptDrafts({
  fields,
  questionDrafts,
  request,
}: UseQuestionPromptDraftsInput): UseQuestionPromptDrafts {
  const initialDrafts = React.useMemo(() => initialFieldDrafts(fields), [fields])
  const initialDraftSnapshot = React.useMemo(
    () => questionDrafts.read(request.sessionId, request, fields.length),
    [fields.length, questionDrafts, request],
  )
  const [drafts, setDrafts] = React.useState<QuestionFieldDraft[]>(() => initialDraftSnapshot?.drafts ?? initialDrafts)
  const [activeFieldIndex, setActiveFieldIndex] = React.useState(initialDraftSnapshot?.activeFieldIndex ?? 0)
  const draftsRef = React.useRef(drafts)
  const activeFieldIndexRef = React.useRef(activeFieldIndex)
  const draftPersistedRef = React.useRef(Boolean(initialDraftSnapshot))

  React.useEffect(() => {
    const stored = questionDrafts.read(request.sessionId, request, fields.length)
    const nextDrafts = stored?.drafts ?? initialDrafts
    const nextActiveFieldIndex = stored?.activeFieldIndex ?? 0
    draftsRef.current = nextDrafts
    activeFieldIndexRef.current = nextActiveFieldIndex
    draftPersistedRef.current = Boolean(stored)
    setDrafts(nextDrafts)
    setActiveFieldIndex(nextActiveFieldIndex)
  }, [fields.length, initialDrafts, questionDrafts, request])

  React.useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  React.useEffect(() => {
    activeFieldIndexRef.current = activeFieldIndex
  }, [activeFieldIndex])

  const removeDraft = React.useCallback(() => {
    questionDrafts.remove(request.sessionId, request)
    draftPersistedRef.current = false
  }, [questionDrafts, request])

  const persistDrafts = React.useCallback(
    (nextActiveFieldIndex: number, nextDrafts: QuestionFieldDraft[]) => {
      const snapshot = {
        activeFieldIndex: nextActiveFieldIndex,
        drafts: nextDrafts,
      }
      if (isQuestionDraftSnapshotPristine(snapshot, initialDrafts)) {
        if (draftPersistedRef.current) {
          removeDraft()
        }
        return
      }
      questionDrafts.write(request.sessionId, request, snapshot)
      draftPersistedRef.current = true
    },
    [initialDrafts, questionDrafts, removeDraft, request],
  )

  React.useEffect(() => {
    if (activeFieldIndex >= fields.length) {
      activeFieldIndexRef.current = 0
      setActiveFieldIndex(0)
      persistDrafts(0, draftsRef.current)
    }
  }, [activeFieldIndex, fields.length, persistDrafts])

  const updateDraft = React.useCallback(
    (index: number, updater: (draft: QuestionFieldDraft) => QuestionFieldDraft) => {
      const next = draftsRef.current.map((draft, draftIndex) => (draftIndex === index ? updater(draft) : draft))
      draftsRef.current = next
      setDrafts(next)
      persistDrafts(activeFieldIndexRef.current, next)
    },
    [persistDrafts],
  )

  const selectActiveFieldIndex = React.useCallback(
    (nextIndex: number) => {
      const normalizedIndex = Math.min(Math.max(nextIndex, 0), Math.max(0, fields.length - 1))
      activeFieldIndexRef.current = normalizedIndex
      persistDrafts(normalizedIndex, draftsRef.current)
      setActiveFieldIndex(normalizedIndex)
    },
    [fields.length, persistDrafts],
  )

  return {
    activeFieldIndex,
    drafts,
    removeDraft,
    selectActiveFieldIndex,
    updateDraft,
  }
}
