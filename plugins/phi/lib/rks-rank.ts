import type { Kv } from "../../../src/sdk/index.ts"
import { kvKey } from "./const.ts"

const KEY = kvKey("rksRankSet")
type RankMap = Record<string, number>

function parseMap(raw: string | undefined): RankMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as RankMap
  } catch {
    /* empty */
  }
  return {}
}

function sortedMembers(map: RankMap): string[] {
  return Object.entries(map)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value)
}

export class RksRank {
  constructor(private db: Kv) {}

  private async load(): Promise<RankMap> {
    return parseMap(await this.db.get(KEY))
  }

  private save(map: RankMap) {
    return this.db.set(KEY, JSON.stringify(map))
  }

  async addUserRks(sessionToken: string, rks: number) {
    const map = await this.load()
    map[sessionToken] = rks * -1
    await this.save(map)
  }

  async delUserRks(sessionToken: string) {
    const map = await this.load()
    if (!Object.prototype.hasOwnProperty.call(map, sessionToken)) return
    delete map[sessionToken]
    await this.save(map)
  }

  async getUserRank(sessionToken: string) {
    const rank = sortedMembers(await this.load()).indexOf(sessionToken)
    return rank < 0 ? null : rank
  }

  async getUserRks(sessionToken: string) {
    const map = await this.load()
    return Object.prototype.hasOwnProperty.call(map, sessionToken) ? map[sessionToken] ?? null : null
  }

  async getRankUser(min: number, max: number) {
    const members = sortedMembers(await this.load())
    return members.slice(min, max)
  }

  async getRankByRks(rks: number) {
    const lo = rks * -1
    return Object.values(await this.load()).filter(score => score >= lo && score <= 100).length
  }

  async getAllRank() {
    return Object.keys(await this.load()).length
  }
}

export let getRksRank: RksRank

export function initRksRank(db: Kv) {
  getRksRank = new RksRank(db)
  return getRksRank
}
