import * as React from "react"
import { reportRendererIssue } from "@/lib/renderer-diagnostics"

interface ErrorBoundaryProps {
  fallback: React.ReactNode
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

// 轻量错误边界：捕获子树渲染期错误（典型如 lazy() 动态 chunk 加载失败），渲染 fallback 而非让整页崩溃成空白。
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error("[wanta] render error caught by boundary:", error)
    reportRendererIssue("error", "react", "render error caught by boundary", error)
  }

  render(): React.ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
