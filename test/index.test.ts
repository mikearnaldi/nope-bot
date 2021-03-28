import { compareAndSet, LiveNopeCache } from "@app/main"
import * as T from "@effect-ts/core/Effect"
import { testRuntime } from "@effect-ts/jest/Runtime"

describe("Cache", () => {
  const { it } = testRuntime(LiveNopeCache)

  it("should skip older", () =>
    T.gen(function* (_) {
      const a = yield* _(compareAndSet({ nope: 0, price: 0, timestamp: 1 }))
      const b = yield* _(compareAndSet({ nope: 1, price: 1, timestamp: 0 }))

      expect(a._tag).toEqual("Some")
      expect(b._tag).toEqual("None")
    }))
})
