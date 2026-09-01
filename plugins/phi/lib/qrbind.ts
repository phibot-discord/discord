import type { Context } from "../../../src/sdk/index.ts"
import { kvKey } from "./const.ts"
import type { PhiRuntime } from "./runtime.ts"
import { ALREADY_BOUND, getToken, updateSave } from "./saves.ts"

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })
}

function qrSucceeded(result: { success?: boolean; data?: { kid?: string; access_token?: string; error?: string } } | null | undefined) {
  if (!result) return false
  if (result.success) return true
  return Boolean(result.data?.kid && result.data?.access_token)
}

const qrInFlight = new Set<string>()

export async function bindViaQr(ctx: Context, rt: PhiRuntime, global: boolean) {
  if (await getToken(rt, ctx.userId)) {
    await ctx.reply({ content: ALREADY_BOUND, ephemeral: true })
    return
  }
  if (qrInFlight.has(ctx.userId)) {
    await ctx.reply({ content: "A QR bind is already running for you.", ephemeral: true })
    return
  }
  const lockKey = kvKey("qrbind", ctx.userId)
  const locked = await ctx.db.setNx(lockKey, "1", 15 * 60 * 1000)
  if (!locked) {
    await ctx.reply({ content: "A QR bind is already running for you.", ephemeral: true })
    return
  }
  qrInFlight.add(ctx.userId)
  let bound = false
  try {
    await bindViaQrOnce(ctx, rt, global, () => bound, v => {
      bound = v
    })
  } finally {
    qrInFlight.delete(ctx.userId)
    await ctx.db.del(lockKey).catch(() => undefined)
  }
}

async function bindViaQrOnce(
  ctx: Context,
  rt: PhiRuntime,
  global: boolean,
  isBound: () => boolean,
  setBound: (v: boolean) => void,
) {
  const request = await rt.getQRcode.getRequest(global)
  const url = request?.data?.qrcode_url
  if (!url) throw new Error("TapTap did not return a QR login URL.")
  const png = await rt.getQRcode.getQRcode(url, global)
  const expires = Math.min(Math.max(Number(request.data?.expires_in) || 300, 30), 840)
  const intervalMs = Math.max(2000, (Number(request.data?.interval) || 2) * 1000)

  await ctx.reply({
    ephemeral: true,
    files: [{ name: "phigros-taptap-bind.png", data: png }],
    content: [
      "Scan this QR with **TapTap** (the account Phigros is logged into).",
      "请用 TapTap 扫码登录。勿扫他人二维码；登录可能影响该 TapTap 账号。",
      `On the same phone, open: ${url}`,
      `Expires in ~${expires}s.`,
    ].join("\n"),
  })

  const started = Date.now()
  let scannedHint = false
  let result: Awaited<ReturnType<PhiRuntime["getQRcode"]["checkQRCodeResult"]>> = null
  while (!isBound() && Date.now() - started < expires * 1000) {
    result = await rt.getQRcode.checkQRCodeResult(request, global)
    if (qrSucceeded(result)) break
    const err = result?.data?.error
    if (!scannedHint && err === "authorization_waiting") {
      scannedHint = true
      await ctx.reply({ content: "QR scanned. Confirm login on your phone.", ephemeral: true })
    }
    await sleep(intervalMs)
  }

  if (isBound()) return

  if (!qrSucceeded(result)) {
    await ctx.reply({ content: "QR expired. Run `/phi account qrcode` (or `/phi account bind`) again.", ephemeral: true })
    return
  }

  let token: string
  try {
    token = String(await rt.getQRcode.getSessionToken(result, global) || "").replace(/\s/g, "")
  } catch (err) {
    await ctx.reply({
      content: `Got TapTap login, but no Phigros sessionToken. Open Phigros, log in with this TapTap account, sync cloud save, then retry.\n${err instanceof Error ? err.message : String(err)}`.slice(0, 1800),
      ephemeral: true,
    })
    return
  }
  if (!/[a-z0-9A-Z]{25}/.test(token)) {
    await ctx.reply({ content: "TapTap login succeeded but the sessionToken was missing or malformed.", ephemeral: true })
    return
  }

  const save = await updateSave(rt, ctx.db, ctx.userId, { token, global })
  setBound(true)
  const rks = save.saveInfo.summary.rankingScore
  await ctx.reply({
    content: `Bound via QR. Player **${save.saveInfo.PlayerId}** · RKS ${Number(rks).toFixed(4)}. Use \`/phi score b30\`.`,
    ephemeral: true,
  })
}
