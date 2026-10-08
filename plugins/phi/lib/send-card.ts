import {
  cacheKey,
  cardEtag,
  readCachedHeight,
  readCachedPng,
  writeCachedHeight,
  writeCachedPng,
} from "../../../src/cache.ts"
import { cardCacheInput, cardCacheParts, getCardEpoch, RENDER_VERSION } from "../../../src/card-image-cache.ts"
import { type CardKind, cardCacheKind, clampCount, parseSongLevel, type SongLevel } from "../../../src/card-kinds.ts"
import { prefetchIlls } from "../../../src/ill.ts"
import type { KvStore } from "../../../src/kv.ts"
import { logger } from "../../../src/logger.ts"
import { r2WriteReady } from "../../../src/r2.ts"
import { type PaintQuality, parsePaintQuality } from "../../../src/render/paint-budget.ts"
import { withTimeout } from "../../../src/render-lock.ts"
import type { Context, RenderedImage } from "../../../src/sdk/index.ts"
import { type PhiLocale, resolvePhiLocale } from "./card-i18n.ts"
import {
  CARD_STYLES,
  type CardStyle,
  cardStyleTemplate,
  isStyledKind,
  parseCardStyle,
  type StyledKind,
} from "./card-styles.ts"
import { b19Card, infoCard } from "./cards.ts"
import { knownBackground } from "./catalog.ts"
import { buildUpdateCard, loadHisb30Snaps, loadSaveHistory, updateCardImages } from "./history.ts"
import { getNotes, type UserNotes } from "./notes.ts"
import type { PhiRuntime } from "./runtime.ts"
import type { Save } from "./save.ts"
import { getToken, saveIdentity } from "./saves.ts"
import { buildSongCard } from "./song-card.ts"
import { needSave, phiCatalog } from "./util.ts"

/** Same budgets as the WebUI card route (src/server/cards.ts) */
const DATA_TIMEOUT_MS = 75_000
const RENDER_TIMEOUT_MS = 45_000
/** "Wait for every badge" (notes.peerWait): peer badges may take until this long after the command began */
const PEER_WAIT_MS = 60_000

/** Same names as the WebUI's layout picker */
export const STYLE_NAMES: Record<CardStyle, string> = {
  classic: "Classic",
  table: "Table",
  portrait: "Phone",
  timeline: "Timeline",
  summary: "Summary",
}

/** Slash-command choices for a kind's layouts, plus any bot-only ones */
export function styleChoices(kind: StyledKind, extra: { name: string; value: string }[] = []) {
  return [...CARD_STYLES[kind].map(s => ({ name: STYLE_NAMES[s], value: s as string })), ...extra]
}

export const STYLE_OPTION_DESC = "Layout for this card (default: your saved one, see /phi layout)"

export type SendCardOpts = {
  /** Layout for this card only; otherwise the user's saved layout (shared with the WebUI) */
  style?: string
  count?: number
  /** Per-song card: catalog chart id and level */
  chart?: string
  level?: string
  /** Text sent with the image; `data` is the card data, absent on a cache hit */
  caption?: string | ((data?: Record<string, unknown>) => string | undefined)
  /** Attachment name without the extension (default: the kind) */
  filename?: string
  /** A save the caller already refreshed (`/phi account update`) */
  got?: { rt: PhiRuntime; save: Save }
  notes?: UserNotes
}

type Prep = {
  ctx: Context
  rt: PhiRuntime
  save: Save
  kind: CardKind
  notes: UserNotes
  locale: PhiLocale
  nnum: number
  paintQuality: PaintQuality
  tagOn: boolean
  statsOn: boolean
  style: CardStyle
  song?: { chart: string; level: SongLevel }
  key: string
  heightId: string
  started: number
}

type Built = {
  templateId: string
  /** The kind's original layout, used if the chosen one fails to render */
  classicTemplateId: string
  data: Record<string, unknown>
}

type Painted = {
  bytes: Buffer
  ext: string
  /** Built with missing phib19.top data or with the classic layout after the chosen one failed: never cached */
  partial?: boolean
  fellBack?: boolean
  data?: Record<string, unknown>
}

const NOTES = {
  en: {
    partial: "Some phib19.top data was too slow and is missing from this card. Run the command again in a bit to fill it in.",
    fellBack: "Couldn't draw this layout, so the classic one is shown.",
    noChart: "No chart found for that song.",
    failed: "Couldn't draw this card. Try again in a moment.",
  },
  zh: {
    partial: "部分 phib19.top 数据响应过慢，未显示在此图中。稍后再次使用该命令即可补全。",
    fellBack: "该版式绘制失败，已改用经典版式。",
    noChart: "没有找到这首歌的谱面。",
    failed: "成绩图绘制失败，请稍后再试。",
  },
} satisfies Record<PhiLocale, unknown>

/**
 * Sends a WebUI card kind through the finished-card cache the WebUI shares (memory → R2 → KV,
 * same key inputs as src/server/cards.ts): a card either side already painted for this save and
 * these settings is sent as-is; otherwise it is painted once, with the height from last time
 */
export async function sendCard(ctx: Context, kind: CardKind, opts: SendCardOpts = {}) {
  const started = performance.now()
  const [got, loaded] = await Promise.all([opts.got ?? needSave(ctx), opts.notes ?? getNotes(ctx.db, ctx.userId)])
  if (!got) return
  const notes = { ...loaded, cardBackground: knownBackground(loaded.cardBackground) || undefined }
  const locale = resolvePhiLocale(notes.locale, ctx.locale)
  const copy = NOTES[locale]
  const style = parseCardStyle(kind, opts.style ?? (isStyledKind(kind) ? notes.cardStyle?.[kind] : undefined))
  const nnum = clampCount(String(opts.count ?? 33))
  const paintQuality = parsePaintQuality(notes.cardQuality)
  const tagOn = notes.showTagAnalysis !== false
  const statsOn = notes.showRecordStats !== false
  const song = kind === "song" ? { chart: String(opts.chart || "").trim(), level: parseSongLevel(opts.level) } : undefined
  if (song && !song.chart) {
    await ctx.reply({ content: copy.noChart, ephemeral: true })
    return
  }
  const store = ctx.service<KvStore>("kv")
  const input = cardCacheInput({
    kind: cardCacheKind(kind),
    userId: ctx.userId,
    saveRevision: saveIdentity(got.save.saveInfo),
    locale,
    paintQuality,
    epoch: await getCardEpoch(store, ctx.userId),
    count: nnum,
    notes,
    tagOn,
    statsOn,
    style,
    // Leaderboard numbers drift without a save change: re-render a song card daily
    extra: song ? `song:${song.chart}:${song.level}:${new Date().toISOString().slice(0, 10)}` : undefined,
  })
  const prep: Prep = {
    ctx,
    rt: got.rt,
    save: got.save,
    kind,
    notes,
    locale,
    nnum,
    paintQuality,
    tagOn,
    statsOn,
    style,
    song,
    key: cacheKey(cardCacheKind(kind), ctx.userId, cardEtag(cardCacheParts(input, "jpeg"))),
    heightId: cardEtag(cardCacheParts(input, "height")),
    started,
  }
  let out: Painted | string
  try {
    out = await sharedCard(prep)
  } catch (err) {
    logger.error(`render ${kind}: ${err instanceof Error ? err.message : err}`)
    await ctx.reply({ content: copy.failed, ephemeral: true })
    return
  }
  if (typeof out === "string") {
    await ctx.reply({ content: out, ephemeral: true })
    return
  }
  const caption = typeof opts.caption === "function" ? opts.caption(out.data) : opts.caption
  const content = [caption, out.fellBack ? copy.fellBack : out.partial ? copy.partial : undefined].filter(Boolean).join("\n")
  await ctx.reply({
    content: content || undefined,
    files: [{ name: `${opts.filename || kind}.${out.ext}`, data: out.bytes }],
  })
}

/** Identical cards being painted now (a double-click, two users sharing nothing but a retry) */
const inflight = new Map<string, Promise<Painted | string>>()

async function sharedCard(prep: Prep): Promise<Painted | string> {
  // Without R2 the bot keeps cards in memory only: big KV values are slow and count against KV quotas
  const durable = r2WriteReady()
  const hit = await readCachedPng({ store: prep.ctx.service<KvStore>("kv") }, prep.key, { durable }).catch(err => {
    logger.warn(`card cache lookup failed, rendering: ${err instanceof Error ? err.message : err}`)
    return undefined
  })
  if (hit) {
    logger.info(`card cache hit ${prep.kind} ${RENDER_VERSION} ${hit.store} ${Math.round(performance.now() - prep.started)}ms`)
    return { bytes: hit.bytes, ext: "jpg" }
  }
  let job = inflight.get(prep.key)
  if (!job) {
    job = paintFreshCard(prep, durable).finally(() => inflight.delete(prep.key))
    inflight.set(prep.key, job)
  }
  return job
}

async function paintFreshCard(prep: Prep, durable: boolean): Promise<Painted | string> {
  logger.info(`card cache miss ${prep.kind} ${RENDER_VERSION}`)
  const store = prep.ctx.service<KvStore>("kv")
  // The stored height arrives while the card data is built; a slow KV read never delays the paint
  let height: number | undefined
  readCachedHeight(store, prep.heightId).then(
    h => {
      height = h
    },
    () => undefined,
  )
  const built = await withTimeout(buildCardData(prep), DATA_TIMEOUT_MS, `${prep.kind}-data`)
  if (typeof built === "string") return built
  const render = (id: string, heightKey: string, h?: number) =>
    withTimeout(
      prep.ctx.render(id, built.data, {
        paintQuality: prep.paintQuality,
        heightKey,
        height: h,
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      }),
      RENDER_TIMEOUT_MS,
      id,
    )
  let img: RenderedImage
  let fellBack = false
  try {
    img = await render(built.templateId, prep.heightId, height)
  } catch (err) {
    // A broken alternative layout must not cost the user their card
    if (built.templateId === built.classicTemplateId) throw err
    logger.error(`render ${built.templateId} failed, using classic: ${err instanceof Error ? err.message : err}`)
    fellBack = true
    img = await render(built.classicTemplateId, `${prep.heightId}:classic`)
  }
  const partial = built.data.renderPartial === true
  if (!fellBack && !partial) {
    await writeCachedPng({ store }, prep.key, img.bytes, { durable })
    if (!height && img.height > 64) await writeCachedHeight(store, prep.heightId, img.height)
  }
  logger.info(`card ${prep.kind} painted in ${Math.round(performance.now() - prep.started)}ms`)
  return { bytes: img.bytes, ext: img.ext, partial, fellBack, data: built.data }
}

/** The card data per kind, as the WebUI builds it (src/server/cards.ts buildCardData) */
async function buildCardData(prep: Prep): Promise<Built | string> {
  const { ctx, rt, save, kind, notes, locale, style } = prep
  const catalog = phiCatalog(ctx)
  if (kind === "b30" || kind === "x30" || kind === "fc30") {
    const data = await b19Card(rt, save, ctx.db, ctx.userId, catalog, {
      nnum: prep.nnum,
      mode: kind,
      locale,
      showTagAnalysis: prep.tagOn,
      notes,
      peerDeadline: Date.now() + PEER_WAIT_MS - (performance.now() - prep.started),
    })
    return {
      templateId: cardStyleTemplate(kind, style) ?? "phi/b19/b19",
      classicTemplateId: "phi/b19/b19",
      data: { ...data, hideRecordStats: !prep.statsOn, cardKind: kind, cardStyle: style },
    }
  }
  if (kind === "song") {
    const built = await buildSongCard(rt, save, ctx.db, catalog, {
      chart: prep.song?.chart ?? "",
      level: prep.song?.level ?? "AT",
      locale,
      notes,
    })
    if ("error" in built) return NOTES[locale].noChart
    return {
      templateId: built.templateId,
      classicTemplateId: built.templateId,
      data: { ...built.data, theme: notes.theme || "default", locale, cardKind: kind },
    }
  }
  if (kind === "info") {
    const data = await infoCard(rt, save, ctx.db, ctx.userId, catalog, { locale, notes })
    return {
      templateId: cardStyleTemplate(kind, style) ?? "phi/userinfo/userinfo",
      classicTemplateId: "phi/userinfo/userinfo",
      data: { ...data, cardKind: kind, cardStyle: style },
    }
  }
  // hisb30: the update card (score history by save date)
  const [snaps, token] = await Promise.all([loadHisb30Snaps(ctx.db, ctx.userId), getToken(rt, ctx.userId)])
  const history = await loadSaveHistory(rt, ctx.db, token || "")
  const data = await buildUpdateCard(rt, save, catalog, history, notes, snaps, { locale })
  const cardData = {
    ...data,
    theme: notes.theme || "default",
    locale,
    cardKind: kind,
    cardStyle: style,
    // B30 snapshots ({t, rks, phi, b27}) for layouts that show entered / left charts
    hisb30Snaps: snaps,
  }
  // Jackets / grade icons start downloading while the template compiles
  prefetchIlls(updateCardImages(rt, cardData))
  return {
    templateId: cardStyleTemplate(kind, style) ?? "phi/update/update",
    classicTemplateId: "phi/update/update",
    data: cardData,
  }
}
