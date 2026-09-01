import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../../src/logger.ts"
import type { App } from "../../../src/sdk/index.ts"
import { initCredentials } from "./credentials.ts"
import { fCompute } from "./fcompute.ts"
import { getInfo } from "./get-info.ts"
import { PhigrosUser } from "./phigros.ts"
import { initRksRank } from "./rks-rank.ts"
import { Save } from "./save.ts"
import { getQRcode } from "./taptap.ts"

export type PhiRuntime = {
  phiRoot: string
  getInfo: typeof getInfo
  PhigrosUser: typeof PhigrosUser
  Save: typeof Save
  fCompute: typeof fCompute
  getRksRank: ReturnType<typeof initRksRank>
  store: ReturnType<typeof initCredentials>
  getQRcode: {
    getRequest: (useGlobal?: boolean) => Promise<{
      deviceId?: string
      data?: { device_code?: string; expires_in?: number; qrcode_url?: string; interval?: number }
    }>
    getQRcode: (url: string, useGlobal?: boolean) => Promise<Buffer>
    checkQRCodeResult: (
      request: unknown,
      useGlobal?: boolean,
    ) => Promise<{ success?: boolean; data?: { error?: string; kid?: string; access_token?: string } } | null>
    getSessionToken: (result: unknown, useGlobal?: boolean) => Promise<string | undefined>
  }
}

export async function bootPhiRuntime(app: App): Promise<PhiRuntime> {
  const dataDir = join(app.config.paths.data, "phi")
  mkdirSync(dataDir, { recursive: true })
  await getInfo.init(app.config.paths.phiResources)
  const store = initCredentials(app.db)
  const getRksRank = initRksRank(app.db)
  logger.ok("phi runtime (getInfo + Save + TapTap) attached")
  return {
    phiRoot: dataDir,
    getInfo,
    PhigrosUser,
    Save,
    fCompute,
    getRksRank,
    store,
    getQRcode: getQRcode as PhiRuntime["getQRcode"],
  }
}
