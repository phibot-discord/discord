import { readdir, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { logger } from "./logger.ts"
import { COMMAND, type CommandDefinition, PLUGIN, type PluginDefinition, TEMPLATE, type TemplateDefinition } from "./sdk/index.ts"

export type LoadedCommand = CommandDefinition & { plugin: string; path: string }

function isCmd(mod: unknown): mod is CommandDefinition {
  return !!mod && typeof mod === "object" && COMMAND in (mod as object)
}

function isTpl(mod: unknown): mod is TemplateDefinition {
  return !!mod && typeof mod === "object" && TEMPLATE in (mod as object)
}

function isPlugin(mod: unknown): mod is PluginDefinition {
  return !!mod && typeof mod === "object" && PLUGIN in (mod as object)
}

async function importDefault(file: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
  return mod.default ?? mod
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p, acc)
      else if (/\.(t|j)sx?$/.test(e.name) && !e.name.endsWith(".d.ts")) acc.push(p)
    }
  } catch {
    return acc
  }
  return acc
}

export async function loadPlugins(pluginsDir: string): Promise<{
  plugins: PluginDefinition[]
  commands: LoadedCommand[]
  templates: TemplateDefinition[]
}> {
  const plugins: PluginDefinition[] = []
  const commands: LoadedCommand[] = []
  const templates: TemplateDefinition[] = []
  let dirs: string[] = []
  try {
    dirs = (await readdir(pluginsDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    logger.warn("no plugins directory", pluginsDir)
    return { plugins, commands, templates }
  }

  for (const name of dirs) {
    const root = join(pluginsDir, name)
    for (const f of ["index.ts", "index.js"]) {
      const p = join(root, f)
      try {
        await stat(p)
        const def = await importDefault(p)
        if (isPlugin(def)) plugins.push({ ...def, name: def.name || name })
        else if (def && typeof def === "object" && "setup" in (def as object)) {
          plugins.push({ ...(def as PluginDefinition), name })
        }
        break
      } catch {
        /* optional */
      }
    }

    const beforeCmd = commands.length
    const beforeTpl = templates.length
    for (const file of await walk(join(root, "commands"))) {
      const def = await importDefault(file)
      if (!isCmd(def) && !(def && typeof def === "object" && "execute" in (def as object))) continue
      const rel = relative(join(root, "commands"), file).replace(/\.(t|j)sx?$/, "")
      const path = rel.split(sep).join("/")
      commands.push({ ...(def as CommandDefinition), plugin: name, path, name: (def as CommandDefinition).name || path })
    }

    for (const file of await walk(join(root, "templates"))) {
      const def = await importDefault(file)
      if (isTpl(def) || (def && typeof def === "object" && ("html" in (def as object) || "render" in (def as object)))) {
        templates.push(def as TemplateDefinition)
      }
    }

    logger.ok(`plugin ${name}: ${commands.length - beforeCmd} commands, ${templates.length - beforeTpl} file templates`)
  }

  return { plugins, commands, templates }
}
