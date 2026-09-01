import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import QRCode from "qrcode"

type PartialQR = {
  deviceId?: string
  data?: { device_code?: string; expires_in?: number; qrcode_url?: string; interval?: number }
}

class CompleteQRCodeData {
  deviceID: string
  deviceCode: string
  expiresInSeconds?: number
  url?: string
  interval?: number

  constructor(code: PartialQR) {
    this.deviceID = code.deviceId || ""
    this.deviceCode = code.data?.device_code || ""
    this.expiresInSeconds = code.data?.expires_in
    this.url = code.data?.qrcode_url
    this.interval = code.data?.interval
  }
}

const TapSDKVersion = "2.1"
const WebHost = "https://accounts.tapapis.com"
const ChinaWebHost = "https://accounts.tapapis.cn"
const ApiHost = "https://open.tapapis.com"
const ChinaApiHost = "https://open.tapapis.cn"
const ClientId = "rAK3FfdieFob2Nn8Am"
const AppKey = "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0"
const ClientIdGB = "kviehleldgxsagpozb"
const AppKeyGB = "tG9CTm0LDD736k9HMM9lBZrbeBGRmUkjSfNLDNib"
const UrlLcBase = "https://rak3ffdi.cloud.tds1.tapapis.cn/1.1"
const UrlLcBaseGB = "https://kviehlel.cloud.ap-sg.tapapis.com/1.1"

function authorization(requestUrl: string, method: string, keyId: string, macKey: string) {
  const url = new URL(requestUrl)
  const time = Math.floor(Date.now() / 1000).toString().padStart(10, "0")
  const randomStr = randomBytes(16).toString("base64")
  const host = url.hostname
  const uri = url.pathname + url.search
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const sign = createHmac("sha1", macKey)
    .update(`${time}\n${randomStr}\n${method}\n${uri}\n${host}\n${port}\n\n`)
    .digest("base64")
  return `MAC id="${keyId}", ts="${time}", nonce="${randomStr}", mac="${sign}"`
}

async function requestLoginQrCode(permissions = ["public_profile"], useGlobal = false) {
  const deviceId = randomUUID().replace(/-/g, "")
  const params = new FormData()
  params.append("client_id", ClientId)
  params.append("response_type", "device_code")
  params.append("scope", permissions.join(","))
  params.append("version", TapSDKVersion)
  params.append("platform", "unity")
  params.append("info", JSON.stringify({ device_id: deviceId }))
  const endpoint = useGlobal ? `${WebHost}/oauth2/v1/device/code` : `${ChinaWebHost}/oauth2/v1/device/code`
  const response = await fetch(endpoint, { method: "POST", body: params })
  const data = (await response.json()) as Record<string, unknown>
  return { ...data, deviceId } as PartialQR
}

async function checkQRCodeResult(data: PartialQR, useGlobal = false) {
  const qr = new CompleteQRCodeData(data)
  const params = new FormData()
  params.append("grant_type", "device_token")
  params.append("client_id", ClientId)
  params.append("secret_type", "hmac-sha-1")
  params.append("code", qr.deviceCode)
  params.append("version", "1.0")
  params.append("platform", "unity")
  params.append("info", JSON.stringify({ device_id: qr.deviceID }))
  const endpoint = useGlobal ? `${WebHost}/oauth2/v1/token` : `${ChinaWebHost}/oauth2/v1/token`
  try {
    const response = await fetch(endpoint, { method: "POST", body: params })
    const data = (await response.json()) as Record<string, unknown>
    if (data?.kid && data?.access_token && !data.data) return { success: true, data: data as { kid: string; access_token: string } }
    return data as { success?: boolean; data?: { error?: string; kid?: string; access_token?: string } }
  } catch {
    return null
  }
}

async function getProfile(token: { scope?: string; kid: string; mac_key: string }, useGlobal = false) {
  if (!token.scope?.includes("public_profile")) throw new Error("Public profile permission is required.")
  const url = useGlobal
    ? `${ApiHost}/account/profile/v1?client_id=${ClientId}`
    : `${ChinaApiHost}/account/profile/v1?client_id=${ClientId}`
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: authorization(url, "GET", token.kid, token.mac_key) },
  })
  return response.json() as Promise<{ data?: Record<string, unknown> }>
}

async function loginAndGetToken(data: Record<string, unknown>, withGlobal = false) {
  const url = `${withGlobal ? UrlLcBaseGB : UrlLcBase}/users`
  const timestamp = Math.floor(Date.now() / 1000)
  const key = withGlobal ? AppKeyGB : AppKey
  const id = withGlobal ? ClientIdGB : ClientId
  const sign = `${createHash("md5").update(`${timestamp}${key}`).digest("hex")},${timestamp}`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-LC-Id": id,
      "Content-Type": "application/json",
      "X-LC-Sign": sign,
    },
    body: JSON.stringify({ authData: { taptap: data } }),
  })
  return response.json() as Promise<{ sessionToken?: string }>
}

export const getQRcode = {
  getRequest(useGlobal = false) {
    return requestLoginQrCode(undefined, useGlobal)
  },
  getQRcode(url: string, _useGlobal = false) {
    return QRCode.toBuffer(url, { scale: 10 })
  },
  checkQRCodeResult(request: PartialQR, useGlobal = false) {
    return checkQRCodeResult(request, useGlobal)
  },
  async getSessionToken(result: { data?: { kid?: string; access_token?: string; mac_key?: string; scope?: string } }, useGlobal = false) {
    const token = result.data as { kid: string; mac_key: string; scope?: string; access_token?: string }
    const profile = await getProfile(token, useGlobal)
    return (await loginAndGetToken({ ...profile.data, ...result.data }, useGlobal)).sessionToken
  },
}
