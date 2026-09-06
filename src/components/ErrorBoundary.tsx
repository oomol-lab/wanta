import * as React from "react"
import { reportRendererIssue } from "@/lib/renderer-diagnostics"

interface ErrorBoundaryProps {
  resetKey?: unknown
  fallback: React.ReactNode
  children: React.ReactNode
}

interface ErrorBoundaryState {
  resetKey?: unknown
  hasError: boolean
}

// 轻量错误边界：捕获子树渲染期错误（典型如 lazy() 动态 chunk 加载失败），渲染 fallback 而非让整页崩溃成空白。
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error("[wanta] render error caught by boundary:", error)
    reportRendererIssue("error", "react", "render error caught by boundary", error)
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { hasError: false, resetKey: props.resetKey }
  }

  render(): React.ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
