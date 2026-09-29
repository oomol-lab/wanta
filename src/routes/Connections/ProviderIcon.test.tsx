// @vitest-environment happy-dom

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { ProviderIcon } from "./ProviderIcon.tsx"
import { ThemeContext } from "@/components/theme-context"

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

test("shares sprite loading, crops every size, switches theme, and falls back on failure", async () => {
  const images: FakeImage[] = []
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    src = ""
    constructor() {
      images.push(this)
    }
  }
  vi.stubGlobal("Image", FakeImage)
  const sprite = {
    version: "icon-test",
    pixelRatio: 2,
    iconSize: 64,
    bleed: 2,
    width: 256,
    height: 128,
    lightUrl: "https://example.com/icons-test-light.png",
    darkUrl: "https://example.com/icons-test-dark.png",
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const render = (theme: "light" | "dark") =>
    root.render(
      <ThemeContext.Provider value={{ effectiveTheme: theme, preference: theme, setPreference: () => {} }}>
        {(["default", "compact", "lg", "showcase"] as const).map((size) => (
          <ProviderIcon
            key={size}
            size={size}
            displayName="GitHub"
            iconUrl="https://example.com/fallback.png"
            iconSprite={sprite}
            iconSpritePosition={{ x: 64, y: 0 }}
          />
        ))}
      </ThemeContext.Provider>,
    )
  await act(async () => render("light"))
  expect(images).toHaveLength(1)
  expect(host.querySelectorAll("img")).toHaveLength(0)
  expect(host.textContent).toBe("GGGG")
  await act(async () => images[0]!.onload!())
  expect(host.querySelectorAll("img")).toHaveLength(4)
  const image = host.querySelector("img")!
  expect(image.src).toBe(sprite.lightUrl)
  expect(image.style.width).toBe("400%")
  expect(image.style.height).toBe("200%")
  expect(image.style.left).toBe("-100%")
  await act(async () => render("dark"))
  expect(images).toHaveLength(2)
  expect(images[1]!.src).toBe(sprite.darkUrl)
  expect(host.querySelectorAll("img")).toHaveLength(0)
  expect(host.textContent).toBe("GGGG")
  await act(async () => images[1]!.onerror!())
  expect(host.querySelector("img")!.src).toBe("https://example.com/fallback.png")
  await act(async () => host.querySelectorAll("img").forEach((img) => img.dispatchEvent(new Event("error"))))
  expect(host.querySelectorAll("img")).toHaveLength(0)
  expect(host.textContent).toBe("GGGG")
  act(() => root.unmount())
})

test("a missing sprite position keeps the individual icon", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ProviderIcon
        displayName="Local CLI"
        iconUrl="https://example.com/local.png"
        iconSprite={{
          version: "missing",
          pixelRatio: 1,
          iconSize: 32,
          bleed: 0,
          width: 32,
          height: 32,
          lightUrl: "https://example.com/missing-light.png",
          darkUrl: "https://example.com/missing-dark.png",
        }}
      />,
    ),
  )
  expect(host.querySelector("img")!.src).toBe("https://example.com/local.png")
  act(() => root.unmount())
})
