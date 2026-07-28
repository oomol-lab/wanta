const edgeTolerancePx = 2

export interface ProcessActivityScrollState {
  atBottom: boolean
  atTop: boolean
  hasOverflow: boolean
  remaining: number
}

export function processActivityScrollState(input: {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}): ProcessActivityScrollState {
  const remaining = Math.max(0, input.scrollHeight - input.scrollTop - input.clientHeight)
  return {
    atBottom: remaining <= edgeTolerancePx,
    atTop: input.scrollTop <= edgeTolerancePx,
    hasOverflow: input.scrollHeight > input.clientHeight + edgeTolerancePx,
    remaining,
  }
}
