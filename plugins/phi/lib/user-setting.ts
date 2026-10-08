import { cardCopy, type PhiLocale } from "./card-i18n.ts"
import { CARD_STYLES, DEFAULT_CARD_STYLE, type StyledKind } from "./card-styles.ts"
import { b30AvgKindOf, rankBandShowOf, rankScopeOf, type UserNotes } from "./notes.ts"

type Option = { value: string; title: string; description: string; selected: boolean }
type Item = { key: string; title: string; description: string; currentTitle: string; options: Option[] }
type Choices = Record<string, { title: string; description: string }>

function item(key: string, title: string, description: string, current: string, options: Choices): Item {
  return {
    key,
    title,
    description,
    currentTitle: options[current]?.title || current,
    options: Object.entries(options).map(([value, o]) => ({
      value,
      title: o.title,
      description: o.description,
      selected: value === current,
    })),
  }
}

/**
 * Settings the WebUI added after card-i18n's settings copy was written (peer modes,
 * rank scope, quality, layouts…). Bot only: the WebUI has its own settings page
 */
const COPY = {
  en: {
    avgKind: {
      all: { title: "[0] Average", description: "Average accuracy of players near your RKS." },
      top: { title: "[1] Top %", description: "Your top percentage among players near your RKS." },
      rank: { title: "[2] Rank", description: "Your estimated place among phib19.top records." },
      none: { title: "[3] Off", description: "No comparison badge on the chart rows." },
    },
    rankScopeTitle: "Ranked among",
    rankScopeDesc: "For the Rank comparison: who a chart's place is counted among.",
    rankScope: {
      all: { title: "[0] All records", description: "Your place among every phib19.top record of the chart." },
      band: { title: "[1] ±0.05 RKS", description: "Your place among players whose RKS is within about 0.05 of yours." },
      both: { title: "[2] Both", description: "Two lines per chart: all records, then players within about 0.05 RKS." },
    },
    rankShowTitle: "±0.05 badge shows",
    rankShowDesc: "What the ±0.05 RKS rank badge displays.",
    rankShow: {
      place: { title: "[0] #Place / players", description: "Your place among players near your RKS, e.g. #12 / 400." },
      percent: { title: "[1] Top %", description: "Your top percentage among players near your RKS, e.g. Top 3.0%." },
    },
    peerWaitTitle: "Slow lookups",
    peerWaitDesc: "When phib19.top is slow, wait up to about a minute instead of drawing the card after 2.5 s with some badges missing.",
    peerWait: {
      true: { title: "[0] Wait for every badge", description: "Slower, but complete." },
      false: { title: "[1] Don't wait", description: "Draw on time; late badges are left out." },
    },
    statsTitle: "Clear / FC / AP counts",
    statsDesc: "The counts in the top right of B30 / x30 / fc30 cards.",
    qualityTitle: "Quality",
    qualityDesc: "Sharper cards take longer to draw.",
    quality: {
      fast: { title: "[0] Faster · normal", description: "2× pixels; very tall cards drop to 1×." },
      high: { title: "[1] High quality · slower", description: "As sharp as the renderer allows." },
    },
    backgroundTitle: "Background",
    backgroundDesc: "Set with `value:<song name>`; `0` goes back to random.",
    backgroundRandom: "[0] Random",
    layoutTitle: "Layouts",
    layoutDesc: "Saved layout per card. Change with `/phi layout`.",
    kinds: { b30: "B30", x30: "x30", fc30: "fc30", hisb30: "History", info: "Info" },
    styles: { classic: "Classic", table: "Table", portrait: "Phone", timeline: "Timeline", summary: "Summary" },
  },
  zh: {
    avgKind: {
      all: { title: "[0]平均", description: "与你 RKS 相近玩家的平均准确率。" },
      top: { title: "[1]前百分比", description: "你在 RKS 相近玩家中的前百分比。" },
      rank: { title: "[2]排名", description: "你在 phib19.top 记录中的估计名次。" },
      none: { title: "[3]关闭", description: "谱面行上不显示对比标记。" },
    },
    rankScopeTitle: "排名范围",
    rankScopeDesc: "「排名」对比时，谱面名次在哪些玩家中计算。",
    rankScope: {
      all: { title: "[0]全部记录", description: "你在该谱面所有 phib19.top 记录中的名次。" },
      band: { title: "[1]±0.05 RKS", description: "只与 RKS 和你相差约 0.05 以内的玩家比较。" },
      both: { title: "[2]两者", description: "每个谱面两行：全部记录，以及 RKS 相近（约 ±0.05）的玩家。" },
    },
    rankShowTitle: "±0.05 标记显示",
    rankShowDesc: "±0.05 RKS 排名标记显示的内容。",
    rankShow: {
      place: { title: "[0]#名次 / 人数", description: "你在 RKS 相近玩家中的名次，如 #12 / 400。" },
      percent: { title: "[1]前百分比", description: "你在 RKS 相近玩家中的前百分比，如 Top 3.0%。" },
    },
    peerWaitTitle: "查询较慢时",
    peerWaitDesc: "phib19.top 较慢时，最多等待约一分钟，而不是在 2.5 秒后缺少部分标记直接出图。",
    peerWait: {
      true: { title: "[0]等待全部标记", description: "较慢，但完整。" },
      false: { title: "[1]不等待", description: "按时出图，迟到的标记不显示。" },
    },
    statsTitle: "完成 / FC / AP 数量",
    statsDesc: "B30 / x30 / fc30 成绩图右上角的数量统计。",
    qualityTitle: "画质",
    qualityDesc: "画质越高，出图越慢。",
    quality: {
      fast: { title: "[0]更快 · 普通", description: "2 倍像素；特别长的图降为 1 倍。" },
      high: { title: "[1]高画质 · 较慢", description: "渲染器允许的最高清晰度。" },
    },
    backgroundTitle: "背景",
    backgroundDesc: "用 `value:<曲名>` 设置；`0` 恢复随机。",
    backgroundRandom: "[0]随机",
    layoutTitle: "版式",
    layoutDesc: "每种成绩图保存的版式。用 `/phi layout` 修改。",
    kinds: { b30: "B30", x30: "x30", fc30: "fc30", hisb30: "历史", info: "信息" },
    styles: { classic: "经典", table: "表格", portrait: "手机竖版", timeline: "时间线", summary: "摘要" },
  },
} satisfies Record<PhiLocale, unknown>

export type SettingCopy = (typeof COPY)["en"]

export function settingCopy(locale: PhiLocale): SettingCopy {
  return COPY[locale] ?? COPY.en
}

/** `[n]` index → value, in the order the settings card lists them */
export const SETTING_VALUES = {
  avgkind: ["all", "top", "rank", "none"],
  avgcolor: ["red", "gold", "blue", "green"],
  rankscope: ["all", "band", "both"],
  rankshow: ["place", "percent"],
  quality: ["fast", "high"],
} as const

export function userSettingCard(notes: UserNotes, locale: PhiLocale, backgroundSong?: string) {
  const t = cardCopy(locale)
  const c = settingCopy(locale)
  const lang = notes.locale || locale
  const onOff = (on: boolean) => String(on)
  const background: Choices = { random: { title: c.backgroundRandom, description: "" } }
  if (backgroundSong) background.chosen = { title: backgroundSong, description: "" }
  const layouts = Object.keys(CARD_STYLES).map(kind => {
    const style = notes.cardStyle?.[kind as StyledKind] ?? DEFAULT_CARD_STYLE
    return {
      value: kind,
      title: `${c.kinds[kind as StyledKind]} · ${c.styles[style]}`,
      description: "",
      selected: style !== DEFAULT_CARD_STYLE,
    }
  })
  return {
    pageTitle: t.settingsTitle,
    pageDescription: t.settingsDesc,
    locale,
    items: [
      item("locale", t.langTitle, t.langDesc, lang, t.langOpt),
      item("theme", t.themeTitle, t.themeDesc, notes.theme || "default", t.theme),
      item("b30AvgKind", t.avgKindTitle, t.avgKindDesc, b30AvgKindOf(notes), c.avgKind),
      item("b30AvgColor", t.avgColorTitle, t.avgColorDesc, notes.b30AvgColor || "blue", t.avgColor),
      item("rankScope", c.rankScopeTitle, c.rankScopeDesc, rankScopeOf(notes), c.rankScope),
      item("rankBandShow", c.rankShowTitle, c.rankShowDesc, rankBandShowOf(notes), c.rankShow),
      item("peerWait", c.peerWaitTitle, c.peerWaitDesc, onOff(notes.peerWait === true), c.peerWait),
      item("allowApiUsage", t.apiTitle, t.apiDesc, onOff(notes.allowApiUsage !== false), t.onOff),
      item("showB30Analysis", t.analysisSettingTitle, t.analysisSettingDesc, onOff(notes.showB30Analysis !== false), t.onOff),
      item("showTagAnalysis", t.tagSettingTitle, t.tagSettingDesc, onOff(notes.showTagAnalysis !== false), t.onOff),
      item("showRecordStats", c.statsTitle, c.statsDesc, onOff(notes.showRecordStats !== false), t.onOff),
      item("cardQuality", c.qualityTitle, c.qualityDesc, notes.cardQuality === "high" ? "high" : "fast", c.quality),
      item("cardBackground", c.backgroundTitle, c.backgroundDesc, backgroundSong ? "chosen" : "random", background),
      {
        key: "cardStyle",
        title: c.layoutTitle,
        description: c.layoutDesc,
        currentTitle: layouts.filter(l => l.selected).map(l => l.title).join(" · ") || c.styles.classic,
        options: layouts,
      },
    ],
  }
}
