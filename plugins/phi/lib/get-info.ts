import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../../src/logger.ts"
import { ALL_LEVEL, LEVEL, MAX_DIFFICULTY } from "./const.ts"
import { bindBackground } from "./fcompute.ts"
import { readJson, readText, readTsv, readYaml } from "./files.ts"

type Chart = {
  id: string
  rank: string
  charter: string
  difficulty: number
  tap?: number
  drag?: number
  hold?: number
  flick?: number
  combo?: number
  maxTime?: number
  distribution?: unknown
}

type SongInfo = {
  id: string
  song: string
  composer?: string
  illustrator?: string
  illustration?: string
  chapter?: string
  bpm?: string
  length?: string
  spinfo?: string
  isOriginal?: boolean
  can_t_be_letter?: boolean
  can_t_be_guessill?: boolean
  chart: Record<string, Chart>
  sp_vis?: boolean
}

type CsvRow = {
  id: string
  song: string
  composer: string
  illustrator: string
  EZ?: string
  HD?: string
  IN?: string
  AT?: string
  EZC?: string
  HDC?: string
  INC?: string
  ATC?: string
}

type Notes = Record<string, Partial<Record<(typeof LEVEL)[number], { m: number; d: unknown; t: [number, number, number, number] }>>>

type VersionInfo = {
  version_label: string
  update_date: number
  whatsnew?: string
  version_code: number
  version?: string
}

function withDotZero(id: string) {
  return id.endsWith(".0") ? id : `${id}.0`
}

const ILL_SOURCE = "https://raw.githubusercontent.com/Catrong/phi-plugin-ill/main"

class GetInfo {
  allLevel = ALL_LEVEL
  Level = LEVEL
  tips: string[] = []
  ori_info: Record<string, SongInfo> = {}
  sp_info: Record<string, SongInfo> = {}
  songsid: Record<string, string> = {}
  idssong: Record<string, string> = {}
  illlist: string[] = []
  idList: string[] = []
  songlist: string[] = []
  chapNick: Record<string, string[]> = {}
  chapList: Record<string, string[]> = {}
  updatedSong: string[] = []
  updatedChart: Record<string, Record<string, unknown>> = {}
  versionInfoByLabel: Record<string, VersionInfo> = {}
  versionInfoByCode: Record<string, VersionInfo> = {}
  historyDifficultyByVersion: Record<string, Record<string, CsvRow>> = {}
  historyDifficultyBySongId: Record<string, Record<string, Partial<Record<string, number>>>> = {}
  historyDifficultyByVerDifficulty: Record<string, Record<string, { id: string; rank: string; difficulty: number }[]>> = {}
  MAX_DIFFICULTY = 0
  avatarid: string[] = []
  resources = ""
  originalIll = ""
  otherIll = ""
  imgPath = ""

  async init(resources: string) {
    this.resources = resources
    this.originalIll = join(resources, "original_ill")
    this.otherIll = join(resources, "otherill")
    this.imgPath = join(resources, "html/otherimg")
    const infoPath = join(resources, "info")
    const oldInfoPath = join(infoPath, "oldInfo")
    const dlcPath = join(infoPath, "DLC")

    if (!existsSync(join(this.originalIll, ".git"))) {
      logger.warn("chart illustrations missing — run /phi admin downill")
    }

    this.tips = []
    this.ori_info = {}
    this.sp_info = {}
    this.songsid = {}
    this.idssong = {}
    this.illlist = []
    this.idList = []
    this.songlist = []
    this.chapNick = {}
    this.updatedSong = []
    this.updatedChart = {}
    this.versionInfoByLabel = {}
    this.versionInfoByCode = {}
    this.historyDifficultyByVersion = {}
    this.historyDifficultyBySongId = {}
    this.historyDifficultyByVerDifficulty = {}
    this.MAX_DIFFICULTY = 0

    this.avatarid = readText(join(infoPath, "avatar.txt"))
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
    this.tips = readText(join(infoPath, "tips.txt"))
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)

    const spJson = readJson<Record<string, Partial<SongInfo>>>(join(infoPath, "spinfo.json"), {})
    for (const [raw, data] of Object.entries(spJson)) {
      const id = withDotZero(raw)
      const song: SongInfo = { ...data, id, sp_vis: true, song: data.song || raw, chart: data.chart || {} }
      this.sp_info[id] = song
      this.idssong[raw] = id
      if (song.song) this.idssong[song.song] = id
      if (song.illustration) this.illlist.push(id)
    }

    const notesInfo = readJson<Notes>(join(infoPath, "notesInfo.json"), {})
    const oldNotes = readJson<Notes>(join(infoPath, "oldNotesInfo.json"), {})

    let historyVersionList: string[] = []
    try {
      historyVersionList = readdirSync(oldInfoPath)
    } catch {
      historyVersionList = []
    }
    const versionCodes = historyVersionList.map(ver => Number(ver)).sort((a, b) => a - b)
    const lastVersionCode = versionCodes.length >= 2 ? versionCodes[versionCodes.length - 2]!.toFixed(0) : undefined
    let oldDif: CsvRow[] = []

    for (const ver of historyVersionList) {
      const verInfo = readJson<VersionInfo>(join(oldInfoPath, ver, "info.json"), {
        version_label: ver,
        version_code: Number(ver),
        update_date: 0,
      })
      const csvDifInfo = readTsv<CsvRow>(join(oldInfoPath, ver, "change.csv"))
      const difInfo: Record<string, CsvRow> = {}
      if (ver === lastVersionCode) oldDif = csvDifInfo
      for (const item of csvDifInfo) difInfo[withDotZero(item.id)] = item
      this.versionInfoByCode[ver] = verInfo
      if (verInfo.version_label) this.versionInfoByLabel[verInfo.version_label] = verInfo
      this.historyDifficultyByVersion[ver] = difInfo
      this.historyDifficultyByVerDifficulty[ver] = {}
      for (const id of Object.keys(difInfo)) {
        const dif: Partial<Record<string, number>> = {}
        for (const level of LEVEL) {
          if (!difInfo[id]![level]) continue
          const songDif = Number(difInfo[id]![level])
          dif[level] = songDif
          const key = songDif.toFixed(1)
          this.historyDifficultyByVerDifficulty[ver]![key] ||= []
          this.historyDifficultyByVerDifficulty[ver]![key]!.push({ id, rank: level, difficulty: songDif })
        }
        this.historyDifficultyBySongId[id] ||= {}
        this.historyDifficultyBySongId[id]![ver] = dif
      }
    }

    const csvInfo = readTsv<CsvRow>(join(infoPath, "info.csv"))
    const jsonInfo = readJson<Record<string, Partial<SongInfo> & { chart?: Record<string, Chart> }>>(join(infoPath, "infolist.json"), {})
    const oldDifList: Record<string, Partial<Record<string, number>>> = {}
    for (const row of oldDif) {
      oldDifList[row.id] = {}
      for (const level of LEVEL) {
        if (row[level]) oldDifList[row.id]![level] = Number(row[level])
      }
    }

    for (const row of csvInfo) {
      const idWithout0 = row.id
      const id = withDotZero(idWithout0)
      if (!oldDifList[idWithout0]) this.updatedSong.push(id)
      if (idWithout0 === "AnotherMe.DAAN") row.song = "Another Me (KALPA)"
      if (idWithout0 === "AnotherMe.NeutralMoon") row.song = "Another Me (Rising Sun Traxx)"
      this.songsid[id] = row.song
      this.idssong[row.song] = id
      this.ori_info[id] = { ...(jsonInfo[idWithout0] || { chapter: "", bpm: "", length: "" }), id, song: row.song, composer: row.composer, illustrator: row.illustrator, chart: {} }
      for (const level of LEVEL) {
        if (!row[level]) continue
        const notes = notesInfo[idWithout0]?.[level]
        const combo = notes ? notes.t[0] + notes.t[1] + notes.t[2] + notes.t[3] : undefined
        const chart: Chart = {
          id,
          rank: level,
          charter: row[`${level}C` as keyof CsvRow] || "",
          difficulty: Number(row[level]),
          tap: notes?.t[0],
          drag: notes?.t[1],
          hold: notes?.t[2],
          flick: notes?.t[3],
          combo,
          maxTime: notes?.m,
          distribution: notes?.d,
        }
        this.ori_info[id]!.chart![level] = chart
        if (oldDifList[idWithout0]) {
          const old = oldDifList[idWithout0]![level]
          const oldN = oldNotes[idWithout0]?.[level]
          const changed =
            old == null ||
            old !== chart.difficulty ||
            (oldN && notes && JSON.stringify(oldN.t) !== JSON.stringify(notes.t))
          if (changed) {
            const tem: Record<string, unknown> = {}
            if (old == null && notes) {
              Object.assign(tem, {
                tap: notes.t[0],
                drag: notes.t[1],
                hold: notes.t[2],
                flick: notes.t[3],
                difficulty: chart.difficulty,
                combo,
                isNew: true,
              })
            } else if (notes) {
              if (old !== chart.difficulty) tem.difficulty = [old, chart.difficulty]
              if (oldN && oldN.t[0] !== notes.t[0]) tem.tap = [oldN.t[0], notes.t[0]]
              if (oldN && oldN.t[1] !== notes.t[1]) tem.drag = [oldN.t[1], notes.t[1]]
              if (oldN && oldN.t[2] !== notes.t[2]) tem.hold = [oldN.t[2], notes.t[2]]
              if (oldN && oldN.t[3] !== notes.t[3]) tem.flick = [oldN.t[3], notes.t[3]]
              const oldCombo = oldN ? oldN.t[0] + oldN.t[1] + oldN.t[2] + oldN.t[3] : undefined
              if (oldCombo != null && combo != null && oldCombo !== combo) tem.combo = [oldCombo, combo]
            }
            this.updatedChart[id] ||= {}
            this.updatedChart[id]![level] = tem
          }
        }
        this.MAX_DIFFICULTY = Math.max(this.MAX_DIFFICULTY, chart.difficulty)
      }
      if (jsonInfo[idWithout0]?.chart) {
        this.ori_info[id]!.chart = { ...this.ori_info[id]!.chart, ...jsonInfo[idWithout0]!.chart }
      }
      this.illlist.push(id)
      this.songlist.push(this.ori_info[id]!.song)
      this.idList.push(id)
    }

    if (this.MAX_DIFFICULTY !== MAX_DIFFICULTY) {
      logger.warn(`MAX_DIFFICULTY constant ${MAX_DIFFICULTY} != computed ${this.MAX_DIFFICULTY}`)
    }

    this.chapList = readYaml<Record<string, string[]>>(join(infoPath, "chaplist.yaml"), {})
    for (const [chap, aliases] of Object.entries(this.chapList)) {
      for (const alias of aliases || []) {
        this.chapNick[alias] ||= []
        this.chapNick[alias]!.push(chap)
      }
    }

    try {
      if (existsSync(dlcPath)) {
        for (const file of readdirSync(dlcPath).filter(f => f.endsWith(".json"))) {
          void file
        }
      }
    } catch {
      /* optional */
    }

    bindBackground(name => this.getBackground(name) || "")
    logger.ok(`phi getInfo: ${this.idList.length} songs, max ${this.MAX_DIFFICULTY}`)
  }

  info(id: string, _original = false): SongInfo | undefined {
    const row = this.ori_info[id] || this.sp_info[id] || this.ori_info[withDotZero(id)] || this.sp_info[withDotZero(id)]
    if (!row) return
    return { ...row, illustration: this.getill(row.id), chart: { ...(row.chart || {}) } }
  }

  getill(id: string, kind: "common" | "blur" | "low" = "common"): string {
    const png = id.replace(/\.0$/, ".png")
    const song = this.ori_info[id] || this.sp_info[id] || this.ori_info[withDotZero(id)] || this.sp_info[withDotZero(id)]
    const ans = song?.illustration
    if (ans && !/^(?:https?|ftp):\/\//i.test(ans) && existsSync(join(this.otherIll, ans))) return join(this.otherIll, ans)
    const local: string[] = []
    if (this.ori_info[id] || this.ori_info[withDotZero(id)]) {
      local.push(join(this.originalIll, png))
      if (kind === "blur") local.push(join(this.originalIll, "illBlur", png))
      else if (kind === "low") local.push(join(this.originalIll, "illLow", png))
      else local.push(join(this.originalIll, "ill", png))
    } else {
      local.push(join(this.originalIll, "SP", png))
    }
    for (const p of local) {
      if (p && existsSync(p)) return p
    }
    if (this.ori_info[id] || this.ori_info[withDotZero(id)]) {
      const dir = kind === "blur" ? "illBlur" : kind === "low" ? "illLow" : "ill"
      return `${ILL_SOURCE}/${dir}/${encodeURIComponent(png)}`
    }
    if (this.sp_info[id] || this.sp_info[withDotZero(id)]) {
      return `${ILL_SOURCE}/SP/${encodeURIComponent(png)}`
    }
    return join(this.imgPath, "phigros.png")
  }

  getChartImg(songId: string, dif: string) {
    const id = songId.replace(/\.0$/, "")
    const local = join(this.originalIll, "chartimg", dif, `${id}.png`)
    if (existsSync(local)) return local
    return `${ILL_SOURCE}/chartimg/${encodeURIComponent(dif)}/${encodeURIComponent(`${id}.png`)}`
  }

  getChapIll(name: string) {
    const local = join(this.originalIll, "chap", `${name}.png`)
    if (existsSync(local)) return local
    return `${ILL_SOURCE}/chap/${encodeURIComponent(`${name}.png`)}`
  }

  idgetavatar(id: string) {
    if (this.avatarid?.includes(id)) {
      if (id === "Cipher : /2&//<|0") return "Cipher1"
      if (id === "Oblivion: PHIN") return "OblivionPHIN"
      return id
    }
    return "Introduction"
  }

  idgetsong(id: string) {
    return this.songsid?.[id]
  }

  SongGetId(song: string) {
    return this.idssong?.[song]
  }

  getBackground(saveBackground: string) {
    let name = saveBackground
    switch (name) {
      case "Another Me ":
        name = "Another Me (KALPA)"
        break
      case "Another Me":
        name = "Another Me (Rising Sun Traxx)"
        break
      case "Re_Nascence (Psystyle Ver.) ":
        name = "Re_Nascence (Psystyle Ver.)"
        break
      case "Energy Synergy Matrix":
        name = "ENERGY SYNERGY MATRIX"
        break
      case "Le temps perdu-":
        name = "Le temps perdu"
        break
      default:
        break
    }
    return this.getill(this.SongGetId(name) || name)
  }
}

export const getInfo = new GetInfo()
