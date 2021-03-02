import * as S from "@effect-ts/core/Effect/Schedule"

export function exponentialCappedMax(
  delay: number,
  factor: number,
  cap: number,
  max: number
) {
  return S.exponential(delay, factor)
    ["||"](S.spaced(cap))
    [">>>"](S.elapsed)
    ["|>"](S.whileOutput((n) => n <= max))
}

export const httpRetryPolicy = exponentialCappedMax(100, 1.5, 1_000, 20_000)

export const everyMiute = S.windowed(60_000)
