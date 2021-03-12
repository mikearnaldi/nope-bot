import * as A from "@effect-ts/core/Array"
import * as T from "@effect-ts/core/Effect"
import * as L from "@effect-ts/core/Effect/Layer"
import * as Ref from "@effect-ts/core/Effect/Ref"
import * as Semaphore from "@effect-ts/core/Effect/Semaphore"
import * as O from "@effect-ts/core/Option"
import * as Ord from "@effect-ts/core/Ord"
import * as MO from "@effect-ts/morphic"
import * as D from "@effect-ts/morphic/Decoder"
import * as Show from "@effect-ts/morphic/Show"
import { runMain } from "@effect-ts/node/Runtime"
import { currentTime } from "@effect-ts/system/Clock"
import { literal, pipe } from "@effect-ts/system/Function"
import { tag } from "@effect-ts/system/Has"
import type { _A } from "@effect-ts/system/Utils"
import moment from "moment"

import { everyMiute, httpRetryPolicy } from "./policies"

export class HttpRequestError {
  readonly _tag = "HttpRequestError"
  constructor(readonly error: unknown) {}
}

export function get(url: string) {
  return T.fromPromiseWith_(
    () => fetch(url),
    (e) => new HttpRequestError(e)
  )
}

export class JsonDecodingError {
  readonly _tag = "JsonDecodingError"
  constructor(readonly error: unknown) {}
}

export function json(self: Response) {
  return T.fromPromiseWith_(
    () => self.json(),
    (e) => new JsonDecodingError(e)
  )
}

export const getDate = pipe(
  T.do,
  T.bind("date", () => T.effectTotal(() => new Date())),
  T.map(({ date }) => moment(date).format("MM-DD-YYYY"))
)

export const getTime = pipe(
  T.do,
  T.bind("date", () => T.effectTotal(() => new Date())),
  T.map(({ date }) => date.getTime())
)

export type TickerSymbol =
  | "AAPL"
  | "ARKK"
  | "BALY"
  | "BB"
  | "CCJ"
  | "CF"
  | "CKH"
  | "CLOV"
  | "EEM"
  | "GME"
  | "GRWG"
  | "IWM"
  | "KO"
  | "MGNI"
  | "NOK"
  | "OTTR"
  | "PINS"
  | "PLTR"
  | "QQQ"
  | "SCHW"
  | "SPY"
  | "SSPK"
  | "TLRY"
  | "TSLA"
  | "TWTR"
  | "V"
  | "VIAC"
  | "VXRT"
  | "WBA"

export interface Ticker {
  readonly _tag: "Ticker"
  readonly tickerSymbol: TickerSymbol
}

export const Ticker = tag<Ticker>()

export function makeLiveTicker(tickerSymbol: TickerSymbol) {
  return T.effectTotal((): Ticker => ({ _tag: "Ticker", tickerSymbol }))
}

export function LiveTicker(tickerSymbol: TickerSymbol) {
  return L.fromEffect(Ticker)(makeLiveTicker(tickerSymbol)).setKey(Ticker.key)
}

export const { tickerSymbol } = T.deriveLifted(Ticker)([], [], ["tickerSymbol"])

export const getNopeUrl = pipe(
  T.do,
  T.bind("date", () => getDate),
  T.bind("time", () => getTime),
  T.bind("ticker", () => tickerSymbol),
  T.map(
    ({ date, ticker, time }) =>
      `https://nopechart.com/cache/${ticker}_${date}.json?_=${time}`
  )
)

const NopeResponseEntry_ = MO.make((F) =>
  F.interface(
    {
      timestamp: F.number(),
      nope: F.number(),
      price: F.number()
    },
    {
      name: "NopeResponseEntry",
      conf: {
        ShowURI: (_) => ({
          show: ({ nope, price, timestamp }) =>
            `(${nope}) (${price}$) (${moment.utc(timestamp).toISOString()})`
        })
      }
    }
  )
)

export interface NopeResponseEntry extends MO.AType<typeof NopeResponseEntry_> {}
export interface NopeResponseEntryE extends MO.EType<typeof NopeResponseEntry_> {}
export const NopeResponseEntry = MO.opaque<NopeResponseEntryE, NopeResponseEntry>()(
  NopeResponseEntry_
)

export const NopeResponse = MO.make((F) => F.array(NopeResponseEntry(F)))
export type NopeResponse = MO.AType<typeof NopeResponse>

export class NopeTooOld {
  readonly _tag = "NopeTooOld"
  constructor(readonly nope: NopeResponseEntry, readonly now: number) {}
}

export const getNope = pipe(
  getNopeUrl,
  T.chain(get),
  T.chain(json),
  T.chain((resp) => pipe(resp, D.decode(NopeResponse), D.report)["|>"](T.orDie))
)

export const NopeResponseEntryOrd = Ord.inverted(
  Ord.contramap((_: NopeResponseEntry) => _.timestamp)(Ord.number)
)

export class NopeNotAvailable {
  readonly _tag = "NopeNotAvailable"
}

export function getLastNopeRespose(nopeResponse: NopeResponse) {
  return pipe(
    A.sort(NopeResponseEntryOrd)(nopeResponse),
    A.head,
    T.getOrFail,
    T.catchAll(() => T.fail(new NopeNotAvailable())),
    T.tap((nope) =>
      currentTime["|>"](
        T.chain((now) =>
          T.when_(
            T.suspend(() => T.fail(new NopeTooOld(nope, now))),
            () => now - nope.timestamp > 120_000
          )
        )
      )
    )
  )
}

export function getDelay(roundTo: number, delay: number) {
  return T.effectTotal(() => {
    const date = new Date()

    const calc = Math.round(
      new Date(
        Math.round((date.getTime() + roundTo) / roundTo) * roundTo + delay
      ).getTime() - date.getTime()
    )

    return calc > 60_000 ? calc - 60_000 : calc
  })
}

export function log(message: string) {
  return pipe(
    T.do,
    T.bind("now", () => T.effectTotal(() => moment.utc(new Date()))),
    T.bind("ticker", () => tickerSymbol),
    T.chain(({ now, ticker }) =>
      T.effectTotal(() => {
        console.log(`[${ticker} @ ${now.toISOString()}]: ${message}`)
      })
    )
  )
}

export const initialDelay = pipe(
  getDelay(60_000, 10_000),
  T.chain((delay) =>
    pipe(
      log(
        `Sleep for ${Math.round(delay / 1_000)} secods until ${moment(new Date())
          .add(delay)
          .toISOString()}`
      ),
      T.andThen(T.sleep(delay))
    )
  )
)

export const makeNopeCache = T.gen(function* (_) {
  const cache = yield* _(Ref.makeRef(O.emptyOf<NopeResponseEntry>()))

  return {
    _tag: literal("NopeCache"),
    compareAndSet: (nope: NopeResponseEntry) =>
      pipe(
        cache.get,
        T.chain(
          T.matchTag({
            None: () =>
              cache.set(O.some(nope))["|>"](T.andThen(T.succeed(O.some(nope)))),
            Some: ({ value: { timestamp } }) =>
              nope.timestamp <= timestamp
                ? T.succeed(O.none)
                : cache.set(O.some(nope))["|>"](T.andThen(T.succeed(O.some(nope))))
          })
        )
      )
  }
})

export interface NopeCache extends _A<typeof makeNopeCache> {}
export const NopeCache = tag<NopeCache>()
export const LiveNopeCache = L.fromEffect(NopeCache)(makeNopeCache)

export const { compareAndSet } = T.deriveLifted(NopeCache)(["compareAndSet"], [], [])

export const inMarketHours = pipe(
  T.do,
  T.bind("now", () => currentTime),
  T.let("date", ({ now }) => moment.utc(now)),
  T.let("inMarket", ({ date }) => {
    const h = date.hour()
    const m = date.minute()
    return h < 21 && (h > 14 || (h === 14 && m >= 30))
  }),
  T.tap(({ inMarket }) => T.when(() => !inMarket)(log(`Not in market hours`))),
  T.map(({ inMarket }) => inMarket)
)

export class NopeDupe {
  readonly _tag = "NopeDupe"
  constructor(readonly nope: NopeResponseEntry) {}
}

export const makeLoopSemaphore = T.gen(function* (_) {
  const semaphore = yield* _(Semaphore.makeSemaphore(1))

  return {
    _tag: literal("LoopSemaphore"),
    withPermit: Semaphore.withPermit(semaphore)
  }
})

export interface LoopSemaphore extends _A<typeof makeLoopSemaphore> {}
export const LoopSemaphore = tag<LoopSemaphore>()
export const LiveLoopSemaphore = L.fromEffect(LoopSemaphore)(makeLoopSemaphore)

export const loop = T.accessServiceM(LoopSemaphore)(({ withPermit }) =>
  withPermit(
    pipe(
      T.do,
      T.bind("nope", () =>
        getNope["|>"](T.chain(getLastNopeRespose))["|>"](T.retry(httpRetryPolicy))
      ),
      T.tap(({ nope }) =>
        compareAndSet(nope)
          ["|>"](T.chain(T.getOrFail))
          ["|>"](T.mapError(() => new NopeDupe(nope)))
      ),
      T.tap(({ nope }) =>
        log(`Nope available ${Show.show(NopeResponseEntry).show(nope)}`)
      ),
      T.catchTag("NopeNotAvailable", () => log(`No data available`)),
      T.catchTag("NopeDupe", () => log(`Nope duplicated`)),
      T.catchTag("NopeTooOld", () => log(`Nope too old`)),
      T.whenM(inMarketHours)
    )
  )
)

export const program = pipe(
  initialDelay,
  T.andThen(log(`Start`)),
  T.andThen(loop["|>"](T.repeat(everyMiute)))
)

export const tickers: TickerSymbol[] = ["SPY", "QQQ", "TSLA"]

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
