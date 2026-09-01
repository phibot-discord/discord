import type { Context } from "../../../src/sdk/index.ts"
import { resolvePhiLocale } from "./card-i18n.ts"
import { kvKey } from "./const.ts"
import type { Catalog, Song } from "./catalog.ts"
import { getNotes } from "./notes.ts"
import type { PhiRuntime } from "./runtime.ts"
import { updateSave } from "./saves.ts"

export const RANKS = ["EZ", "HD", "IN", "AT"] as const
type Rank = (typeof RANKS)[number]

export const RANK_CHOICES = RANKS.map(r => ({ name: r, value: r }))

export function phiRt(ctx: Context): PhiRuntime {
  return ctx.service<PhiRuntime>("phi.runtime")
}

export function phiCatalog(ctx: Context): Catalog {
  return ctx.service<Catalog>("phi.catalog")
}

export async function themeOf(ctx: Context) {
  return (await getNotes(ctx.db, ctx.userId)).theme || "default"
}

export async function needSave(ctx: Context) {
  let rt: PhiRuntime
  try {
    rt = phiRt(ctx)
  } catch {
    await ctx.reply({ content: "Phi runtime is not ready. Check KV and bot logs.", ephemeral: true })
    return
  }
  try {
    const save = await updateSave(rt, ctx.db, ctx.userId)
    return { rt, save }
  } catch (err) {
    await ctx.reply({
      content: String(err instanceof Error ? err.message : err),
      ephemeral: true,
    })
    return
  }
}

export async function songChoices(ctx: Context, focused: string, options: Record<string, unknown>, field = "name") {
  if (focused !== field) return []
  const catalog = phiCatalog(ctx)
  const q = String(options[field] || "").trim()
  const ids = q ? catalog.fuzzy(q, 0.7).slice(0, 25) : [...catalog.songs.keys()].slice(0, 25)
  return ids.map(id => {
    const s = catalog.info(id)
    const label = (s?.song || id).slice(0, 100)
    return { name: label, value: (s?.song || id).slice(0, 100) }
  })
}

export function resolveSong(catalog: Catalog, name: string): { id: string; song: Song; ids: string[] } | undefined {
  const ids = catalog.fuzzy(String(name || "").trim())
  const id = ids[0]
  if (!id) return
  const song = catalog.info(id)
  if (!song) return
  return { id, song, ids }
}

export async function replyCard(ctx: Context, template: string, data: Record<string, unknown>, filename: string, content?: string) {
  const notes = await getNotes(ctx.db, ctx.userId)
  const locale = resolvePhiLocale(notes.locale, ctx.locale)
  const img = await ctx.render(template, { ...data, locale })
  await ctx.reply({
    content,
    files: [{ name: `${filename}.${img.ext}`, data: img.bytes }],
  })
  return img
}

export function ratingOf(score: number | undefined, fc: boolean | undefined) {
  if (!score) return "F"
  if (score === 1_000_000) return "phi"
  if (fc) return "FC"
  if (score >= 960_000) return "V"
  if (score >= 920_000) return "S"
  if (score >= 880_000) return "A"
  if (score >= 820_000) return "B"
  if (score >= 700_000) return "C"
  return "F"
}

export function rankIndex(rank: string) {
  return RANKS.indexOf(rank as Rank)
}

export async function isBanned(ctx: Context, feature: string) {
  const gid = ctx.guildId || "dm"
  const hit = (await ctx.db.get(kvKey("ban", gid, feature))) || (await ctx.db.get(kvKey("ban", gid, "全部")))
  if (hit) {
    await ctx.reply({ content: "This feature is banned here.", ephemeral: true })
    return true
  }
  return false
}
