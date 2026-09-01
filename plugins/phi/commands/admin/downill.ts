import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { logger } from "../../../../src/logger.ts"
import { defineCommand } from "../../../../src/sdk/index.ts"

function publicText(s: string, hide: string[] = []) {
  let out = s
  for (const p of hide) {
    if (p) out = out.replaceAll(p, "")
  }
  return out
    .replaceAll(homedir(), "~")
    .replace(/\/Users\/[^\s"'`]+/g, "~")
    .replace(/\/home\/[^\s"'`]+/g, "~")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 1800)
}

function runGit(args: string[], cwd: string) {
  logger.info("git", args.filter(a => !a.startsWith("http") && !a.startsWith("/")).join(" "))
  return new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const pump = (buf: Buffer) => {
      process.stderr.write(buf)
    }
    child.stdout?.on("data", pump)
    child.stderr?.on("data", pump)
    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) resolve()
      else reject(new Error(`git exited ${code}`))
    })
  })
}

export default defineCommand({
  description: "Download or update chart illustrations",
  permission: "owner",
  ephemeral: true,
  async execute(ctx) {
    const resources = ctx.config.paths.phiResources
    const url = "https://github.com/Catrong/phi-plugin-ill.git"
    try {
      await ctx.reply({
        content: "Downloading chart illustrations. Git progress is in the bot terminal.",
        ephemeral: true,
      })
      if (!existsSync(`${resources}/original_ill/.git`)) {
        logger.info("cloning illustration pack into original_ill (large)")
        await runGit(["clone", "--depth=1", "--progress", url, "original_ill"], resources)
      } else {
        logger.info("updating illustration pack (original_ill)")
        await runGit(["pull", "--ff-only", "--progress"], `${resources}/original_ill`)
      }
      logger.ok("illustration pack ready")
      await ctx.reply({ content: "Illustration pack updated. Restart the bot to pick up new art.", ephemeral: true })
    } catch (err) {
      const msg = publicText(String(err instanceof Error ? err.message : err), [resources, process.cwd(), homedir()])
      logger.error("downill failed", msg)
      await ctx.reply({ content: msg || "Download failed. See the bot terminal.", ephemeral: true })
    }
  },
})
