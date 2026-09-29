import { afterEach, describe, expect, it, vi } from "vitest"
import { getProviderSpriteResource } from "./connection-provider-sprite.ts"

afterEach(() => vi.unstubAllGlobals())

describe("shared provider sprite loading", () => {
  it.each(["load", "error"] as const)("shares one %s result across subscribers and remounts", (event) => {
    const images = mockImages()
    const url = `https://example.com/${event}.png`
    const first = getProviderSpriteResource(url)
    const second = getProviderSpriteResource(url)
    const notifyFirst = vi.fn()
    const notifySecond = vi.fn()
    const unsubscribe = first.subscribe(notifyFirst)
    const unsubscribeSecond = second.subscribe(notifySecond)
    expect(images).toHaveLength(1)
    expect(images[0]?.src).toBe(url)
    expect(first.getSnapshot()).toBe("loading")
    images[0]![event === "load" ? "onload" : "onerror"]!()
    expect(notifyFirst).toHaveBeenCalledOnce()
    expect(notifySecond).toHaveBeenCalledOnce()
    expect(second.getSnapshot()).toBe(event === "load" ? "loaded" : "failed")
    unsubscribe()
    unsubscribeSecond()
    const unsubscribeRemount = getProviderSpriteResource(url).subscribe(vi.fn())
    expect(images).toHaveLength(1)
    expect(first.getSnapshot()).toBe(event === "load" ? "loaded" : "failed")
    unsubscribeRemount()

    const other = getProviderSpriteResource(`${url}?version=2`)
    const unsubscribeOther = other.subscribe(vi.fn())
    expect(images).toHaveLength(2)
    expect(other.getSnapshot()).toBe("loading")
    unsubscribeOther()
  })
})

function mockImages() {
  const images: FakeImage[] = []
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    src = ""
    referrerPolicy = ""
    constructor() {
      images.push(this)
    }
  }
  vi.stubGlobal("Image", FakeImage)
  return images
}

it("keeps a pending check across unmounts and only notifies current subscribers", () => {
  const images = mockImages()
  const resource = getProviderSpriteResource("https://example.com/pending.png")
  const oldListener = vi.fn()
  const unsubscribe = resource.subscribe(oldListener)
  unsubscribe()
  const currentListener = vi.fn()
  const unsubscribeCurrent = resource.subscribe(currentListener)
  expect(images).toHaveLength(1)
  images[0]!.onerror!()
  expect(oldListener).not.toHaveBeenCalled()
  expect(currentListener).toHaveBeenCalledOnce()
  expect(resource.getSnapshot()).toBe("failed")
  expect(images[0]!.onload).toBeNull()
  expect(images[0]!.onerror).toBeNull()
  unsubscribeCurrent()
})
