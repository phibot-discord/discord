import { defineCommand } from "../../../src/sdk/index.ts"
import { CARD_STYLES, cardStyles, DEFAULT_CARD_STYLE, isStyledKind } from "../lib/card-styles.ts"
import { getNotes, setCardStyle } from "../lib/notes.ts"
import { STYLE_NAMES } from "../lib/send-card.ts"
import { isBanned } from "../lib/util.ts"

const KIND_NAMES: Record<keyof typeof CARD_STYLES, string> = {
  b30: "B30",
  x30: "x30",
  fc30: "fc30",
  hisb30: "History (hisb30 / update)",
  info: "Info",
}

const ALL_STYLES = [...new Set(Object.values(CARD_STYLES).flat())]

function list(kind: keyof typeof CARD_STYLES) {
  return CARD_STYLES[kind].map(s => `\`${s}\` (${STYLE_NAMES[s]})`).join(", ")
}

export default defineCommand({
  description: "Default layout per card, shared with the web UI",
  options: [
    {
      name: "card",
      description: "Which card (omit to see your layouts)",
      type: "string",
      choices: Object.entries(KIND_NAMES).map(([value, name]) => ({ name, value })),
    },
    {
      name: "style",
      description: "Layout to use from now on",
      type: "string",
      choices: ALL_STYLES.map(s => ({ name: STYLE_NAMES[s], value: s })),
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "setting")) return
    const notes = await getNotes(ctx.db, ctx.userId)
    const kind = String(options.card || "")
    const style = String(options.style || "")
    if (!kind || !isStyledKind(kind)) {
      const lines = Object.entries(KIND_NAMES).map(([k, name]) => {
        const cur = notes.cardStyle?.[k as keyof typeof CARD_STYLES] ?? DEFAULT_CARD_STYLE
        return `**${name}**: ${STYLE_NAMES[cur]} — ${list(k as keyof typeof CARD_STYLES)}`
      })
      await ctx.reply({ content: `Your card layouts:\n${lines.join("\n")}`, ephemeral: true })
      return
    }
    if (!style) {
      const cur = notes.cardStyle?.[kind] ?? DEFAULT_CARD_STYLE
      await ctx.reply({
        content: `**${KIND_NAMES[kind]}** uses ${STYLE_NAMES[cur]}. Options: ${list(kind)}`,
        ephemeral: true,
      })
      return
    }
    if (!(cardStyles(kind) as readonly string[] | undefined)?.includes(style)) {
      await ctx.reply({ content: `**${KIND_NAMES[kind]}** has no ${style} layout. Options: ${list(kind)}`, ephemeral: true })
      return
    }
    await setCardStyle(ctx.db, ctx.userId, kind, style as (typeof CARD_STYLES)[typeof kind][number])
    await ctx.reply({
      content: `**${KIND_NAMES[kind]}** now uses the ${STYLE_NAMES[style as keyof typeof STYLE_NAMES]} layout, here and on the web UI.`,
      ephemeral: true,
    })
  },
})
