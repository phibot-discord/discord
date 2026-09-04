const PHI_LOCALES = ["en", "zh"] as const
export type PhiLocale = (typeof PHI_LOCALES)[number]
const DEFAULT_PHI_LOCALE: PhiLocale = "en"

export function isPhiLocale(v: unknown): v is PhiLocale {
  return v === "en" || v === "zh"
}

export function parsePhiLocale(v: unknown): PhiLocale | undefined {
  if (typeof v !== "string") return
  const t = v.trim().toLowerCase()
  if (!t) return
  if (t === "zh" || t.startsWith("zh-") || t === "cn" || t === "chinese" || t === "中文") return "zh"
  if (t === "en" || t.startsWith("en-") || t === "english") return "en"
}

export function resolvePhiLocale(...candidates: unknown[]): PhiLocale {
  for (const c of candidates) {
    const hit = isPhiLocale(c) ? c : parsePhiLocale(c)
    if (hit) return hit
  }
  return DEFAULT_PHI_LOCALE
}

const en = {
  lang: "en",
  noPush: "Can't push",
  accLimited: "ACC is limited to {n}%",
  apMode: "All Perfect Mode",
  fcMode: "Full Combo Mode",
  x30Mode: "1 Good Mode",
  analysisTitle: "B30 analysis",
  tagAbility: "Chart tag profile",
  validVotes: "Votes",
  categorySummary: "Categories",
  strongTags: "Strengths",
  weakTags: "Weaknesses",
  tagInsufficient: "Not enough chart-tag votes. Vote at https://www.phib19.top or with /settag.",
  tagTip: "Tag stats are still thin — vote at https://www.phib19.top or with /settag.",
  histTitle: "Equivalent RKS histogram",
  avgRks: "Average RKS",
  histY: "Per-chart RKS",
  histSlotsUnit: " slots",
  hisb30Tip: "*B30 changes use current constants. Historical constants coming later.",
  emptyBio: "This player's bio was eaten by Hu Tao…",
  accFilterHint: "RKS after dropping every score whose ACC is below a given value (x-axis).",
  currentPrefix: "Now: ",
  selected: "Selected",
  signDaysBefore: "Signed in ",
  signDaysAfter: " days",
  todayLuck: "Today's luck",
  good: "Good",
  bad: "Avoid",
  dailyQuote: "Daily line",
  done: "Done",
  guest: "Guest",
  fortuneTitle: "— Today's fortune —",
  selectedRange: "Selected constant range",
  collectedOn: "Collected",
  keeper: "Keeper",
  grade: "Grade",
  song: "Song",
  duration: "Length",
  difficulty: "Difficulty",
  charter: "Charter",
  chartLength: "Chart length: ",
  shipped: "Release version & date",
  versionPrefix: "Version: v",
  datePrefix: "Date: ",
  constChart: "Constant history",
  taskList: "Phi task list",
  suggestTitle: "Push suggestions",
  rankingTitle: "Ranking Score",
  newSongs: "New songs",
  songName: "Title",
  constant: "Constant",
  combo: "Combo",
  chartEdits: "Constant & chart edits",
  field: "Field",
  status: "Change",
  updatedScores: "Updated {n} scores",
  noNewScores: "No new scores",
  invalidUser: "Invalid user",
  calendarTitle: "{y}-{m}",
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  settingsTitle: "phi settings",
  settingsDesc: "These choices apply to your rendered cards.",
  themeTitle: "Theme",
  themeDesc: "Overall look of rendered pages.",
  avgKindTitle: "B30 stats bar",
  avgKindDesc: "What the B30 average bar shows.",
  avgColorTitle: "B30 bar color",
  avgColorDesc: "Main color of the B30 average bar.",
  apiTitle: "API lookups",
  apiDesc: "Turn off to skip online score lookups.",
  analysisSettingTitle: "B30 analysis",
  analysisSettingDesc: "Equivalent-RKS histogram at the end of the B30 card.",
  tagSettingTitle: "Chart tag profile",
  tagSettingDesc: "Five-axis radar and strong/weak tags on the B30 card. Needs API lookups.",
  langTitle: "Language",
  langDesc: "Web UI and every rendered card. Shared with the Discord bot.",
  theme: {
    default: { title: "[0] Default", description: "Base theme. Random jacket as background." },
    snow: { title: "[1] Winter", description: "Default plus falling snow." },
    star: { title: "[2] One heart spared from sorrow", description: "Fireflies over a dreamless night." },
    dss2: { title: "[3] Masters 2", description: "Season 2 Masters colors." },
  },
  avgKind: {
    all: { title: "[0] All", description: "Average of every score." },
    b30: { title: "[1] B30 only", description: "Average of B30 scores only." },
    top: { title: "[2] Top %", description: "Show rank percentile." },
    none: { title: "[3] Hide", description: "Hide B30 average info." },
  },
  avgColor: {
    red: { title: "[0] Red", description: "High-contrast warm." },
    gold: { title: "[1] Gold", description: "Bright gold." },
    blue: { title: "[2] Blue", description: "Cool palette." },
    green: { title: "[3] Green", description: "Neutral bright." },
  },
  onOff: {
    true: { title: "[0] On", description: "Enable this." },
    false: { title: "[1] Off", description: "Disable this." },
  },
  langOpt: {
    en: { title: "[0] English", description: "English UI and card copy." },
    zh: { title: "[1] 中文", description: "Chinese UI and card copy." },
  },
}

const zh: typeof en = {
  lang: "zh",
  noPush: "无法推分",
  accLimited: "ACC 限制为 {n}%",
  apMode: "All Perfect Mode",
  fcMode: "Full Combo Mode",
  x30Mode: "1 Good Mode",
  analysisTitle: "B30 数据分析",
  tagAbility: "谱面标签能力",
  validVotes: "有效票",
  categorySummary: "分类汇总",
  strongTags: "擅长词条",
  weakTags: "薄弱词条",
  tagInsufficient: "可用谱面标签统计量不足，请前往 https://www.phib19.top 或使用 /settag 进行谱面标签投票",
  tagTip: "当前谱面标签统计量较小，可以前往 https://www.phib19.top 或使用 /settag 指令进行投票哦！",
  histTitle: "等效 RKS 直方图",
  avgRks: "平均 RKS",
  histY: "等效单曲 RKS",
  histSlotsUnit: " 个有效槽位",
  hisb30Tip: "*B30变化仅以当前定数为准，实际历史定数敬请期待",
  emptyBio: "介个人的简介被胡桃吃掉惹……",
  accFilterHint: "将您的成绩中所有 ACC【小于某一值(横坐标)】的成绩筛去后计算得到的 RKS 值",
  currentPrefix: "当前：",
  selected: "已选中",
  signDaysBefore: "累计签到 ",
  signDaysAfter: " 天",
  todayLuck: "今日人品",
  good: "宜",
  bad: "忌",
  dailyQuote: "每日一言",
  done: "已完成",
  guest: "游客玩家",
  fortuneTitle: "——·今日运势·——",
  selectedRange: "已选定数区间",
  collectedOn: "收集日期",
  keeper: "保管单位",
  grade: "等级",
  song: "曲目",
  duration: "时长",
  difficulty: "难度",
  charter: "谱师",
  chartLength: "谱面时长：",
  shipped: "上线版本&日期",
  versionPrefix: "版本: v",
  datePrefix: "日期: ",
  constChart: "定数变化折线图",
  taskList: "Phi-Plugin任务列表",
  suggestTitle: "推分建议",
  rankingTitle: "RankingScore排行榜",
  newSongs: "新曲速递",
  songName: "曲名",
  constant: "定数",
  combo: "物量",
  chartEdits: "定数&谱面修改",
  field: "条目",
  status: "情况",
  updatedScores: "更新了{n}份成绩",
  noNewScores: "未收集到新成绩",
  invalidUser: "无效用户",
  calendarTitle: "{y} 年 {m} 月",
  weekdays: ["一", "二", "三", "四", "五", "六", "日"],
  settingsTitle: "phi 用户设置",
  settingsDesc: "以下选项为你的个人偏好展示，选择结果将用于对应图片渲染。",
  themeTitle: "主题风格",
  themeDesc: "控制图片页面的整体视觉风格。",
  avgKindTitle: "B30统计数据展示",
  avgKindDesc: "控制 B30 均值条展示的数据。",
  avgColorTitle: "B30均值条配色",
  avgColorDesc: "控制 B30 均值条的主色。",
  apiTitle: "API功能开关",
  apiDesc: "关闭后不再使用在线查分相关功能。",
  analysisSettingTitle: "B30统计分析",
  analysisSettingDesc: "控制 B30 图片末尾的等效 RKS 直方图。",
  tagSettingTitle: "谱面标签能力",
  tagSettingDesc: "B30 图上的五维雷达和擅长/薄弱词条。需要开启 API 功能。",
  langTitle: "语言",
  langDesc: "网页和所有成绩图。和 Discord 机器人共用。",
  theme: {
    default: { title: "[0]默认", description: "基础主题，使用随机曲绘作为背景。" },
    snow: { title: "[1]寒冬", description: "在默认的基础上加入飘落雪花元素。" },
    star: { title: "[2]使一颗心免于哀伤", description: "飞萤之火自无梦的长夜亮起。" },
    dss2: { title: "[3]大师赛2", description: "大师赛第二赛季主题配色" },
  },
  avgKind: {
    all: { title: "[0]全部统计", description: "展示全部成绩的平均值统计。" },
    b30: { title: "[1]仅 B30", description: "只按 B30 成绩平均值统计。" },
    top: { title: "[2]仅 Top", description: "展示排名百分比。" },
    none: { title: "[3]隐藏", description: "不展示 B30 均值相关信息。" },
  },
  avgColor: {
    red: { title: "[0]红", description: "高对比暖色。" },
    gold: { title: "[1]金", description: "偏亮金色。" },
    blue: { title: "[2]蓝", description: "冷色调方案。" },
    green: { title: "[3]绿", description: "中性偏亮配色。" },
  },
  onOff: {
    true: { title: "[0]启用", description: "开启该功能。" },
    false: { title: "[1]禁用", description: "关闭该功能。" },
  },
  langOpt: {
    en: { title: "[0] English", description: "英文界面和成绩图。" },
    zh: { title: "[1] 中文", description: "中文界面和成绩图。" },
  },
}

export type CardCopy = typeof en

export function cardCopy(locale: PhiLocale): CardCopy {
  return locale === "zh" ? zh : en
}

export function fill(template: string, vars: Record<string, string | number>): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

function isNoPushSuggest(s: string | undefined): boolean {
  if (!s) return true
  return s === "无法推分" || /^can't push$/i.test(s)
}

export function displaySuggest(s: string | number | undefined, t: CardCopy): string {
  if (s == null || s === -1) return t.noPush
  const str = String(s)
  return isNoPushSuggest(str) ? t.noPush : str
}

export function localizeSuggestFields(rows: Array<{ suggest?: string } | null | undefined> | undefined, t: CardCopy) {
  for (const row of rows || []) {
    if (row && typeof row.suggest === "string" && isNoPushSuggest(row.suggest)) row.suggest = t.noPush
  }
}
