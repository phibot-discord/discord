import type { Kv } from "../../../src/sdk/index.ts"
import { isPhiLocale, type PhiLocale } from "./card-i18n.ts"
import { kvKey } from "./const.ts"

type TaskObj = {
  song: string
  finished: boolean
  request: { type: string; rank: string; value: number }
}

export type UserNotes = {
  sign_in: string
  sign_history: string[]
  task_time: string
  task: TaskObj[]
  theme: string
  noticeCode: number
  b30AvgKind: "all" | "b30" | "top" | "none"
  b30AvgColor: "red" | "gold" | "blue" | "green"
  allowApiUsage: boolean
  showB30Analysis: boolean
  /** Stored language for web UI + every rendered card. Unset until the user picks one. */
  locale?: PhiLocale
}

function defaults(): UserNotes {
  return {
    sign_in: "Wed Apr 03 2024 23:03:52 GMT+0800 (中国标准时间)",
    sign_history: [],
    task_time: "Wed Apr 03 2024 23:03:52 GMT+0800 (中国标准时间)",
    task: [],
    theme: "default",
    noticeCode: 0,
    b30AvgKind: "all",
    b30AvgColor: "blue",
    allowApiUsage: true,
    showB30Analysis: true,
  }
}

export async function getNotes(db: Kv, userId: string): Promise<UserNotes> {
  const raw = await db.get(kvKey("notes", userId))
  const base = defaults()
  if (!raw) return base
  try {
    const parsed = JSON.parse(raw) as Partial<UserNotes> & { money?: number }
    const { money: _money, ...rest } = parsed
    return {
      ...base,
      ...rest,
      sign_history: Array.isArray(rest.sign_history) ? rest.sign_history : [],
      task: Array.isArray(rest.task) ? rest.task : [],
      locale: isPhiLocale(rest.locale) ? rest.locale : undefined,
    }
  } catch {
    return base
  }
}

export async function setNotes(db: Kv, userId: string, notes: UserNotes) {
  const { money: _money, ...rest } = notes as UserNotes & { money?: number }
  await db.set(kvKey("notes", userId), JSON.stringify(rest))
}

export async function setUserLocale(db: Kv, userId: string, locale: PhiLocale) {
  const notes = await getNotes(db, userId)
  notes.locale = locale
  await setNotes(db, userId, notes)
}
