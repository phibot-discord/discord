export type Permission = "all" | "admin" | "owner"

type CommandOption = {
  name: string
  description: string
  type?: "string" | "integer" | "number" | "boolean" | "user" | "channel" | "attachment"
  required?: boolean
  autocomplete?: boolean
  choices?: { name: string; value: string | number }[]
}

type ReplyFile = {
  name: string
  data: Uint8Array | Buffer
}

export type ReplyPayload = {
  content?: string
  ephemeral?: boolean
  files?: ReplyFile[]
}

export type RenderedImage = {
  bytes: Buffer
  mime: string
  ext: string
  width: number
  height: number
}

export type RenderFormat = "png" | "jpeg" | "webp"

type TemplateHelpers = {
  compileArt: (page: string, data: Record<string, unknown>) => string
  resources: string
}

export type TemplateDefinition = {
  id: string
  width?: number
  height?: number
  format?: RenderFormat
  quality?: number
  engine?: "takumi"
  html?: (data: Record<string, unknown>, helpers: TemplateHelpers) => string | Promise<string>
  render?: (data: Record<string, unknown>, helpers: TemplateHelpers) => unknown
}

export type Kv = {
  get: (key: string) => Promise<string | undefined>
  set: (key: string, value: string, ttlMs?: number) => Promise<void>
  setNx: (key: string, value: string, ttlMs?: number) => Promise<boolean>
  del: (key: string) => Promise<void>
  keys: (prefix?: string) => Promise<string[]>
  ping: () => Promise<string>
  close: () => Promise<void>
}

type ModalField = {
  id: string
  label: string
  style?: "short" | "paragraph"
  placeholder?: string
  required?: boolean
  minLength?: number
  maxLength?: number
}

export type ModalSpec = {
  customId: string
  title: string
  fields: ModalField[]
}

export type CollectOptions = {
  timeoutMs?: number
  max?: number
  filter?: (content: string) => boolean
}

export type CommandDefinition = {
  name?: string
  description: string
  options?: CommandOption[]
  permission?: Permission
  modal?: boolean
  ephemeral?: boolean
  execute: (ctx: Context, options: Record<string, unknown>) => Promise<void> | void
  autocomplete?: (
    ctx: Context,
    focused: string,
    options: Record<string, unknown>,
  ) => Promise<{ name: string; value: string }[]> | { name: string; value: string }[]
}

export type PluginDefinition = {
  name: string
  description?: string
  setup?: (app: App) => Promise<void> | void
}

export type Context = {
  userId: string
  guildId?: string
  channelId?: string
  locale?: string
  isOwner: boolean
  isAdmin: boolean
  db: Kv
  reply: (payload: ReplyPayload | string) => Promise<void>
  defer: (ephemeral?: boolean) => Promise<void>
  showModal: (spec: ModalSpec) => Promise<Record<string, string> | undefined>
  collect: (opts?: CollectOptions) => Promise<string | undefined>
  render: (id: string, data?: Record<string, unknown>) => Promise<RenderedImage>
  service: <T = unknown>(name: string) => T
  config: AppConfig
}

export type FontEntry = {
  name: string
  data: Buffer
  weight?: number
  style?: "normal" | "italic"
}

export type AppConfig = {
  discord: {
    token: string
    clientId: string
    guildId: string
    shards: number | "auto"
    shardProcesses: boolean
  }
  admins: string[]
  owners: string[]
  kv: { accountId: string; namespaceId: string; apiToken: string }
  paths: { data: string; plugins: string; phiResources: string }
  render: { format: RenderFormat; quality: number; width: number; scale: number }
}

export type App = {
  config: AppConfig
  root: string
  db: Kv
  command: (def: CommandDefinition & { plugin?: string; path?: string }) => void
  template: (def: TemplateDefinition) => void
  service: (name: string, value: unknown) => void
  getService: <T = unknown>(name: string) => T
  fonts: {
    register: (entry: FontEntry) => void
    fromDir: (dir: string, map?: Record<string, string>) => Promise<void>
  }
  render: (id: string, data?: Record<string, unknown>) => Promise<RenderedImage>
  renderHtml: (html: string, opts?: Partial<TemplateDefinition>) => Promise<RenderedImage>
  compile: (id: string, data?: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
}

export const PLUGIN = Symbol.for("discord.plugin")
export const COMMAND = Symbol.for("discord.command")
export const TEMPLATE = Symbol.for("discord.template")

export function definePlugin(def: PluginDefinition): PluginDefinition {
  return Object.assign(def, { [PLUGIN]: true })
}

export function defineCommand(def: CommandDefinition): CommandDefinition {
  return Object.assign(def, { [COMMAND]: true })
}

export function defineTemplate(def: TemplateDefinition): TemplateDefinition {
  return Object.assign(def, { [TEMPLATE]: true })
}
