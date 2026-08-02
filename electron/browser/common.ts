import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface BrowserViewBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface BrowserNavigationState {
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  title: string
  url: string
}

export interface BrowserPageState {
  crashed: boolean
  navigation: BrowserNavigationState
  sessionId: string
  visible: boolean
  zoomFactor: number
}

export interface BrowserNavigateRequest {
  sessionId: string
  url: string
}

export interface BrowserShowRequest {
  bounds: BrowserViewBounds
  sessionId: string
}

export interface BrowserZoomRequest {
  factor: number
  sessionId: string
}

export interface BrowserDownloadResult {
  filename: string
  state: "completed" | "interrupted"
}

export type BrowserService = typeof BrowserService
export const BrowserService = serviceName("browser-service") as ServiceName<{
  ServerEvents: {
    browserRequested: { sessionId: string }
    downloadFinished: BrowserDownloadResult
    pageRemoved: { sessionId: string }
    stateChanged: BrowserPageState
  }
  ClientInvokes: {
    clearData(): Promise<void>
    capturePreview(sessionId: string): Promise<string | null>
    getState(sessionId: string): Promise<BrowserPageState | null>
    show(request: BrowserShowRequest): Promise<BrowserPageState>
    hide(sessionId: string): Promise<void>
    navigate(request: BrowserNavigateRequest): Promise<BrowserPageState>
    goBack(sessionId: string): Promise<BrowserPageState>
    goForward(sessionId: string): Promise<BrowserPageState>
    reload(sessionId: string): Promise<BrowserPageState>
    setZoomFactor(request: BrowserZoomRequest): Promise<BrowserPageState>
    openDownloadsFolder(): Promise<void>
    openInSystemBrowser(sessionId: string): Promise<void>
  }
}>
