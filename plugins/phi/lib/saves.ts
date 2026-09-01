import type { Kv } from "../../../src/sdk/index.ts"
import { kvKey } from "./const.ts"
import type { PhiRuntime } from "./runtime.ts"
import type { Save, SavePayload } from "./save.ts"

const SAVE = (token: string) => kvKey("save", token)

export async function getToken(rt: PhiRuntime, userId: string): Promise<string | undefined> {
  const t = await rt.store.getSessionToken(userId)
  return t || undefined
}

export const ALREADY_BOUND = "An account is already bound. Use `/phi account unbind` first, then bind again."
export const NOT_BOUND = "No account is bound. Use `/phi account qrcode` (or `/phi account bind`) first."

async function setToken(rt: PhiRuntime, userId: string, token: string) {
  await rt.store.setSessionToken(userId, token)
}

export async function clearUser(rt: PhiRuntime, db: Kv, userId: string) {
  const token = await getToken(rt, userId)
  await rt.store.clearLocalCredentials(userId)
  if (!token) return false
  const stillHeld = [...(await rt.store.listSessionCredentials()).values()].includes(token)
  if (!stillHeld) {
    await db.del(SAVE(token))
    await rt.getRksRank.delUserRks(token)
  }
  return true
}

export async function loadSave(rt: PhiRuntime, db: Kv, userId: string) {
  const token = await getToken(rt, userId)
  if (!token) return undefined
  const raw = await db.get(SAVE(token))
  if (!raw) return undefined
  const data = JSON.parse(raw)
  const save = new rt.Save(data)
  await save.init()
  return save
}

function saveRev(saveInfo: { gameFile?: { url?: string }; modifiedAt?: { iso?: Date | string } } | undefined): string | undefined {
  const url = String(saveInfo?.gameFile?.url || "")
  const iso = saveInfo?.modifiedAt?.iso
  const ms = iso instanceof Date ? iso.getTime() : Date.parse(String(iso || ""))
  const stamp = Number.isFinite(ms) ? String(ms) : ""
  if (!url && !stamp) return undefined
  return `${url}|${stamp}`
}

export async function updateSave(
  rt: PhiRuntime,
  db: Kv,
  userId: string,
  opts: { token?: string; global?: boolean } = {},
) {
  const existing = await getToken(rt, userId)
  if (opts.token && existing) throw new Error(ALREADY_BOUND)
  const token = opts.token || existing
  if (!token) throw new Error(NOT_BOUND)
  if (!/[a-z0-9A-Z]{25}/.test(token)) throw new Error("SessionToken format is invalid (need 25 alphanumerics).")
  if (await rt.store.isSessionTokenBanned(token)) throw new Error("This sessionToken is banned.")
  const cachedRaw = await db.get(SAVE(token))
  const cached = cachedRaw ? JSON.parse(cachedRaw) : undefined
  const global = opts.global ?? !!cached?.global
  const user = new rt.PhigrosUser(token, global)
  await user.getSaveInfo()
  const rev = saveRev(user.saveInfo)
  if (cached?.gameRecord && rev && rev === saveRev(cached.saveInfo)) {
    await setToken(rt, userId, token)
    const save = new rt.Save(cached)
    await save.init()
    if (opts.token) await snapshotB30(db, userId, save)
    return save
  }
  await user.buildRecord()
  await setToken(rt, userId, token)
  const payload = JSON.stringify({
    session: user.session,
    global: user.global,
    saveInfo: user.saveInfo,
    playerInfo: user.playerInfo,
    gameRecord: user.gameRecord,
    gameProgress: user.gameProgress,
    gameuser: user.gameuser,
    gamesettings: user.gamesettings,
    Recordver: user.Recordver,
  })
  await db.set(SAVE(token), payload)
  const rks = user.saveInfo?.summary?.rankingScore
  if (typeof rks === "number") await rt.getRksRank.addUserRks(token, rks)
  const save = new rt.Save(user as unknown as SavePayload)
  await save.init()
  await snapshotB30(db, userId, save)
  try {
    const { applySaveToHistory } = await import("./history.ts")
    await applySaveToHistory(rt, db, token, save)
  } catch {
    /* history is best-effort */
  }
  return save
}

async function snapshotB30(db: Kv, userId: string, save: Save) {
  const key = kvKey("hisb30", userId)
  let b19: Awaited<ReturnType<Save["getB19"]>>
  try {
    b19 = await save.getB19(undefined, 33, { avgType: "none" })
  } catch {
    return
  }
  const prev = JSON.parse((await db.get(key)) || "[]") as unknown[]
  const row = {
    t: Date.now(),
    rks: save.saveInfo?.summary?.rankingScore,
    phi: (b19.phi || []).flatMap(x => (x ? [{ id: x.id, rank: x.rank }] : [])),
    b27: (b19.b19_list || []).slice(0, 27).map(x => ({ id: x.id, rank: x.rank })),
  }
  const next = Array.isArray(prev) ? [...prev, row] : [row]
  while (next.length > 40) next.shift()
  await db.set(key, JSON.stringify(next))
}

export function moneyText(money: number[] | undefined) {
  const m = money || [0, 0, 0, 0, 0]
  return `${m[4] ? `${m[4]}PiB ` : ""}${m[3] ? `${m[3]}TiB ` : ""}${m[2] ? `${m[2]}GiB ` : ""}${m[1] ? `${m[1]}MiB ` : ""}${m[0] ? `${m[0]}KiB ` : ""}`.trim() || "0KiB"
}
