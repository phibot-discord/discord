import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  AttachmentBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type Interaction,
  InteractionContextType,
  type InteractionReplyOptions,
  MessageFlags,
  ModalBuilder,
  Partials,
  REST,
  type RepliableInteraction,
  Routes,
  ShardingManager,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js"
import { type Host, slashTree } from "./app.ts"
import type { LoadedCommand } from "./loader.ts"
import { logger } from "./logger.ts"
import type { AppConfig, CollectOptions, ModalSpec, Permission, ReplyPayload } from "./sdk/index.ts"

type SlashOptionFields = {
  setName: (name: string) => SlashOptionFields
  setDescription: (description: string) => SlashOptionFields
  setRequired: (required: boolean) => SlashOptionFields
  addChoices?: (...choices: { name: string; value: string | number }[]) => SlashOptionFields
  setAutocomplete?: (autocomplete: boolean) => SlashOptionFields
}

function applyOptions(
  builder: Pick<
    SlashCommandBuilder,
    | "addIntegerOption"
    | "addNumberOption"
    | "addBooleanOption"
    | "addUserOption"
    | "addChannelOption"
    | "addAttachmentOption"
    | "addStringOption"
  >,
  cmd: LoadedCommand,
) {
  for (const opt of cmd.options || []) {
    const setup = (o: SlashOptionFields) => {
      o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required)
      if (opt.choices?.length && o.addChoices) o.addChoices(...opt.choices)
      if (opt.autocomplete && o.setAutocomplete) o.setAutocomplete(true)
      return o
    }
    switch (opt.type || "string") {
      case "integer":
        builder.addIntegerOption(setup as never)
        break
      case "number":
        builder.addNumberOption(setup as never)
        break
      case "boolean":
        builder.addBooleanOption(setup as never)
        break
      case "user":
        builder.addUserOption(setup as never)
        break
      case "channel":
        builder.addChannelOption(setup as never)
        break
      case "attachment":
        builder.addAttachmentOption(setup as never)
        break
      default:
        builder.addStringOption(setup as never)
    }
  }
}

export function buildSlash(commands: LoadedCommand[]) {
  const builders: SlashCommandBuilder[] = []
  for (const [plugin, cmds] of slashTree(commands)) {
    const root = new SlashCommandBuilder()
      .setName(plugin.slice(0, 32).toLowerCase())
      .setDescription(plugin === "bot" ? "Bot admin" : `${plugin} commands`)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)

    const groups = new Map<string, LoadedCommand[]>()
    const leaves: LoadedCommand[] = []
    for (const c of cmds) {
      const parts = c.path.split("/")
      if (parts.length === 1) leaves.push(c)
      else {
        const g = parts[0]!
        const list = groups.get(g) || []
        list.push(c)
        groups.set(g, list)
      }
    }

    for (const leaf of leaves) {
      root.addSubcommand(sub => {
        sub.setName(leaf.path.replace(/\//g, "-").slice(0, 32)).setDescription(leaf.description.slice(0, 100))
        applyOptions(sub as never, leaf)
        return sub
      })
    }

    for (const [gName, gCmds] of groups) {
      root.addSubcommandGroup(group => {
        group.setName(gName.slice(0, 32)).setDescription(`${gName} commands`)
        for (const c of gCmds) {
          const subName = c.path.split("/").slice(1).join("-").slice(0, 32) || "run"
          group.addSubcommand(sub => {
            sub.setName(subName).setDescription(c.description.slice(0, 100))
            applyOptions(sub as never, c)
            return sub
          })
        }
        return group
      })
    }

    builders.push(root)
  }
  return builders
}

function optionValues(i: ChatInputCommandInteraction | AutocompleteInteraction): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const opt of i.options.data) {
    if (opt.options) {
      for (const inner of opt.options) {
        if (inner.options) {
          for (const leaf of inner.options) {
            out[leaf.name] = leaf.attachment ?? leaf.user ?? leaf.channel ?? leaf.value
          }
        } else out[inner.name] = inner.attachment ?? inner.user ?? inner.channel ?? inner.value
      }
    } else out[opt.name] = opt.attachment ?? opt.user ?? opt.channel ?? opt.value
  }
  return out
}

function findCommand(commands: LoadedCommand[], i: Interaction): LoadedCommand | undefined {
  if (!i.isChatInputCommand() && !i.isAutocomplete()) return
  const plugin = i.commandName
  const group = i.options.getSubcommandGroup(false)
  const sub = i.options.getSubcommand(false)
  const path = group ? `${group}/${sub}` : sub || ""
  return commands.find(c => c.plugin === plugin && (c.path === path || c.path.replace(/\//g, "-") === sub))
}

function allowed(perm: Permission | undefined, isAdmin: boolean) {
  if (!perm || perm === "all") return true
  return isAdmin
}

async function showModalOn(i: ChatInputCommandInteraction, spec: ModalSpec) {
  const modal = new ModalBuilder().setCustomId(spec.customId.slice(0, 100)).setTitle(spec.title.slice(0, 45))
  for (const field of spec.fields.slice(0, 5)) {
    const input = new TextInputBuilder()
      .setCustomId(field.id.slice(0, 100))
      .setLabel(field.label.slice(0, 45))
      .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required !== false)
    if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100))
    if (field.minLength) input.setMinLength(field.minLength)
    if (field.maxLength) input.setMaxLength(Math.min(field.maxLength, 4000))
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  }
  try {
    await i.showModal(modal)
  } catch (err) {
    logger.warn("showModal failed", i.id, discordErrText(err))
    return undefined
  }
  try {
    const submitted = await i.awaitModalSubmit({
      time: 14 * 60 * 1000,
      filter: x => x.customId === spec.customId && x.user.id === i.user.id,
    })
    const out: Record<string, string> = {}
    for (const field of spec.fields) {
      try {
        out[field.id] = submitted.fields.getTextInputValue(field.id)
      } catch {
        out[field.id] = ""
      }
    }
    return { values: out, submitted }
  } catch {
    return undefined
  }
}

async function kvGetFast(db: Host["app"]["db"], key: string, ms = 800): Promise<string | undefined> {
  try {
    return await Promise.race([
      db.get(key),
      new Promise<undefined>(resolve => {
        setTimeout(() => resolve(undefined), ms)
      }),
    ])
  } catch (err) {
    logger.warn("kv get failed", key, String(err))
    return undefined
  }
}

function isConfiguredAdmin(host: Host, userId: string) {
  return host.app.config.admins.includes(userId)
}

function discordCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) return Number((err as { code: unknown }).code)
  return undefined
}

function discordErrText(err: unknown) {
  const code = discordCode(err)
  const msg = err instanceof Error ? err.message : String(err)
  return code != null ? `${code} ${msg.split("\n")[0]}` : msg.slice(0, 300)
}

async function ackDefer(i: RepliableInteraction, ephemeral?: boolean): Promise<boolean> {
  if (i.deferred || i.replied) return true
  try {
    await i.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined })
    return true
  } catch (err) {
    const code = discordCode(err)
    if (i.deferred || i.replied) return true
    if (code === 40060 || code === 10062) {
      logger.warn("ACK skipped — another process already handled this (two `pnpm start`?)", i.id, discordErrText(err))
      return false
    }
    logger.warn("defer failed", i.id, discordErrText(err))
    return false
  }
}

function wantsModal(cmd: LoadedCommand, opts: Record<string, unknown>) {
  if (cmd.modal) return true
  if (cmd.plugin === "phi" && cmd.path === "account/bind" && String(opts.method || "qrcode") === "token") return true
  return false
}

function replyBody(payload: ReplyPayload | string): InteractionReplyOptions {
  const p: ReplyPayload = typeof payload === "string" ? { content: payload } : payload
  const body: InteractionReplyOptions = {}
  if (p.content !== undefined) body.content = p.content
  if (p.files?.length) {
    body.files = p.files.map(f => new AttachmentBuilder(Buffer.from(f.data), { name: f.name }))
  }
  if (p.ephemeral) body.flags = MessageFlags.Ephemeral
  return body
}

const inFlight = new Set<string>()

async function handleInteraction(host: Host, i: Interaction) {
  if (inFlight.has(i.id)) return
  inFlight.add(i.id)
  try {
    await handleInteractionOnce(host, i)
  } finally {
    inFlight.delete(i.id)
  }
}

async function handleInteractionOnce(host: Host, i: Interaction) {
  const path =
    i.isChatInputCommand() || i.isAutocomplete()
      ? [i.commandName, i.options.getSubcommandGroup(false), i.options.getSubcommand(false)].filter(Boolean).join(" ")
      : String(i.type)
  logger.info("interaction", i.id, path, `user=${i.user.id}`, i.guildId ? `guild=${i.guildId}` : "dm")

  try {
    if (i.isAutocomplete()) {
      const cmd = findCommand(host.commands, i)
      if (!cmd?.autocomplete) {
        await i.respond([])
        return
      }
      const ctx = host.createContext({
        userId: i.user.id,
        guildId: i.guildId ?? undefined,
        channelId: i.channelId,
        locale: i.locale,
        isOwner: isConfiguredAdmin(host, i.user.id),
        isAdmin: isConfiguredAdmin(host, i.user.id),
      })
      const focused = i.options.getFocused(true)
      const choices = await cmd.autocomplete(ctx, focused.name, optionValues(i))
      await i.respond(choices.slice(0, 25).map(c => ({ name: c.name.slice(0, 100), value: String(c.value).slice(0, 100) })))
      return
    }

    if (!i.isChatInputCommand()) return

    const cmd = findCommand(host.commands, i)
    if (!cmd) {
      await i.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral }).catch(() => {})
      return
    }

    const isAdmin = isConfiguredAdmin(host, i.user.id)
    const isOwner = isAdmin

    if (!allowed(cmd.permission, isAdmin)) {
      await i.reply({ content: "You cannot use this command.", flags: MessageFlags.Ephemeral })
      return
    }

    if (cmd.plugin === "bot" && cmd.path === "ping") {
      await i.reply({ content: "pong" })
      return
    }

    const opts = optionValues(i)
    let deferred = false
    let sent = false
    let target: RepliableInteraction = i
    if (!wantsModal(cmd, opts)) {
      deferred = await ackDefer(i, cmd.ephemeral)
      if (!deferred) {
        logger.warn("no ACK, drop", i.id, path)
        return
      }
    }

    const cd = Number((await kvGetFast(host.app.db, "bot:cooldown")) || "0")
    if (cd > 0 && !isOwner) {
      const last = Number((await kvGetFast(host.app.db, `bot:cd:${i.user.id}`)) || "0")
      const wait = last + cd * 1000 - Date.now()
      if (wait > 0) {
        const msg = `Cooldown: ${Math.ceil(wait / 1000)}s`
        if (deferred) await target.editReply({ content: msg })
        else if (!i.replied && !i.deferred) await i.reply({ content: msg, flags: MessageFlags.Ephemeral })
        return
      }
      await host.app.db.set(`bot:cd:${i.user.id}`, String(Date.now()), cd * 1000).catch(() => undefined)
    }

    const ctx = host.createContext({
      userId: i.user.id,
      guildId: i.guildId ?? undefined,
      channelId: i.channelId,
      locale: i.locale,
      isOwner,
      isAdmin,
      defer: async ephemeral => {
        if (deferred || sent || target.deferred || target.replied) {
          deferred = true
          return
        }
        deferred = await ackDefer(target, ephemeral)
      },
      showModal: async spec => {
        const result = await showModalOn(i, spec)
        if (!result) return undefined
        target = result.submitted
        deferred = false
        sent = false
        return result.values
      },
      collect: async (opts?: CollectOptions) => {
        const channel = i.channel
        if (!channel || !("awaitMessages" in channel)) return undefined
        const collected = await channel.awaitMessages({
          filter: m => m.author.id === i.user.id && (!opts?.filter || opts.filter(m.content)),
          max: opts?.max ?? 1,
          time: opts?.timeoutMs ?? 60_000,
        })
        return collected.first()?.content
      },
      reply: async payload => {
        const body = replyBody(payload)
        try {
          if (deferred && !sent) {
            const { flags: _flags, ...rest } = body
            void _flags
            await target.editReply(rest)
            sent = true
          } else if (deferred || target.replied || target.deferred) {
            await target.followUp(body)
            sent = true
          } else {
            await target.reply(body)
            sent = true
          }
        } catch (err) {
          const code = discordCode(err)
          if (code === 10062 || code === 40060) {
            logger.warn("reply skipped", i.id, discordErrText(err))
            sent = true
            return
          }
          throw err
        }
      },
    })
    await cmd.execute(ctx, opts)
    if (deferred && !sent) {
      await target.editReply({ content: "Done." }).catch(() => {})
    }
  } catch (err) {
    logger.error("interaction error", discordErrText(err))
    if (!i.isRepliable()) return
    const msg = `Error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1800)
    try {
      if (i.deferred && !i.replied) await i.editReply({ content: msg })
      else if (i.replied || i.deferred) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral })
      else await i.reply({ content: msg, flags: MessageFlags.Ephemeral })
    } catch {
      /* already closed */
    }
  }
}

async function routeSlashToGateway(rest: REST) {
  const app = (await rest.get(Routes.currentApplication())) as { interactions_endpoint_url?: string | null }
  if (!app.interactions_endpoint_url) {
    logger.ok("slash commands route to this gateway")
    return
  }
  let host = "http endpoint"
  try {
    host = new URL(app.interactions_endpoint_url).host
  } catch {
    /* ignore */
  }
  logger.warn(`clearing Interactions Endpoint URL (${host}) so slash commands reach this process`)
  await rest.patch(Routes.currentApplication(), { body: { interactions_endpoint_url: null } })
}

function pidAlive(pid: number) {
  if (!pid || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function lockPath(clientId: string, key = "gateway") {
  return key === "gateway"
    ? join(tmpdir(), `discord-bot-${clientId}.lock`)
    : join(tmpdir(), `discord-bot-${clientId}-${key}.lock`)
}

function acquireGatewayLock(
  clientId: string,
  key = "gateway",
): { ok: true; release: () => void } | { ok: false; pid: number } {
  const file = lockPath(clientId, key)
  const stealStale = () => {
    if (!existsSync(file)) return
    const old = Number(readFileSync(file, "utf8").trim())
    if (!pidAlive(old)) {
      try {
        unlinkSync(file)
      } catch {
        /* ignore */
      }
    }
  }
  stealStale()
  try {
    const fd = openSync(file, "wx")
    writeSync(fd, `${process.pid}\n`)
    closeSync(fd)
  } catch {
    stealStale()
    try {
      const fd = openSync(file, "wx")
      writeSync(fd, `${process.pid}\n`)
      closeSync(fd)
    } catch {
      const pid = Number(existsSync(file) ? readFileSync(file, "utf8").trim() : 0)
      return { ok: false, pid }
    }
  }
  return {
    ok: true,
    release: () => {
      try {
        if (existsSync(file) && readFileSync(file, "utf8").trim() === String(process.pid)) unlinkSync(file)
      } catch {
        /* ignore */
      }
    },
  }
}

function envShardIds(): number[] | null {
  const raw = process.env.SHARDS
  if (raw == null || raw === "") return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 0) return [parsed]
    if (Array.isArray(parsed) && parsed.every(n => typeof n === "number" && Number.isInteger(n) && n >= 0)) {
      return parsed
    }
  } catch {
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return [n]
  }
  return null
}

function runsShardZero() {
  const ids = envShardIds()
  return !ids || ids.includes(0)
}

function clientShardOptions(shards: number | "auto") {
  if (process.env.SHARDS != null || process.env.SHARD_COUNT != null) return {}
  if (shards === "auto") return { shards: "auto" as const }
  return { shards: Array.from({ length: shards }, (_, i) => i), shardCount: shards }
}

export async function startDiscord(host: Host) {
  const { token, clientId, guildId, shards } = host.app.config.discord
  if (!token || !clientId) {
    logger.warn("discord token/clientId missing — skip gateway (render CLI still works)")
    return null
  }

  const ids = envShardIds()
  const lock = acquireGatewayLock(clientId, ids ? `shard-${ids.join("-")}` : "gateway")
  if (!lock.ok) {
    logger.error(
      `not logging in — pid ${lock.pid} already holds this Discord token. Stop that extra \`pnpm start\` (ACK 40060 races).`,
    )
    process.exit(1)
  }
  process.on("exit", lock.release)

  if (runsShardZero()) {
    const body = buildSlash(host.commands).map(b => b.toJSON())
    const rest = new REST({ version: "10" }).setToken(token)
    await routeSlashToGateway(rest)
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body })
      logger.ok(`registered ${body.length} guild commands`)
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body })
      logger.ok(`registered ${body.length} global commands`)
    }
  }

  const client = new Client({
    ...clientShardOptions(shards),
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  })

  let readyLogged = false
  const onReady = () => {
    if (readyLogged) return
    readyLogged = true
    const n = client.options.shardCount ?? 1
    const live = [...client.ws.shards.keys()].join(",") || String(ids?.join(",") ?? 0)
    logger.ok(`logged in as ${client.user?.tag} · shard ${live}/${n}`)
    if (host.app.config.admins.length) logger.ok(`admins ${host.app.config.admins.join(",")}`)
    else logger.warn("admins is empty — admin commands will refuse everyone. Set discord user ids in config/local.yaml")
  }
  client.once("clientReady", onReady)
  client.on("shardError", (error, id) => {
    logger.error(`shard ${id}`, error)
  })

  client.on("raw", (packet: { t?: string | null }) => {
    if (packet.t === "INTERACTION_CREATE") logger.info("gateway INTERACTION_CREATE")
  })

  client.on("interactionCreate", i => {
    void handleInteraction(host, i)
  })

  await client.login(token)
  return client
}

export async function startShardingManager(config: AppConfig, entry: string) {
  const { token, clientId, shards } = config.discord
  if (!token || !clientId) {
    logger.warn("discord token/clientId missing — skip gateway (render CLI still works)")
    return
  }
  const lock = acquireGatewayLock(clientId, "manager")
  if (!lock.ok) {
    logger.error(
      `not logging in — pid ${lock.pid} already holds this Discord token. Stop that extra \`pnpm start\` (ACK 40060 races).`,
    )
    process.exit(1)
  }
  process.on("exit", lock.release)

  const manager = new ShardingManager(entry, {
    token,
    totalShards: shards,
    execArgv: process.execArgv,
    respawn: true,
  })
  manager.on("shardCreate", shard => {
    logger.ok(`spawned shard ${shard.id}`)
    shard.on("death", () => logger.error(`shard ${shard.id} died`))
    shard.on("error", err => logger.error(`shard ${shard.id}`, err))
  })

  const stop = () => {
    manager.respawn = false
    for (const shard of manager.shards.values()) shard.kill()
    lock.release()
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  await manager.spawn({ timeout: 120_000 })
  logger.ok(`all ${manager.shards.size} shard process${manager.shards.size === 1 ? "" : "es"} spawned`)
}
