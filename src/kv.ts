import { logger } from "./logger.ts"
import type { Kv } from "./sdk/index.ts"

type Envelope = { d: string; e?: number }

export type KvConfig = {
  accountId: string
  namespaceId: string
  apiToken: string
}

const CF_MIN_TTL_SEC = 60

function asString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function parseEnvelope(raw: string): Envelope {
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { d?: unknown; e?: unknown }
      if (typeof parsed.d === "string") {
        return { d: parsed.d, e: typeof parsed.e === "number" ? parsed.e : undefined }
      }
    } catch {
      /* raw string */
    }
  }
  return { d: raw }
}

function encodeEnvelope(env: Envelope): string {
  return JSON.stringify(env)
}

function alive(env: Envelope | undefined, now = Date.now()): env is Envelope {
  if (!env) return false
  return env.e == null || env.e > now
}

function globToPrefix(pattern: string): string {
  const star = pattern.indexOf("*")
  return star === -1 ? pattern : pattern.slice(0, star)
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`)
}

export async function connectKv(cfg: KvConfig): Promise<Kv> {
  const accountId = cfg.accountId.trim()
  const namespaceId = cfg.namespaceId.trim()
  const apiToken = cfg.apiToken.trim()
  if (!accountId || !namespaceId || !apiToken) {
    throw new Error(
      "Cloudflare KV is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID, and CLOUDFLARE_API_TOKEN.",
    )
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
  const headers = { Authorization: `Bearer ${apiToken}` }
  const overlay = new Map<string, Envelope>()
  const writeTail = new Map<string, Promise<unknown>>()

  const enqueue = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = writeTail.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    writeTail.set(key, next.then(() => undefined, () => undefined))
    return next
  }

  const kvFetch = async (url: string, init?: RequestInit, attempt = 0): Promise<Response> => {
    const res = await fetch(url, init)
    if (res.status === 429 && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 1100 * (attempt + 1)))
      return kvFetch(url, init, attempt + 1)
    }
    return res
  }

  const putRemote = async (key: string, env: Envelope) => {
    const ttlSec = env.e != null ? Math.max(CF_MIN_TTL_SEC, Math.ceil((env.e - Date.now()) / 1000)) : undefined
    const url = ttlSec
      ? `${base}/values/${encodeURIComponent(key)}?expiration_ttl=${ttlSec}`
      : `${base}/values/${encodeURIComponent(key)}`
    const res = await kvFetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      body: encodeEnvelope(env),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`KV PUT ${key} failed: ${res.status} ${text}`.slice(0, 500))
    }
  }

  const getRemote = async (key: string): Promise<Envelope | undefined> => {
    const res = await kvFetch(`${base}/values/${encodeURIComponent(key)}`, { headers })
    if (res.status === 404) return undefined
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`KV GET ${key} failed: ${res.status} ${text}`.slice(0, 500))
    }
    const raw = await res.text()
    if (!raw) return undefined
    const env = parseEnvelope(raw)
    if (!alive(env)) {
      overlay.delete(key)
      void delRemote(key)
      return undefined
    }
    overlay.set(key, env)
    return env
  }

  const delRemote = async (key: string) => {
    const res = await kvFetch(`${base}/values/${encodeURIComponent(key)}`, { method: "DELETE", headers })
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "")
      throw new Error(`KV DELETE ${key} failed: ${res.status} ${text}`.slice(0, 500))
    }
  }

  const listRemote = async (prefix: string): Promise<string[]> => {
    const names: string[] = []
    let cursor = ""
    for (;;) {
      const params = new URLSearchParams({ limit: "1000" })
      if (prefix) params.set("prefix", prefix)
      if (cursor) params.set("cursor", cursor)
      const res = await kvFetch(`${base}/keys?${params}`, { headers })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`KV LIST failed: ${res.status} ${text}`.slice(0, 500))
      }
      const body = (await res.json()) as {
        success?: boolean
        result?: { name: string }[]
        result_info?: { cursor?: string }
      }
      if (!body.success) throw new Error("KV LIST failed")
      for (const item of body.result || []) names.push(item.name)
      const next = body.result_info?.cursor
      if (!next) break
      cursor = next
    }
    return names
  }

  const read = async (key: string): Promise<Envelope | undefined> => {
    const local = overlay.get(key)
    if (alive(local)) return local
    if (local) overlay.delete(key)
    return getRemote(key)
  }

  const write = async (key: string, value: unknown, opts?: { ttlMs?: number; nx?: boolean }): Promise<boolean> => {
    const env: Envelope = {
      d: asString(value),
      e: opts?.ttlMs != null ? Date.now() + opts.ttlMs : undefined,
    }
    return enqueue(key, async () => {
      if (opts?.nx) {
        const existing = await read(key)
        if (existing) return false
      }
      overlay.set(key, env)
      await putRemote(key, env)
      return true
    })
  }

  const get = async (key: string): Promise<string | undefined> => {
    const env = await read(key)
    return env?.d
  }

  const del = async (key: string) => {
    overlay.delete(key)
    await enqueue(key, () => delRemote(key))
  }

  const listKeys = async (pattern = "*"): Promise<string[]> => {
    const re = globToRegExp(pattern)
    const prefix = globToPrefix(pattern)
    const remote = await listRemote(prefix === "*" ? "" : prefix)
    const names = new Set<string>(remote.filter(name => re.test(name)))
    const now = Date.now()
    for (const [key, env] of overlay) {
      if (!alive(env, now)) {
        overlay.delete(key)
        continue
      }
      if (re.test(key)) names.add(key)
    }
    return [...names]
  }

  const kv: Kv = {
    get,
    set: async (key, value, ttlMs) => {
      await write(key, value, ttlMs != null ? { ttlMs } : undefined)
    },
    setNx: (key, value, ttlMs) => write(key, value, { ttlMs, nx: true }),
    del,
    keys: (prefix = "") => listKeys(prefix ? `${prefix}*` : "*"),
    ping: async () => {
      const res = await kvFetch(`${base}/keys?limit=10`, { headers })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`KV ping failed: ${res.status} ${text}`.slice(0, 400))
      }
      return "PONG"
    },
    close: async () => undefined,
  }

  const pong = await kv.ping()
  logger.ok(`kv ${pong} ${namespaceId}`)
  return kv
}
