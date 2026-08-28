import { describe, expect, test } from "vitest"
import { parseManagedOoCliInvocation } from "./managed-oo-cli.ts"

describe("parseManagedOoCliInvocation", () => {
  test("extracts safe file metadata without returning a signed URL", () => {
    expect(parseManagedOoCliInvocation('oo file upload "/tmp/report.pdf" --json')).toEqual({
      domain: "file",
      operation: "upload",
      detail: "report.pdf",
    })
    const command = '$WANTA_OO_BIN file download "https://signed.example.test/a?token=secret" ./out --name "report"'
    const parsed = parseManagedOoCliInvocation(command)
    expect(parsed).toEqual({ domain: "file", operation: "download", detail: "report" })
    expect(JSON.stringify(parsed)).not.toContain("secret")
  })

  test("classifies Flow command families and rejects incidental text", () => {
    expect(parseManagedOoCliInvocation("oo flow project current --json")).toEqual({
      domain: "flow",
      operation: "project.current",
    })
    expect(parseManagedOoCliInvocation("oo --lang zh flow publish demo --project project-a --json")).toEqual({
      domain: "flow",
      operation: "publish",
    })
    expect(parseManagedOoCliInvocation("echo oo flow publish demo")).toBeNull()
  })
})
