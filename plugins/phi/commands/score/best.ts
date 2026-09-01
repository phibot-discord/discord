import { defineCommand } from "../../../../src/sdk/index.ts"
import { isBanned, needSave } from "../../lib/util.ts"

export default defineCommand({
  description: "Text B30 (up to b99)",
  options: [{ name: "count", description: "How many (default 19, max 99)", type: "integer" }],
  async execute(ctx, options) {
    if (await isBanned(ctx, "wb19")) return
    const got = await needSave(ctx)
    if (!got) return
    const num = Math.max(1, Math.min(99, Number(options.count) || 19))
    const { b19_list, phi } = await got.save.getB19(undefined, num, { avgType: "none" })
    const lines: string[] = []
    lines.push(`PlayerId: ${got.save.saveInfo.PlayerId} Rks: ${Number(got.save.saveInfo.summary.rankingScore).toFixed(4)}`)
    for (const item of phi || []) {
      if (item?.song) lines.push(`#φ:${item.song}<${item.rank}>${item.difficulty}`)
    }
    for (let i = 0; i < num && i < (b19_list || []).length; i++) {
      const it = b19_list[i]
      if (!it) continue
      lines.push(`#B${i + 1}:${it.song}<${it.rank}>${it.difficulty} ${it.score} ${it.Rating} ${Number(it.acc).toFixed(4)}%[${Number(it.rks).toFixed(4)}]`)
    }
    const text = lines.join("\n")
    if (text.length > 1800) await ctx.reply(`${text.slice(0, 1800)}\n…`)
    else await ctx.reply(text)
  },
})
