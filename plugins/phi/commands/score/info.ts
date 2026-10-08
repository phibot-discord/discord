import { defineCommand } from "../../../../src/sdk/index.ts"
import { resolvePhiLocale } from "../../lib/card-i18n.ts"
import { infoCard } from "../../lib/cards.ts"
import { getNotes } from "../../lib/notes.ts"
import { STYLE_OPTION_DESC, sendCard, styleChoices } from "../../lib/send-card.ts"
import { isBanned, needSave, phiCatalog, replyCard } from "../../lib/util.ts"

/** Bot-only layouts the WebUI does not offer; drawn outside the shared card cache */
const LEGACY: Record<string, string> = {
  legacy: "phi/userinfo/userinfo",
  "legacy-v2": "phi/userinfo/userinfo-old",
}

export default defineCommand({
  description: "Player stats card",
  options: [
    {
      name: "style",
      description: STYLE_OPTION_DESC,
      type: "string",
      choices: styleChoices("info", [
        { name: "Legacy", value: "legacy" },
        { name: "Legacy (v2)", value: "legacy-v2" },
      ]),
    },
  ],
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const style = options.style ? String(options.style) : undefined
    const legacy = style ? LEGACY[style] : undefined
    if (!legacy) {
      await sendCard(ctx, "info", { style })
      return
    }
    const [got, notes] = await Promise.all([needSave(ctx), getNotes(ctx.db, ctx.userId)])
    if (!got) return
    const locale = resolvePhiLocale(notes.locale, ctx.locale)
    const data = await infoCard(got.rt, got.save, ctx.db, ctx.userId, phiCatalog(ctx), { locale, notes })
    await replyCard(ctx, legacy, data, "info", undefined, notes)
  },
})
