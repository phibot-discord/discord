import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { REST, Routes } from "discord.js"
import { createHost } from "../src/app.ts"
import { loadConfig } from "../src/config.ts"
import { buildSlash } from "../src/discord.ts"
import { logger } from "../src/logger.ts"
import { connectKv } from "../src/kv.ts"
import { userSettingCard } from "../plugins/phi/lib/user-setting.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const REQUIRED_PHI = [
  "help",
  "language",
  "account/bind",
  "account/qrcode",
  "account/unbind",
  "account/clean",
  "account/update",
  "account/data",
  "account/myset",
  "account/history",
  "score/b30",
  "score/x30",
  "score/fc30",
  "score/info",
  "score/lmtacc",
  "score/lvsco",
  "score/chap",
  "score/ahv",
  "score/list",
  "score/hisb30",
  "score/best",
  "score/single",
  "score/suggest",
  "fun/theme",
  "fun/tips",
  "admin/downill",
]

const REQUIRED_BOT = ["ping", "status", "cooldown"]

async function main() {
  const failures: string[] = []
  const config = loadConfig(root)

  logger.info("1. Cloudflare KV roundtrip")
  const kv = await connectKv(config.kv)
  const key = `phi:selfcheck:${Date.now()}`
  await kv.set(key, "ok", 10_000)
  const got = await kv.get(key)
  const pong = await kv.ping()
  await kv.del(key)
  if (got !== "ok" || pong !== "PONG") {
    failures.push("kv roundtrip failed")
    logger.error(`kv got=${got} ping=${pong}`)
  } else logger.ok("kv SET/GET/PING")

  logger.info("2. Discord REST /users/@me + slash body")
  if (!config.discord.token || !config.discord.clientId) {
    failures.push("discord token/clientId missing")
  } else {
    const rest = new REST({ version: "10" }).setToken(config.discord.token)
    const me = (await rest.get(Routes.user())) as { id: string; username: string; bot?: boolean }
    logger.ok(`discord identity ${me.username} id=${me.id} bot=${me.bot === true}`)
    if (!me.bot) failures.push("token is not a bot user")
  }

  logger.info("3. Boot host (KV + Takumi + phi runtime)")
  const host = await createHost(root, config)
  const phiCmds = host.commands.filter(c => c.plugin === "phi").map(c => c.path)
  const botCmds = host.commands.filter(c => c.plugin === "bot").map(c => c.path)
  const missingPhi = REQUIRED_PHI.filter(p => !phiCmds.includes(p))
  const missingBot = REQUIRED_BOT.filter(p => !botCmds.includes(p))
  if (missingPhi.length) {
    failures.push(`missing phi commands: ${missingPhi.join(", ")}`)
    logger.error("missing phi", missingPhi.join(", "))
  } else logger.ok(`phi commands ${phiCmds.length}`)
  if (missingBot.length) {
    failures.push(`missing bot commands: ${missingBot.join(", ")}`)
    logger.error("missing bot", missingBot.join(", "))
  } else logger.ok(`bot commands ${botCmds.length}`)
  try {
    host.app.getService("phi.runtime")
    logger.ok("phi.runtime attached")
  } catch {
    failures.push("phi.runtime not registered")
  }
  if (![...host.templates.keys()].some(k => k.startsWith("phi/"))) failures.push("no phi templates")

  if (config.discord.token && config.discord.clientId) {
    const rest = new REST({ version: "10" }).setToken(config.discord.token)
    const body = buildSlash(host.commands).map(b => b.toJSON())
    if (config.discord.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body })
      logger.ok(`registered ${body.length} guild slash trees`)
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body })
      logger.ok(`registered ${body.length} global slash trees`)
    }
  }

  logger.info("4. Takumi smoke render (settings)")
  try {
    const catalog = host.app.getService<{ fallbackIll: string }>("phi.catalog")
    const img = await host.app.render("phi/setting/userSetting", {
      ...userSettingCard(
        {
          sign_in: "",
          sign_history: [],
          task_time: "",
          task: [],
          theme: "default",
          noticeCode: 0,
          b30AvgKind: "all",
          b30AvgColor: "blue",
          allowApiUsage: true,
          showB30Analysis: true,
        },
        "en",
      ),
      theme: "default",
      background: catalog.fallbackIll,
    })
    if (img.bytes.length < 8_000) failures.push(`settings render too small (${img.bytes.length} bytes)`)
    else logger.ok(`settings takumi ${img.width}x${img.height} ${img.bytes.length} bytes`)
  } catch (err) {
    failures.push(`takumi settings render failed: ${err instanceof Error ? err.message : err}`)
    logger.error(err)
  }

  const bind = host.commands.find(c => c.path === "account/bind")
  if (bind && JSON.stringify(bind.options || []).includes("sessionToken")) failures.push("bind still exposes sessionToken as a slash option")

  await host.app.close()
  await kv.close().catch(() => undefined)

  if (failures.length) {
    logger.error(`SELF-CHECK FAILED:\n- ${failures.join("\n- ")}`)
    process.exit(1)
  } else {
    logger.ok("self-check passed: kv, discord identity, slash map, takumi render")
    process.exit(0)
  }
}

main().catch(err => {
  logger.error(err)
  process.exit(1)
})
