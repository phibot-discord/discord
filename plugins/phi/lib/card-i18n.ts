export const PHI_LOCALES = ["en", "zh"] as const;
export type PhiLocale = (typeof PHI_LOCALES)[number];
const DEFAULT_PHI_LOCALE: PhiLocale = "en";

export function isPhiLocale(v: unknown): v is PhiLocale {
	return v === "en" || v === "zh";
}

export function parsePhiLocale(v: unknown): PhiLocale | undefined {
	if (typeof v !== "string") return;
	const t = v.trim().toLowerCase();
	if (!t) return;
	if (
		t === "zh" ||
		t.startsWith("zh-") ||
		t === "cn" ||
		t === "chinese" ||
		t === "中文"
	)
		return "zh";
	if (t === "en" || t.startsWith("en-") || t === "english") return "en";
}

export function resolvePhiLocale(...candidates: unknown[]): PhiLocale {
	for (const c of candidates) {
		const hit = isPhiLocale(c) ? c : parsePhiLocale(c);
		if (hit) return hit;
	}
	return DEFAULT_PHI_LOCALE;
}

const en = {
	lang: "en",
	noPush: "Can't push",
	accLimited: "ACC is limited to {n}%",
	apMode: "All Perfect Mode",
	/** x30 / fc30 card titles, shown as the classic card's mode chip */
	fcMode: "FC30",
	x30Mode: "x30",
	analysisTitle: "B30 analysis",
	tagAbility: "Chart skills",
	validVotes: "Valid votes",
	tagRecords: "Scores",
	tagBallots: "Votes",
	noData: "No data",
	tagPool: "Pools every score with chart RKS ≥ {threshold}, not the B30 slots.",
	categorySummary: "Categories",
	strongTags: "Strengths",
	weakTags: "Weaknesses",
	tagInsufficient:
		"Not enough valid votes or per-tag score samples. Vote on chart tags at https://www.phib19.top.",
	tagUnavailable:
		"The chart-tag service did not answer in time. Reload the card to try again.",
	tagTip: "Vote on chart tags at https://www.phib19.top.",
	histTitle: "Equivalent RKS histogram",
	avgRks: "Average RKS",
	histY: "Per-chart RKS",
	histSlotsUnit: " slots",
	emptyBio: "This player's bio was eaten by Hu Tao…",
	accFilterHint:
		"RKS after dropping every score whose ACC is below a given value (x-axis).",
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
	tagSettingTitle: "Chart skills",
	tagSettingDesc:
		"Five-axis radar and strong/weak tags on the B30 card. Needs API lookups.",
	langTitle: "Language",
	langDesc: "Web UI and every rendered card. Shared with the Discord bot.",
	theme: {
		default: {
			title: "[0] Default",
			description: "Base theme. Random jacket as background.",
		},
		snow: { title: "[1] Winter", description: "Default plus falling snow." },
		star: {
			title: "[2] One heart spared from sorrow",
			description: "Fireflies over a dreamless night.",
		},
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
};

const zh: typeof en = {
	lang: "zh",
	noPush: "无法推分",
	accLimited: "ACC 限制为 {n}%",
	apMode: "All Perfect 模式",
	fcMode: "FC30",
	x30Mode: "性30",
	analysisTitle: "B30 数据分析",
	tagAbility: "谱面实力分析",
	validVotes: "有效票",
	tagRecords: "成绩",
	tagBallots: "选票",
	noData: "暂无数据",
	tagPool: "统计全部单曲 RKS≥{threshold} 的成绩，而非 B30 槽位",
	categorySummary: "分类汇总",
	strongTags: "擅长词条",
	weakTags: "薄弱词条",
	tagInsufficient:
		"有效选票或逐标签成绩样本不足，请前往 https://www.phib19.top 进行谱面标签投票",
	tagUnavailable: "谱面标签服务暂未响应，请稍后重新生成",
	tagTip: "谱面投票可前往 https://www.phib19.top 提交",
	histTitle: "等效 RKS 直方图",
	avgRks: "平均 RKS",
	histY: "等效单曲 RKS",
	histSlotsUnit: " 个有效槽位",
	emptyBio: "介个人的简介被胡桃吃掉惹……",
	accFilterHint:
		"将您的成绩中所有 ACC【小于某一值(横坐标)】的成绩筛去后计算得到的 RKS 值",
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
	tagSettingTitle: "谱面实力分析",
	tagSettingDesc: "B30 图上的五维雷达和擅长/薄弱词条。",
	langTitle: "语言",
	langDesc: "网页和所有成绩图。和 Discord 机器人共用。",
	theme: {
		default: {
			title: "[0]默认",
			description: "基础主题，使用随机曲绘作为背景。",
		},
		snow: { title: "[1]寒冬", description: "在默认的基础上加入飘落雪花元素。" },
		star: {
			title: "[2]使一颗心免于哀伤",
			description: "飞萤之火自无梦的长夜亮起。",
		},
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
};

type CardCopy = typeof en;

export function cardCopy(locale: PhiLocale): CardCopy {
	return locale === "zh" ? zh : en;
}

const CHART_TAG_EN: Record<string, string> = {
	读谱: "Reading",
	硬抗: "Stamina",
	拆谱: "Pattern",
	定位: "Aim",
	多指: "Multi-Finger",
	差速: "Mixed speed",
	脑裂: "Split-brain",
	多面下落: "Multi-side",
	"变速/闪现": "Flash / BPM Change",
	面海: "Note flood",
	扫线: "Sweep",
	长条藏键: "Hold hide",
	慢流速: "Slow notes",
	非线性下落: "Nonlinear",
	判定线干扰: "Line noise",
	复杂节奏: "Polyrhythm",
	长纵连: "Long jacks",
	"长连点/交互": "Long interaction",
	快交互: "Fast interaction",
	双押海: "Double-tap flood",
	宽排键: "Wide span",
	连点爆发: "Burst",
	全换: "Full switch",
	反手: "Cross-hand",
	锁手: "Locked finger",
	锚键: "Anchor",
	刹车: "Brake",
	频繁切轨: "Lane hop",
	倒打: "Reverse",
	蓝夹黄: "BY sandwich",
	蓝夹红: "BR sandwich",
	浮现式: "Emerge",
	叠: "Stack",
	乱: "Scramble",
	切: "Cut",
	楼梯: "Stairs",
	拍砖: "Bricks",
	对拍: "Alternating",
	对切: "Split cut",
	"3k": "3K",
	"4k": "4K",
	"5k": "5K",
	"6k": "6K",
};

const CHART_TAG_DESC_EN: Record<string, string> = {
	读谱: "Reading-related difficulty",
	差速: "Notes at the same time drop at different speeds (e.g. Temporal Shifting)",
	脑裂: "Multiple judgment lines, or patterns that split attention (e.g. FULI AUTO SHOOTER)",
	"变速/闪现": "Notes change speed while falling, or flash in",
	面海: "All or almost all holds (e.g. ぱぴぷぴぷぴぱ)",
	扫线: "Cytus-like scan-line patterns",
	长条藏键: "Notes sit inside holds, hiding them or forcing a large move",
	非线性下落:
		"Notes do not fall in a straight constant-speed line (e.g. 樱树街道)",
	判定线干扰:
		"Judgment-line shake or move that interferes with sight-reading (e.g. IL-Artifact ending)",
	复杂节奏: "BPM changes or odd meters (e.g. Aleph-0, Opia)",
	硬抗: "Stamina-related difficulty",
	快交互: "Interaction difficulty",
	双押海: "Continuous double-tap streams",
	宽排键: "Notes spread across most of the screen",
	连点爆发: "Burst streams",
	拆谱: "Pattern-reading difficulty",
	全换: "A section that can be fully split into interactions",
	反手: "Hitting across the other hand",
	锁手: "One hand locked by a hold or stream and cannot handle the rest",
	锚键: "Notes fall continuously on a fixed lane (e.g. G.V.N)",
	刹车: "Must stop tapping in time or you will overhit (e.g. jacks into a hold)",
	频繁切轨: "Not fixed-lane; frequent moves or 4-5-6k lane switches",
	浮现式:
		"Patterns that appear on screen and judge when they merge (e.g. delayed stars)",
	多指: "Multi-finger difficulty",
	叠: "Overlapping multi-taps in a short window",
	乱: "Dense stacked stairs that keep changing direction",
	切: "One hand switches fingers; stairs plus multi-taps",
	楼梯: "Taps arranged like stairs",
	拍砖: "Repeated multi-taps on a fixed beat",
	对拍: "Hands alternate fast multi-taps",
	对切: "Both hands mirror or sync finger rolls",
	"3k": "Three-lane patterns",
	"4k": "Four-lane patterns",
	"5k": "Five-lane patterns",
};

export function localizeChartTagName(name: string, locale: PhiLocale): string {
	if (locale !== "en" || !name) return name;
	return CHART_TAG_EN[name] ?? name;
}

export function localizeChartTagDescription(
	name: string,
	description: string | undefined,
	locale: PhiLocale,
): string {
	const src = description?.trim() ?? "";
	if (!src) return "";
	if (locale !== "en") return src;
	return CHART_TAG_DESC_EN[name] ?? src;
}

function withLocalizedName<T extends { name: string }>(
	row: T,
	locale: PhiLocale,
): T {
	return { ...row, name: localizeChartTagName(row.name, locale) };
}

export function localizeChartTagLabels<
	T extends {
		categories: { name: string }[];
		radar: { categories: { name: string }[] };
		strong: { name: string }[];
		weak: { name: string }[];
	},
>(analysis: T, locale: PhiLocale): T {
	if (locale !== "en") return analysis;
	return {
		...analysis,
		categories: analysis.categories.map((row) =>
			withLocalizedName(row, locale),
		),
		radar: {
			...analysis.radar,
			categories: analysis.radar.categories.map((row) =>
				withLocalizedName(row, locale),
			),
		},
		strong: analysis.strong.map((row) => withLocalizedName(row, locale)),
		weak: analysis.weak.map((row) => withLocalizedName(row, locale)),
	};
}

export function fill(
	template: string,
	vars: Record<string, string | number>,
): string {
	let out = template;
	for (const [k, v] of Object.entries(vars))
		out = out.replaceAll(`{${k}}`, String(v));
	return out;
}

type TagPoolInfo = {
	threshold?: number;
	recordCount?: number;
	totalVotes: number;
};

function poolThreshold(analysis: TagPoolInfo | null | undefined) {
	const n = analysis?.threshold;
	return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Tag panel meta line, as upstream b19.art (f908bb31) */
export function tagAnalysisMeta(
	analysis: TagPoolInfo | null | undefined,
	t: CardCopy,
): string {
	if (!analysis) return t.noData;
	const threshold = poolThreshold(analysis);
	if (threshold == null) return `${t.validVotes} ${analysis.totalVotes}`;
	return `RKS≥${threshold.toFixed(1)} · ${t.tagRecords} ${analysis.recordCount ?? 0} · ${t.tagBallots} ${analysis.totalVotes}`;
}

/** Which scores the server pooled; empty when it did not say */
export function tagPoolNote(
	analysis: TagPoolInfo | null | undefined,
	t: CardCopy,
): string {
	const threshold = poolThreshold(analysis);
	return threshold == null
		? ""
		: fill(t.tagPool, { threshold: threshold.toFixed(1) });
}

function isNoPushSuggest(s: string | undefined): boolean {
	if (!s) return true;
	return s === "无法推分" || /^can't push$/i.test(s);
}

export function displaySuggest(
	s: string | number | undefined,
	t: CardCopy,
): string {
	if (s == null || s === -1) return t.noPush;
	const str = String(s);
	return isNoPushSuggest(str) ? t.noPush : str;
}

export function localizeSuggestFields(
	rows: Array<{ suggest?: string } | null | undefined> | undefined,
	t: CardCopy,
) {
	for (const row of rows || []) {
		if (row && typeof row.suggest === "string" && isNoPushSuggest(row.suggest))
			row.suggest = t.noPush;
	}
}
