import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHost } from "./app.ts"
import { loadConfig } from "./config.ts"
import { startDiscord, startShardingManager } from "./discord.ts"
import { logger } from "./logger.ts"
import type { AppConfig } from "./sdk/index.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export async function main(config: AppConfig = loadConfig(root)) {
  const host = await createHost(root, config)
  const shard = process.env.SHARDS
  logger.ok(
    `host ready — ${host.commands.length} commands, ${host.templates.size} templates${shard != null && shard !== "" ? ` · shard ${shard}` : ""}`,
  )

  const stop = async () => {
    await host.app.close()
    process.exit(0)
  }
  process.on("SIGINT", () => void stop())
  process.on("SIGTERM", () => void stop())

  await startDiscord(host)
  if (!config.discord.token) {
    logger.info("no token; process stays up for CLI. Ctrl+C to exit.")
  }
}

async function boot() {
  if (process.env.SHARDS != null && process.env.SHARDS !== "") {
    await main()
    return
  }
  const config = loadConfig(root)
  if (config.discord.shardProcesses && config.discord.token && config.discord.clientId) {
    await startShardingManager(config, fileURLToPath(import.meta.url))
    return
  }
  await main(config)
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isDirect) {
  boot().catch(err => {
    logger.error(err)
    process.exit(1)
  })
}
