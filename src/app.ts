import { join } from "node:path"
import { type LoadedCommand, loadPlugins } from "./loader.ts"
import { logger } from "./logger.ts"
import { connectKv } from "./kv.ts"
import { RenderEngine } from "./render/engine.ts"
import { loadFontsFromDir } from "./render/fonts.ts"
import { compileArt } from "./render/html.ts"
import type {
  App,
  AppConfig,
  CollectOptions,
  Context,
  FontEntry,
  ModalSpec,
  PluginDefinition,
  RenderedImage,
  TemplateDefinition,
} from "./sdk/index.ts"

export type Host = {
  app: App
  commands: LoadedCommand[]
  templates: Map<string, TemplateDefinition>
  plugins: PluginDefinition[]
  engine: RenderEngine
  createContext: (
    partial: {
      userId: string
      guildId?: string
      channelId?: string
      locale?: string
      isOwner: boolean
      isAdmin: boolean
      reply?: Context["reply"]
      defer?: Context["defer"]
      showModal?: Context["showModal"]
      collect?: Context["collect"]
    },
  ) => Context
}

const missingModal = async (_spec: ModalSpec) => {
  throw new Error("showModal is only available on a Discord interaction")
}
const missingCollect = async (_opts?: CollectOptions) => undefined

export async function createHost(root: string, config: AppConfig): Promise<Host> {
  const engine = new RenderEngine()
  await engine.init()
  const db = await connectKv(config.kv)
  const templates = new Map<string, TemplateDefinition>()
  const services = new Map<string, unknown>()
  const extraCommands: LoadedCommand[] = []
  const fonts: FontEntry[] = []

  const helpersFor = (resources: string) => ({
    resources,
    compileArt: (page: string, data: Record<string, unknown>) => {
      const file = page.endsWith(".art") ? join(resources, "html", page) : join(resources, "html", `${page}.art`)
      const res = resources.replace(/\\/g, "/")
      return compileArt(file, {
        ...data,
        defaultLayout: `${res}/html/common/layout/default.art`,
        _layout_path: `${res}/html/common/layout/`,
        _res_path: `${res}/`,
        pluResPath: `${res}/`,
        _imgPath: data._imgPath ?? `${res}/html/otherimg/`,
      })
    },
  })

  // art-template extend uses the data field `defaultLayout`; also put a trailing slash on res path like phi.
  const phiResources = config.paths.phiResources
  const helpers = helpersFor(phiResources.endsWith("/") ? phiResources.slice(0, -1) : phiResources)

  const compileId = async (id: string, data: Record<string, unknown> = {}): Promise<string> => {
    const def = templates.get(id)
    if (!def) throw new Error(`unknown template: ${id}`)
    const html = def.html
      ? await def.html(data, helpers)
      : typeof def.render === "function"
        ? await def.render(data, helpers)
        : null
    if (typeof html !== "string") throw new Error(`template ${id} has neither html() nor render()`)
    return html
  }

  const renderId = async (id: string, data: Record<string, unknown> = {}): Promise<RenderedImage> => {
    const def = templates.get(id)
    if (!def) throw new Error(`unknown template: ${id}`)
    return engine.renderTemplate(def, data, helpers)
  }

  const app: App = {
    config,
    root,
    db,
    command: def => {
      extraCommands.push({
        ...def,
        plugin: def.plugin || "bot",
        path: def.path || def.name || "unnamed",
        name: def.name || def.path || "unnamed",
        description: def.description,
        execute: def.execute,
      })
    },
    template: def => {
      templates.set(def.id, def)
    },
    service: (name, value) => void services.set(name, value),
    getService: name => {
      if (!services.has(name)) throw new Error(`unknown service: ${name}`)
      return services.get(name) as never
    },
    fonts: {
      register: entry => {
        fonts.push(entry)
        engine.registerFont(entry)
      },
      fromDir: async (dir, map) => {
        const loaded = await loadFontsFromDir(dir, map)
        for (const f of loaded) {
          fonts.push(f)
          engine.registerFont(f)
        }
        logger.ok(`fonts: ${loaded.map(f => f.name).join(", ")}`)
      },
    },
    render: renderId,
    compile: compileId,
    renderHtml: (html, opts) =>
      engine.renderHtml(html, {
        width: opts?.width ?? config.render.width,
        height: opts?.height,
        format: opts?.format ?? config.render.format,
        quality: opts?.quality ?? config.render.quality,
        baseDir: helpers.resources,
        id: opts?.id,
      }),
    close: async () => {
      await engine.close()
      await db.close()
    },
  }

  const loaded = await loadPlugins(config.paths.plugins)
  for (const t of loaded.templates) templates.set(t.id, t)
  for (const p of loaded.plugins) {
    await p.setup?.(app)
  }

  const commands = [...loaded.commands, ...extraCommands]
  app.service("meta", {
    commands,
    templates: [...templates.keys()],
    plugins: loaded.plugins.map(p => p.name),
  })

  const createContext: Host["createContext"] = partial => ({
    config,
    db,
    service: app.getService,
    render: renderId,
    isOwner: partial.isOwner,
    isAdmin: partial.isAdmin,
    userId: partial.userId,
    guildId: partial.guildId,
    channelId: partial.channelId,
    locale: partial.locale,
    reply: partial.reply || (async () => undefined),
    defer: partial.defer || (async () => undefined),
    showModal: partial.showModal || missingModal,
    collect: partial.collect || missingCollect,
  })

  return { app, commands, templates, plugins: loaded.plugins, engine, createContext }
}

export function slashTree(commands: LoadedCommand[]) {
  /** plugin -> path segments */
  const byPlugin = new Map<string, LoadedCommand[]>()
  for (const c of commands) {
    const list = byPlugin.get(c.plugin) || []
    list.push(c)
    byPlugin.set(c.plugin, list)
  }
  return byPlugin
}
