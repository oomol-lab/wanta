import type {
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SessionInfo,
} from "../../../electron/session/common.ts"

import * as React from "react"
import { buildFallbackSessionTitle, shouldAutoRefreshSessionTitle } from "../../../electron/session/title.ts"
import {
  isSessionTitleAutoRefreshable,
  sessionTitleGenerationKey,
  SESSION_TITLE_RETRY_DELAY_MS,
} from "./app-shell-model.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

interface UseSessionTitleGenerationOptions {
  generateTitle: (input: GenerateSessionTitleRequest) => Promise<GenerateSessionTitleResult>
  rename: (sessionId: string, title: string) => Promise<void>
  sessions: SessionInfo[]
}

interface UseSessionTitleGenerationResult {
  clearAutoFallbackTitle: (sessionId: string) => void
  getAutoFallbackTitle: (sessionId: string) => string | undefined
  isAutoRefreshable: (session: SessionInfo, allowPlaceholder: boolean, fallbackTitle?: string) => boolean
  refreshGeneratedTitle: (
    sessionId: string,
    input: { text: string; attachmentNames?: string[] },
    allowPlaceholder: boolean,
    replaceableTitle?: string,
  ) => Promise<void>
  rememberAutoFallbackTitle: (sessionId: string, title: string) => void
}

/** 标题仅在发送消息的路径主动生成；浏览历史会话不能改写标题或影响侧边栏排序。 */
export function useSessionTitleGeneration({
  generateTitle,
  rename,
  sessions,
}: UseSessionTitleGenerationOptions): UseSessionTitleGenerationResult {
  const sessionsRef = React.useRef<SessionInfo[]>([])
  const titleGenerationInFlightBySession = React.useRef<Map<string, string>>(new Map())
  const lastTitleGenerationKeyBySession = React.useRef<Map<string, string>>(new Map())
  const titleGenerationRetryAfterBySession = React.useRef<Map<string, { key: string; retryAfter: number }>>(new Map())
  const autoFallbackTitleBySession = React.useRef<Map<string, string>>(new Map())

  React.useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const isAutoRefreshable = React.useCallback(
    (session: SessionInfo, allowPlaceholder: boolean, fallbackTitle?: string): boolean =>
      isSessionTitleAutoRefreshable(session, allowPlaceholder, autoFallbackTitleBySession.current, fallbackTitle),
    [],
  )

  const getAutoFallbackTitle = React.useCallback((sessionId: string): string | undefined => {
    return autoFallbackTitleBySession.current.get(sessionId)
  }, [])

  const rememberAutoFallbackTitle = React.useCallback((sessionId: string, title: string): void => {
    autoFallbackTitleBySession.current.set(sessionId, title)
  }, [])

  const clearAutoFallbackTitle = React.useCallback((sessionId: string): void => {
    autoFallbackTitleBySession.current.delete(sessionId)
  }, [])

  const refreshGeneratedTitle = React.useCallback(
    async (
      sessionId: string,
      input: { text: string; attachmentNames?: string[] },
      allowPlaceholder: boolean,
      replaceableTitle?: string,
    ) => {
      const generationKey = sessionTitleGenerationKey(input, allowPlaceholder, replaceableTitle)
      if (
        titleGenerationInFlightBySession.current.get(sessionId) === generationKey ||
        lastTitleGenerationKeyBySession.current.get(sessionId) === generationKey
      ) {
        return
      }
      const retryAfter = titleGenerationRetryAfterBySession.current.get(sessionId)
      if (retryAfter?.key === generationKey && Date.now() < retryAfter.retryAfter) {
        return
      }

      const fallbackTitle = buildFallbackSessionTitle(input)
      const current = sessionsRef.current.find((session) => session.id === sessionId)
      if (
        current &&
        current.title !== replaceableTitle &&
        !isAutoRefreshable(current, allowPlaceholder, fallbackTitle)
      ) {
        autoFallbackTitleBySession.current.delete(sessionId)
        titleGenerationRetryAfterBySession.current.delete(sessionId)
        lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
        return
      }

      titleGenerationInFlightBySession.current.set(sessionId, generationKey)
      const applyFallbackTitle = async (title: string): Promise<void> => {
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        if (!latest || !title) {
          return
        }
        const canRefresh = isAutoRefreshable(latest, allowPlaceholder, fallbackTitle)
        if (!canRefresh && title !== latest.title) {
          return
        }
        if (title !== latest.title) {
          await rename(sessionId, title)
        }
        if (canRefresh || title === latest.title) {
          autoFallbackTitleBySession.current.set(sessionId, title)
        }
      }
      try {
        const result = await generateTitle(input)
        const title = result.title
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        const latestTitle = latest?.title ?? replaceableTitle
        if (
          latest &&
          latest.title !== replaceableTitle &&
          !isAutoRefreshable(latest, allowPlaceholder, fallbackTitle)
        ) {
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }

        if (!result.generated) {
          if (latestTitle && shouldAutoRefreshSessionTitle(latestTitle, allowPlaceholder)) {
            await applyFallbackTitle(title || fallbackTitle)
          }
          titleGenerationRetryAfterBySession.current.set(sessionId, {
            key: generationKey,
            retryAfter: Date.now() + SESSION_TITLE_RETRY_DELAY_MS,
          })
          return
        }

        if (title && title !== latestTitle) {
          await rename(sessionId, title)
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }
        if (
          latestTitle &&
          (shouldAutoRefreshSessionTitle(latestTitle, allowPlaceholder) ||
            autoFallbackTitleBySession.current.get(sessionId) === latestTitle ||
            fallbackTitle === latestTitle)
        ) {
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }
        titleGenerationRetryAfterBySession.current.delete(sessionId)
        lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
      } catch (error) {
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        if (latest && shouldAutoRefreshSessionTitle(latest.title, allowPlaceholder)) {
          await applyFallbackTitle(fallbackTitle)
        }
        titleGenerationRetryAfterBySession.current.set(sessionId, {
          key: generationKey,
          retryAfter: Date.now() + SESSION_TITLE_RETRY_DELAY_MS,
        })
        console.error("[wanta] generate session title failed", error)
        reportRendererHandledError("sessionTitle.generate", "Failed to generate session title", error)
      } finally {
        if (titleGenerationInFlightBySession.current.get(sessionId) === generationKey) {
          titleGenerationInFlightBySession.current.delete(sessionId)
        }
      }
    },
    [generateTitle, isAutoRefreshable, rename],
  )

  return {
    clearAutoFallbackTitle,
    getAutoFallbackTitle,
    isAutoRefreshable,
    refreshGeneratedTitle,
    rememberAutoFallbackTitle,
  }
}
