import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"
import type { AppConfig } from "./sdk/index.ts"

function deepMerge<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown> | undefined): T {
  if (!extra) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k]
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

function parseShards(raw: unknown): number | "auto" {
  if (raw == null || raw === "" || raw === "auto") return "auto"
  const n = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('discord.shards must be "auto" or an integer >= 1')
  }
  return n
}

export function loadConfig(root: string): AppConfig {
  const def = parse(readFileSync(resolve(root, "config/default.yaml"), "utf8")) as AppConfig
  const localPath = resolve(root, "config/local.yaml")
  const local = existsSync(localPath) ? (parse(readFileSync(localPath, "utf8")) as Record<string, unknown>) : {}
  const cfg = deepMerge(def as unknown as Record<string, unknown>, local) as unknown as AppConfig
  const ids = [...(cfg.admins || []), ...(cfg.owners || [])].map(v => String(v || "").trim()).filter(Boolean)
  cfg.admins = [...new Set(ids)]
  cfg.owners = cfg.admins
  cfg.paths.data = resolve(root, cfg.paths.data)
  cfg.paths.plugins = resolve(root, cfg.paths.plugins)
  cfg.paths.phiResources = resolve(root, cfg.paths.phiResources)
  cfg.render = {
    format: cfg.render?.format || "jpeg",
    quality: cfg.render?.quality ?? 90,
    width: cfg.render?.width ?? 1200,
    scale: cfg.render?.scale ?? 1,
  }
  const kv = (cfg as AppConfig).kv || { accountId: "", namespaceId: "", apiToken: "" }
  cfg.kv = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || kv.accountId || "",
    namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID?.trim() || kv.namespaceId || "",
    apiToken: process.env.CLOUDFLARE_API_TOKEN?.trim() || kv.apiToken || "",
  }
  const discord = cfg.discord as AppConfig["discord"] & { shards?: unknown; shardProcesses?: unknown }
  discord.shards = parseShards(discord.shards)
  discord.shardProcesses = Boolean(discord.shardProcesses)
  cfg.discord = discord
  return cfg
}
