import { describe, expect, test } from "vitest"
import { appendStderrTail, subprocessFailureSummary } from "./subprocess-diagnostics.ts"

describe("subprocess diagnostics", () => {
  test("bounds retained stderr by characters", () => {
    expect(appendStderrTail("1234", "5678", 5)).toBe("45678")
  })

  test("prefers an explicit error line over runtime boilerplate", () => {
    expect(
      subprocessFailureSummary(
        "node:internal/modules/cjs/loader:1507\nError: Cannot find module 'runtime'\nNode.js v24.16.0\n",
      ),
    ).toBe("Error: Cannot find module 'runtime'")
  })

  test("recognizes a Node error with a bracketed error code", () => {
    expect(
      subprocessFailureSummary(
        "node:internal/modules/esm/resolve:999\n" +
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'runtime'\n" +
          "Node.js v24.16.0\n",
      ),
    ).toBe("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'runtime'")
  })

  test("falls back to the final non-empty line", () => {
    expect(subprocessFailureSummary("warning\nprocess stopped\n")).toBe("process stopped")
  })
})
