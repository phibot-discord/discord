import { defineCommand } from "../../../../src/sdk/index.ts"
import { sendCard } from "../../lib/send-card.ts"
import { isBanned, phiCatalog, RANK_CHOICES, resolveSong, songChoices } from "../../lib/util.ts"

export default defineCommand({
  description: "Song card: your record on a chart next to phib19.top players",
  options: [
    { name: "name", description: "Song name or alias", type: "string", required: true, autocomplete: true },
    { name: "level", description: "Difficulty (default AT, or the hardest chart)", type: "string", choices: RANK_CHOICES },
  ],
  autocomplete: songChoices,
  async execute(ctx, options) {
    if (await isBanned(ctx, "b19")) return
    const hit = resolveSong(phiCatalog(ctx), String(options.name || ""))
    if (!hit) {
      await ctx.reply({ content: `No song matching \`${options.name}\`.`, ephemeral: true })
      return
    }
    await sendCard(ctx, "song", {
      chart: hit.id,
      level: options.level ? String(options.level) : undefined,
      filename: "song",
    })
  },
})
