import {
  LiveLoopSemaphore,
  LiveNopeCache,
  LiveTicker,
  program,
  tickers
} from "@app/main"
import * as T from "@effect-ts/core/Effect"
import { pipe } from "@effect-ts/core/Function"
import { runMain } from "@effect-ts/node/Runtime"

pipe(
  tickers,
  T.forEachPar((tickerSymbol) =>
    pipe(
      program,
      T.provideSomeLayer(
        LiveLoopSemaphore["+++"](LiveNopeCache)["+++"](LiveTicker(tickerSymbol))
      )
    )
  ),
  runMain
)
