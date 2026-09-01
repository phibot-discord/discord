import { createCipheriv, createDecipheriv } from "node:crypto"
import JSZip from "jszip"
import { logger } from "../../../src/logger.ts"

const KEY = Buffer.from("6Jaa0qVAJZuXkZCLiOa/Ax5tIZVu+taKUN1V1nqwkks=", "base64")
const IV = Buffer.from("Kk/wisgNYwcAV8WVGMgyUw==", "base64")

function encrypt(text: string) {
  const cipher = createCipheriv("aes-256-cbc", KEY, IV)
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64")
}

function decrypt(word: string) {
  const decipher = createDecipheriv("aes-256-cbc", KEY, IV)
  return Buffer.concat([decipher.update(Buffer.from(word, "base64")), decipher.final()]).toString("hex")
}

export class ByteReader {
  data: Buffer
  position: number

  constructor(data: string | Buffer | Uint8Array | ArrayBuffer, position = 0) {
    this.data =
      typeof data === "string"
        ? Buffer.from(data, "hex")
        : data instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data))
          : Buffer.from(data)
    this.position = position
  }

  remaining() {
    return this.data.length - this.position
  }

  getByte() {
    return this.data[this.position++]!
  }

  getAllByte() {
    return this.data.toString("base64", this.position)
  }

  getShort() {
    this.position += 2
    return (this.data[this.position - 1]! << 8) ^ (this.data[this.position - 2]! & 0xff)
  }

  getInt() {
    this.position += 4
    return (
      (this.data[this.position - 1]! << 24) ^
      ((this.data[this.position - 2]! & 0xff) << 16) ^
      ((this.data[this.position - 3]! & 0xff) << 8) ^
      (this.data[this.position - 4]! & 0xff)
    )
  }

  getFloat() {
    this.position += 4
    return this.data.readFloatLE(this.position - 4)
  }

  getVarInt() {
    if (this.data[this.position]! > 127) {
      this.position += 2
      return Number(0b01111111 & this.data[this.position - 2]!) ^ (this.data[this.position - 1]! << 7)
    }
    return this.data[this.position++]!
  }

  skipVarInt(num?: number) {
    if (num) {
      for (; num > 0; num--) this.skipVarInt()
      return
    }
    if (this.data[this.position]! < 0) this.position += 2
    else this.position++
  }

  getString() {
    const length = this.getVarInt()
    this.position += length
    return this.data.toString("utf-8", this.position - length, this.position)
  }
}

function getBit(data: number, index: number) {
  return Boolean(data & (1 << index))
}

function decodeSummaryBytes(data: string) {
  return Buffer.from(data, "base64").toString("hex")
}

class Summary {
  updatedAt: string
  saveVersion = 0
  challengeModeRank = 0
  rankingScore = 0
  gameVersion = 0
  avatar: string | number = 0
  cleared: number[] = []
  fullCombo: number[] = []
  phi: number[] = []

  constructor(summary: string) {
    const now = Date().toString().split(" ")
    this.updatedAt = `${now[3]} ${now[1]}.${now[2]} ${now[4]}`
    const reader = new ByteReader(decodeSummaryBytes(summary))
    this.saveVersion = reader.getByte()
    this.challengeModeRank = reader.getShort()
    this.rankingScore = reader.getFloat()
    this.gameVersion = reader.getVarInt()
    this.avatar = reader.getString()
    for (let level = 0; level < 4; level++) {
      this.cleared[level] = reader.getShort()
      this.fullCombo[level] = reader.getShort()
      this.phi[level] = reader.getShort()
    }
  }
}

class LevelRecord {
  fc = false
  score = 0
  acc = 0
}

export class GameRecord {
  static version = 1
  data: ByteReader
  Record: Record<string, (LevelRecord | undefined)[]> = {}
  songsnum = 0

  constructor(data: string) {
    this.data = new ByteReader(data)
  }

  async init() {
    this.songsnum = this.data.getVarInt()
    while (this.data.remaining() > 0) {
      const key = this.data.getString()
      this.data.skipVarInt()
      const length = this.data.getByte()
      const fc = this.data.getByte()
      const song: (LevelRecord | undefined)[] = []
      for (let level = 0; level < 5; level++) {
        if (getBit(length, level)) {
          song[level] = new LevelRecord()
          song[level]!.score = this.data.getInt()
          song[level]!.acc = this.data.getFloat()
          song[level]!.fc = song[level]!.score === 1_000_000 && song[level]!.acc === 100 ? true : getBit(fc, level)
        }
      }
      this.Record[key] = song
    }
  }
}

export class GameUser {
  name = "user"
  version = 1
  showPlayerId: boolean
  selfIntro: string
  avatar: string
  background: string

  constructor(data: string) {
    const reader = new ByteReader(data)
    this.showPlayerId = getBit(reader.getByte(), 0)
    this.selfIntro = reader.getString()
    this.avatar = reader.getString()
    this.background = reader.getString()
  }
}

export class GameProgress {
  isFirstRun: boolean
  legacyChapterFinished: boolean
  alreadyShowCollectionTip: boolean
  alreadyShowAutoUnlockINTip: boolean
  completed: string
  songUpdateInfo: number
  challengeModeRank: number
  money: number[]
  unlockFlagOfSpasmodic: number
  unlockFlagOfIgallta: number
  unlockFlagOfRrharil: number
  flagOfSongRecordKey: number
  randomVersionUnlocked: number
  chapter8UnlockBegin: boolean
  chapter8UnlockSecondPhase: boolean
  chapter8Passed: boolean
  chapter8SongUnlocked: number

  constructor(data: string) {
    const reader = new ByteReader(data)
    const tem = reader.getByte()
    this.isFirstRun = getBit(tem, 0)
    this.legacyChapterFinished = getBit(tem, 1)
    this.alreadyShowCollectionTip = getBit(tem, 2)
    this.alreadyShowAutoUnlockINTip = getBit(tem, 3)
    this.completed = reader.getString()
    this.songUpdateInfo = reader.getVarInt()
    this.challengeModeRank = reader.getShort()
    this.money = [reader.getVarInt(), reader.getVarInt(), reader.getVarInt(), reader.getVarInt(), reader.getVarInt()]
    this.unlockFlagOfSpasmodic = reader.getByte()
    this.unlockFlagOfIgallta = reader.getByte()
    this.unlockFlagOfRrharil = reader.getByte()
    this.flagOfSongRecordKey = reader.getByte()
    this.randomVersionUnlocked = reader.getByte()
    const flags = reader.getByte()
    this.chapter8UnlockBegin = getBit(flags, 0)
    this.chapter8UnlockSecondPhase = getBit(flags, 1)
    this.chapter8Passed = getBit(flags, 2)
    this.chapter8SongUnlocked = reader.getByte()
  }
}

export class GameSettings {
  chordSupport: boolean
  fcAPIndicator: boolean
  enableHitSound: boolean
  lowResolutionMode: boolean
  deviceName: string
  bright: number
  musicVolume: number
  effectVolume: number
  hitSoundVolume: number
  soundOffset: number
  noteScale: number

  constructor(data: string) {
    const reader = new ByteReader(data)
    const tem = reader.getByte()
    this.chordSupport = getBit(tem, 0)
    this.fcAPIndicator = getBit(tem, 1)
    this.enableHitSound = getBit(tem, 2)
    this.lowResolutionMode = getBit(tem, 3)
    this.deviceName = reader.getString()
    this.bright = reader.getFloat()
    this.musicVolume = reader.getFloat()
    this.effectVolume = reader.getFloat()
    this.hitSoundVolume = reader.getFloat()
    this.soundOffset = reader.getFloat()
    this.noteScale = reader.getFloat()
  }
}

type TapRegion = {
  baseUrl: string
  headers: Record<string, string>
}

function region(isGlobal: boolean): TapRegion {
  if (isGlobal) {
    return {
      baseUrl: "https://kviehlel.cloud.ap-sg.tapapis.com/1.1",
      headers: {
        "X-LC-Id": "kviehleldgxsagpozb",
        "X-LC-Key": "tG9CTm0LDD736k9HMM9lBZrbeBGRmUkjSfNLDNib",
        "User-Agent": "LeanCloud-CSharp-SDK/1.0.3",
        Accept: "application/json",
      },
    }
  }
  return {
    baseUrl: "https://rak3ffdi.cloud.tds1.tapapis.cn/1.1",
    headers: {
      "X-LC-Id": "rAK3FfdieFob2Nn8Am",
      "X-LC-Key": "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0",
      "User-Agent": "LeanCloud-CSharp-SDK/1.0.3",
      Accept: "application/json",
    },
  }
}

type CloudUserInfo = {
  objectId: string
  nickname?: string
}

type RawCloudSave = {
  gameFile?: { url: string }
  summary: string
  modifiedAt: { iso: string | Date }
  createdAt: string | Date
  updatedAt: string | Date
  PlayerId?: string
}

type ParsedCloudSave = {
  gameFile: { url: string }
  summary: Summary
  modifiedAt: { iso: Date }
  createdAt: Date
  updatedAt: Date
  PlayerId?: string
}

async function jsonGet<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Phigros cloud ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

class SaveManager {
  baseUrl: string
  headers: Record<string, string>
  userInfo: string
  save: string

  constructor(isGlobal: boolean) {
    const r = region(isGlobal)
    this.baseUrl = r.baseUrl
    this.headers = r.headers
    this.userInfo = `${this.baseUrl}/users/me`
    this.save = `${this.baseUrl}/gamesaves/`
  }

  getPlayerInfo(session: string) {
    return jsonGet<CloudUserInfo>(this.userInfo, { ...this.headers, "X-LC-Session": session })
  }

  async saveArray(session: string, objectId: string) {
    const where = encodeURIComponent(`{"user":{"__type":"Pointer","className":"_User","objectId":"${objectId}"}}`)
    const data = await jsonGet<{ results?: RawCloudSave[] }>(`${this.save}?skip=0&limit=100&where=${where}&include=cover,gameFile`, {
      ...this.headers,
      "X-LC-Session": session,
    })
    return data.results ?? []
  }

  async saveCheck(session: string) {
    const userInfo = await this.getPlayerInfo(session)
    const array = await this.saveArray(session, userInfo.objectId)
    const results: ParsedCloudSave[] = []
    for (const item of array) {
      if (!item?.gameFile) continue
      results.push({
        gameFile: item.gameFile,
        summary: new Summary(item.summary),
        modifiedAt: { iso: new Date(item.modifiedAt.iso) },
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        PlayerId: userInfo.nickname,
      })
    }
    if (!results.length) throw new Error("TK 对应存档列表为空，请检查是否同步存档QAQ！")
    results.sort((a, b) => b.modifiedAt.iso.getTime() - a.modifiedAt.iso.getTime())
    return { saveInfo: results[0], playerInfo: userInfo }
  }

  static decrypt(data: string) {
    return decrypt(data)
  }

  static encrypt(data: string) {
    return encrypt(data)
  }
}

export class PhigrosUser {
  session: string
  global: boolean
  saveInfo: ParsedCloudSave | undefined
  playerInfo: CloudUserInfo | undefined
  gameRecord: GameRecord["Record"] = {}
  gameProgress: GameProgress | undefined
  gameuser: GameUser | undefined
  gamesettings: GameSettings | undefined
  Recordver = 1

  constructor(session: string, global = false) {
    if (!session.match(/[a-z0-9A-Z]{25}/)) throw new Error("SessionToken格式错误")
    this.session = session
    this.global = global
  }

  async getSaveInfo() {
    if (!this.session) throw new Error("SessionToken未设置")
    const saveManager = new SaveManager(this.global)
    const { saveInfo, playerInfo } = await saveManager.saveCheck(this.session)
    if (!saveInfo) throw new Error("未找到存档QAQ！")
    this.saveInfo = saveInfo
    this.playerInfo = playerInfo
    return saveInfo
  }

  async buildRecord() {
    if (!this.saveInfo) await this.getSaveInfo()
    const saveInfo = this.saveInfo
    if (!saveInfo?.gameFile?.url) throw new Error("未找到存档QAQ！")
    let saveUrl: URL
    try {
      saveUrl = new URL(saveInfo.gameFile.url)
    } catch (err) {
      logger.error("save url failed", err)
      throw err instanceof Error ? err : new Error(String(err))
    }
    if (saveInfo.summary.saveVersion === 1) throw new Error("存档版本过低，请更新Phigros！")
    const save = await fetch(saveUrl)
    if (!save.ok) throw new Error(`下载存档失败 ${save.status}`)
    let savezip: JSZip
    try {
      savezip = await JSZip.loadAsync(await save.arrayBuffer())
    } catch (err) {
      throw new Error(`解压zip文件失败！ ${err}`)
    }
    this.Recordver = 1

    let file = new ByteReader(Buffer.from(await savezip.file("gameProgress")!.async("nodebuffer")))
    file.getByte()
    this.gameProgress = new GameProgress(SaveManager.decrypt(file.getAllByte()))

    file = new ByteReader(Buffer.from(await savezip.file("user")!.async("nodebuffer")))
    file.getByte()
    this.gameuser = new GameUser(SaveManager.decrypt(file.getAllByte()))

    file = new ByteReader(Buffer.from(await savezip.file("settings")!.async("nodebuffer")))
    file.getByte()
    this.gamesettings = new GameSettings(SaveManager.decrypt(file.getAllByte()))

    file = new ByteReader(Buffer.from(await savezip.file("gameRecord")!.async("nodebuffer")))
    if (file.getByte() !== GameRecord.version) {
      this.gameRecord = {}
      throw new Error("版本号已更新")
    }
    const record = new GameRecord(SaveManager.decrypt(file.getAllByte()))
    await record.init()
    this.gameRecord = record.Record
    return false
  }
}
