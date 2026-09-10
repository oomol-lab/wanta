import { expect, it } from "vitest"
import { formatNumber, formatPlural, formatRelativeTime } from "./format.ts"

it("selects Russian singular, few and many count forms", () => {
  const forms = { one: "{count} задача", few: "{count} задачи", many: "{count} задач", other: "{count} задачи" }
  expect(formatPlural("ru", 1, forms)).toBe("1 задача")
  expect(formatPlural("ru", 2, forms)).toBe("2 задачи")
  expect(formatPlural("ru", 5, forms)).toBe("5 задач")
  expect(formatPlural("ru", 21, forms)).toBe("21 задача")
})
it("formats numbers and relative time with the requested locale", () => {
  expect(formatNumber(1234.5, "fr")).toBe(new Intl.NumberFormat("fr").format(1234.5))
  expect(formatRelativeTime("ja", -5, "minute")).toBe("5分前")
})
