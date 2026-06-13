import * as React from "react"

function scrollElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target
  }
  if (target === document) {
    const scrollingElement = document.scrollingElement
    return scrollingElement instanceof HTMLElement ? scrollingElement : null
  }
  return null
}

function hasScrollableOverflow(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1
}

/** 全局统一滚动条显示节奏：滚动时出现，停止后淡出。 */
export function useGlobalScrollbars(): void {
  React.useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>()

    const markScrolling = (element: HTMLElement): void => {
      if (!hasScrollableOverflow(element)) {
        return
      }
      element.classList.add("is-scrolling")
      const previous = timers.get(element)
      if (previous) {
        clearTimeout(previous)
      }
      timers.set(
        element,
        setTimeout(() => {
          element.classList.remove("is-scrolling")
          timers.delete(element)
        }, 850),
      )
    }

    const handleScroll = (event: Event): void => {
      const element = scrollElementFromTarget(event.target)
      if (element) {
        markScrolling(element)
      }
    }

    document.addEventListener("scroll", handleScroll, true)

    return () => {
      document.removeEventListener("scroll", handleScroll, true)
      for (const [element, timer] of timers) {
        clearTimeout(timer)
        element.classList.remove("is-scrolling")
      }
      timers.clear()
    }
  }, [])
}
