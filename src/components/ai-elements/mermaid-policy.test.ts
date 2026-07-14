import { describe, expect, it } from "vitest"
import {
  isRetryableMermaidError,
  mermaidParseErrorLine,
  normalizeMermaidMarkdown,
  normalizeMermaidSource,
  validateMermaidSource,
} from "./mermaid-policy.ts"

const fireMountainDiagram = `flowchart TD
    TS[唐僧] -->|师父| WK[孙悟空]
    WK -->|称"嫂嫂"→仇敌| LS[罗刹女<br>铁扇公主]
    WK -.->|曾收服| HH[红孩儿<br>善财童子]
    NM -->|夫妻| LS
    style TS fill:#f9d,stroke:#333
    style WK fill:#f96,stroke:#333
    linkStyle default stroke-width:1.5`

describe("validateMermaidSource", () => {
  it("accepts focused relationship diagrams", () => {
    expect(() =>
      validateMermaidSource(
        ["flowchart LR", '  WK["孙悟空"] -->|"保护"| TC["唐僧"]', '  WK -.->|"因此结怨"| TSGZ["铁扇公主"]'].join("\n"),
      ),
    ).not.toThrow()
  })

  it("rejects source-level configuration overrides", () => {
    expect(() => validateMermaidSource('%%{init: {"theme": "dark"}}%%\nflowchart LR\nA --> B')).toThrow(
      "configuration directives",
    )
  })

  it("rejects click actions even under strict Mermaid security", () => {
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nclick A "https://example.com"')).toThrow("click actions")
  })

  it("rejects diagrams large enough to degrade the chat renderer", () => {
    expect(() => validateMermaidSource(`flowchart LR\n${"A --> B\n".repeat(4_000)}`)).toThrow("rendering limit")
  })
})

describe("normalizeMermaidSource", () => {
  it("repairs raw ASCII quotes in visible labels and removes model-owned presentation", () => {
    const normalized = normalizeMermaidSource(fireMountainDiagram)

    expect(normalized).toContain("WK -->|称“嫂嫂”→仇敌| LS[罗刹女<br>铁扇公主]")
    expect(normalized).not.toMatch(/^\s*(?:style|linkStyle)\b/mu)
  })

  it("preserves Mermaid syntax delimiters around quoted node and edge labels", () => {
    expect(normalizeMermaidSource('flowchart LR\nA["孙悟空"] -->|"保护"| B["唐僧"]')).toBe(
      'flowchart LR\nA["孙悟空"] -->|"保护"| B["唐僧"]',
    )
  })
})

describe("normalizeMermaidMarkdown", () => {
  it("normalizes only closed Mermaid fences", () => {
    const markdown = `正文

\`\`\`mermaid
${fireMountainDiagram}
\`\`\`

\`\`\`text
称"嫂嫂"
\`\`\``
    const normalized = normalizeMermaidMarkdown(markdown)

    expect(normalized).toContain("称“嫂嫂”→仇敌")
    expect(normalized).toContain('```text\n称"嫂嫂"\n```')
    expect(normalizeMermaidMarkdown('```mermaid\nA -->|称"嫂嫂"| B')).toBe('```mermaid\nA -->|称"嫂嫂"| B')
  })
})

describe("Mermaid error classification", () => {
  it("extracts parser lines and retries only transient loading failures", () => {
    expect(mermaidParseErrorLine("Parse error on line 11: unexpected token")).toBe(11)
    expect(mermaidParseErrorLine("Mermaid source exceeds Wanta's rendering limit")).toBeNull()
    expect(isRetryableMermaidError("Failed to fetch dynamically imported module")).toBe(true)
    expect(isRetryableMermaidError("Parse error on line 11")).toBe(false)
  })
})
