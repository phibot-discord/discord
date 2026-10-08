/** "Table" layout for b30 / x30 / fc30: prepare() makes display-ready rows so the template only prints */
import { cardCopy, type PhiLocale } from "../card-i18n.ts";
import { fCompute } from "../fcompute.ts";
import { fitEm, splitTwoLines, textEm } from "../text-fit.ts";
import {
	type FittedTip,
	fitTip,
	pickTip,
	type RankParts,
	rankLines,
} from "./b19-common.ts";
import type { CardData, CardVariant, VariantContext } from "./types.ts";

const WIDTH = 1200;

/**
 * Song column width (CSS px) with and without the push column, less ~3% slack for
 * the text-fit estimate; the columns are 326 / 440 px in b19-table.css
 */
export const TITLE_W = { push: 316, wide: 428 };
const TITLE_MAX_PX = 18;
const TITLE_ONE_LINE_MIN_PX = 14;
const TITLE_MIN_PX = 12;
/**
 * Player name box less slack: ~544px beside the C / FC / Phi table; without it the
 * badges take the right edge, and a long data size ("1TiB 2GiB …") can claim 300px
 */
export const NAME_W = { stats: 520, wide: 580 };
const NAME_MAX_PX = 40;
const NAME_MIN_PX = 16;
/** Tip text box (820px in b19-table.css) less slack */
const TIP_W = 800;
/** Tip sizes, largest first; the footer holds two lines of any of them */
const TIP_PX = [15, 14, 13];
/**
 * The rank line hangs under the acc and may reach left under the score: the acc
 * (106px) and score (96px) cells and the 14px gap between them, less slack
 */
const RANK_W = 204;
const RANK_PX = [12, 11, 10];
/** The ±0.05 line beside it: under the RKS (92px) and push (100px) cells and their gap, less slack */
const RANK_SIDE_W = 196;
/** Gaps after "±0.05", after "#3,611" and before "Top 5.1%" (.tbl-rank-tag / -of / -pct margins) */
const RANK_GAP = { tag: 5, of: 4, pct: 8 };
/** Histogram geometry; see .tbl-hist in b19-table.css */
export const HIST = { plotH: 180, gutter: 56, fullW: 1104, tagsW: 640 };
const TAG_LIST_MAX = 5;
/** Name cell in a strong / weak tag list (440px panel, two columns), less slack */
const TAG_NAME_W = 124;
/** Peer-average line under the acc (106px cell) less slack */
const AVG_W = 104;
const AVG_MAX_PX = 12;
const AVG_MIN_PX = 10;

const COPY = {
	en: {
		title: { b30: "Best 30", x30: "x30", fc30: "FC30" },
		desc: {
			b30: "3 Phi charts + Best 27 make up your RKS",
			x30: "",
			fc30: "",
		},
		saved: "Save date",
		rks: "RKS",
		/** The spread of the B30 behind the RKS (b30 only) */
		sdB30: "B30 SD",
		mode: {
			x30: "x30",
			fc30: "FC30",
			ap: "All Perfect Mode",
		},
		statClear: "Clear",
		statFc: "FC",
		statPhi: "Phi",
		colRank: "#",
		colSong: "Song",
		colLevel: "Level",
		colScore: "Score",
		colAcc: "Acc",
		colRks: "RKS",
		colPush: "Push acc",
		avgAll: "peer avg",
		avgB30: "B30 avg",
		avgTop: "top % · all / B30",
		avgRank: "Rank",
		/** Push target colours, easiest first (pushTier) */
		pushKey: { easy: "easy", mid: "mid", hard: "hard" },
		bandPhi: "Phi · P1–P3",
		bandPhiDesc: "Your best All Perfect charts",
		bandBest: "Best 27",
		bandBestDesc: "Highest single-chart RKS",
		emptyPhi: "No Phi chart yet",
		overflow: "Overflow",
		overflowB30: "Not counted toward RKS",
		overflowTop: "Below the top 30",
		filled: "{n} of {cap} slots filled",
		noRows: "No matching scores yet",
		analysis: "Analysis",
		distribution: "RKS distribution",
		stddev: "Std dev",
		avgTag: "AVG",
		legendOf: "{range} of top {n}",
		tip: "Tip",
		generated: "Generated",
	},
	zh: {
		title: { b30: "Best 30 成绩", x30: "性30", fc30: "FC30" },
		desc: {
			b30: "3 个 Phi 谱面 + 最佳 27 构成你的 RKS",
			x30: "",
			fc30: "",
		},
		saved: "存档时间",
		rks: "RKS",
		sdB30: "B30 标准差",
		mode: {
			x30: "性30",
			fc30: "FC30",
			ap: "All Perfect 模式",
		},
		statClear: "通过",
		statFc: "FC",
		statPhi: "Phi",
		colRank: "#",
		colSong: "曲目",
		colLevel: "难度",
		colScore: "分数",
		colAcc: "ACC",
		colRks: "RKS",
		colPush: "推分 ACC",
		avgAll: "玩家均值",
		avgB30: "B30 均值",
		avgTop: "前 % · 全部 / B30",
		avgRank: "名次",
		pushKey: { easy: "易", mid: "中", hard: "难" },
		bandPhi: "Phi · P1–P3",
		bandPhiDesc: "最高的 AP 谱面",
		bandBest: "Best 27",
		bandBestDesc: "单曲 RKS 最高的 27 张",
		emptyPhi: "暂无 Phi 谱面",
		overflow: "溢出",
		overflowB30: "不计入 RKS",
		overflowTop: "前 30 之外",
		filled: "已填充 {n} / {cap}",
		noRows: "暂无符合条件的成绩",
		analysis: "数据分析",
		distribution: "RKS 分布",
		stddev: "标准差",
		avgTag: "平均",
		legendOf: "前 {n} 中的 {range}",
		tip: "提示",
		generated: "生成于",
	},
} satisfies Record<PhiLocale, unknown>;

export type TableCopy = (typeof COPY)["en"];
type TableKind = keyof TableCopy["title"];

export function tableCopy(locale: PhiLocale): TableCopy {
	return COPY[locale] ?? COPY.en;
}

type LooseRow = {
	song?: unknown;
	rank?: unknown;
	difficulty?: unknown;
	rks?: unknown;
	score?: unknown;
	acc?: unknown;
	Rating?: unknown;
	illustration?: unknown;
	suggest?: unknown;
	accAvg?: unknown;
	accRank?: unknown;
	accRanks?: unknown;
};

const GRADES = new Set(["phi", "FC", "V", "S", "A", "B", "C", "F", "NEW"]);
const LEVELS = new Set(["EZ", "HD", "IN", "AT", "LEGACY"]);

function num(v: unknown, fallback = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function fill(template: string, vars: Record<string, string | number>) {
	return template.replace(/\{(\w+)\}/g, (m, k: string) =>
		k in vars ? String(vars[k]) : m,
	);
}

/** Score as the game shows it: 7 digits, the leading zeros split off to be dimmed */
export function paddedScore(score: unknown): { lead: string; rest: string } {
	const n = Math.min(1_000_000, Math.max(0, Math.round(num(score))));
	const rest = String(n);
	return { lead: "0".repeat(7 - rest.length), rest };
}

/** Cut `text` so it (plus "…") fits in `maxEm` ems; unchanged when it already fits */
export function truncateEm(text: string, maxEm: number): string {
	if (textEm(text) <= maxEm) return text;
	const chars = [...text];
	let em = textEm("…");
	let end = 0;
	while (end < chars.length && em + textEm(chars[end]!) <= maxEm) {
		em += textEm(chars[end]!);
		end++;
	}
	return `${chars.slice(0, end).join("").trimEnd()}…`;
}

export type FittedTitle = { lines: string[]; px: number; clip: boolean };

/** One line if it fits at ≥ 14px, else two balanced lines, else 2 clamped lines */
export function fitTitle(title: string, widthPx: number): FittedTitle {
	const text = title.trim() || "—";
	const one = fitEm(textEm(text), widthPx, TITLE_MAX_PX);
	if (one >= TITLE_ONE_LINE_MIN_PX)
		return { lines: [text], px: one, clip: false };
	const [a, b] = splitTwoLines(text);
	if (!b)
		return {
			lines: [text],
			px: Math.max(one, TITLE_MIN_PX),
			clip: one < TITLE_MIN_PX,
		};
	const two = fitEm(Math.max(textEm(a), textEm(b)), widthPx, TITLE_MAX_PX);
	if (two >= TITLE_MIN_PX) return { lines: [a, b], px: two, clip: false };
	// Last resort: two wrapped lines at the minimum size, ending in "…"
	const budget = (widthPx / TITLE_MIN_PX) * 1.85;
	return { lines: [truncateEm(text, budget)], px: TITLE_MIN_PX, clip: true };
}

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Plain-text lines of a rich-text player name (convertRichText output) */
export function richTextLines(html: string): string[] {
	return decodeEntities(
		html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
	)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export function fitName(
	html: string,
	widthPx: number,
): { px: number; clip: boolean } {
	const lines = richTextLines(html);
	if (!lines.length) return { px: NAME_MAX_PX, clip: false };
	const max = lines.length > 1 ? 28 : NAME_MAX_PX;
	// <b> is synthesized bold, ~10% wider than text-fit's regular widths
	const bold = /<b>/i.test(html) ? 1.1 : 1;
	const px = fitEm(Math.max(...lines.map(textEm)) * bold, widthPx, max);
	return px < NAME_MIN_PX
		? { px: NAME_MIN_PX, clip: true }
		: { px, clip: false };
}

export type PeerAvg = {
	dir: "up" | "down" | "";
	/** One line: it hangs under the centred acc, so the row keeps one number line */
	text: string;
	/** True for a plain "98.1234%"; false for the "top" / "rank" text forms */
	isNum: boolean;
	px: number;
};

/** First candidate that fits `widthPx` at ≥ 10px, else the last one cut with "…" */
function fitPeerText(candidates: string[], widthPx: number) {
	for (const text of candidates) {
		const px = fitEm(textEm(text), widthPx, AVG_MAX_PX);
		if (px >= AVG_MIN_PX) return { text, px };
	}
	const last = candidates.at(-1) || "";
	return {
		text: truncateEm(last, widthPx / AVG_MIN_PX),
		px: AVG_MIN_PX,
	};
}

/** Peer figure by b30AvgKind (formats in score-avg.ts); a narrow cell drops "/ total", then the rank */
export function peerAvg(
	accAvg: unknown,
	acc: number,
	widthPx = AVG_W,
): PeerAvg | undefined {
	if (accAvg == null || accAvg === "") return;
	const raw = typeof accAvg === "number" ? `${accAvg}` : str(accAvg).trim();
	if (!raw) return;
	const m = /^(?:B?Avg:\s*)?(\d+(?:\.\d+)?)%?$/i.exec(raw);
	if (m) {
		const value = Number(m[1]);
		return {
			dir: acc >= value ? "up" : "down",
			text: `${value.toFixed(4)}%`,
			isNum: true,
			px: AVG_MAX_PX,
		};
	}
	const top = /^Top\s+(\S+%)\s*\/\s*(\S+%)$/i.exec(raw);
	const rank = /^(#[\d,]+)\s*(\/\s*[\d,]+)\s*·\s*(Top\s+\S+%)$/i.exec(raw);
	const candidates = top
		? [`${top[1]} / ${top[2]}`]
		: rank
			? [
					`${rank[1]} ${rank[2]} · ${rank[3]}`,
					`${rank[1]} · ${rank[3]}`,
					rank[3]!,
				]
			: [raw.replace(/\s+/g, " ")];
	return { dir: "", isNum: false, ...fitPeerText(candidates, widthPx) };
}

/** Column sub-label for the peer figure, from the first row that has one */
export function avgLabel(
	rows: { accAvg?: unknown; accRank?: unknown; accRanks?: unknown }[],
	copy: TableCopy,
): string {
	if (rows.some((r) => rankLines(r).length)) return copy.avgRank;
	const sample = rows.map((r) => str(r.accAvg).trim()).find(Boolean) || "";
	if (/^#/.test(sample)) return copy.avgRank;
	if (/^top/i.test(sample)) return copy.avgTop;
	if (/^bavg/i.test(sample)) return copy.avgB30;
	return copy.avgAll;
}

export type TableRank = RankParts & { px: number; showOf: boolean };

/**
 * A rank line by the acc ("rank" mode): "#3,611 / 70,388" then "Top 5.1%"
 * at 12 down to 10px; without the record count when even 10px is too wide
 */
export function fitRank(parts: RankParts, widthPx = RANK_W): TableRank {
	// A ±0.05 badge may show only the place or only the share
	const lineW = (px: number, withOf: boolean) =>
		(parts.tag ? textEm(parts.tag) * px + RANK_GAP.tag : 0) +
		// The position is bold: ~10% wider than text-fit's regular widths
		textEm(parts.pos) * px * 1.1 +
		(withOf ? RANK_GAP.of + textEm(parts.of) * px : 0) +
		(parts.pct ? (parts.pos ? RANK_GAP.pct : 0) + textEm(parts.pct) * px : 0);
	const showOf = Boolean(parts.of);
	for (const px of RANK_PX)
		if (lineW(px, showOf) <= widthPx) return { ...parts, px, showOf };
	return { ...parts, px: RANK_PX[RANK_PX.length - 1]!, showOf: false };
}

function levelClass(rank: string) {
	return LEVELS.has(rank) ? rank.toLowerCase() : "unknown";
}

/**
 * How hard the push is, from the target acc (coarser than save.ts suggestType):
 * below 99.5% "easy", below 99.85% "mid", else "hard" (near or at All Perfect)
 */
export function pushTier(push: string): "easy" | "mid" | "hard" | "" {
	const value = Number.parseFloat(push);
	if (!Number.isFinite(value)) return "";
	return value < 99.5 ? "easy" : value < 99.85 ? "mid" : "hard";
}

/** Server mode labels (cards.ts spInfo: cardCopy x30Mode / fcMode / apMode) */
const MODE_LABELS = [
	...(["en", "zh"] as const).flatMap((locale) => {
		const t = cardCopy(locale);
		return [
			[t.x30Mode, "x30"],
			[t.fcMode, "fc30"],
			[t.apMode, "ap"],
		] as const;
	}),
	// The older long labels
	["1 Good Mode", "x30"],
	["1 Good 模式", "x30"],
	["Full Combo Mode", "fc30"],
	["Full Combo 模式", "fc30"],
] as const;

/** spInfo chips in the card's language, minus the card's own mode and the rank legend */
export function chipTexts(
	spInfo: unknown,
	copy: TableCopy,
	kind: TableKind = "b30",
): string[] {
	if (!Array.isArray(spInfo)) return [];
	return spInfo
		.map((raw) => str(raw).trim())
		.filter(Boolean)
		.flatMap((text) => {
			const known = MODE_LABELS.find(([label]) => label === text);
			if (!known) return [text];
			return known[1] === kind ? [] : [copy.mode[known[1]]];
		});
}

export type TableRow = {
	type: "row";
	cls: string;
	rankPre: string;
	rankNum: string;
	empty: boolean;
	ill: string;
	lines: string[];
	titlePx: number;
	titleClip: boolean;
	level: string;
	lv: string;
	constant: string;
	grade: string;
	scoreLead: string;
	score: string;
	acc: string;
	/** acc is 100%: drawn in the φ gold */
	accAp: boolean;
	rks: string;
	/** Target acc ("99.7576%") or "" when there is none */
	push: string;
	/** pushTier(push): tints the target by how hard it is */
	pushTier: string;
	/** "Can't push" (localized) when `push` is empty */
	pushText: string;
	avg?: PeerAvg;
	/** Peer rank ("rank" mode), shown instead of `avg`, under the acc */
	peerRank?: TableRank;
	/** With both populations, the ±0.05 rank: on the same line, under the RKS and push columns */
	peerRankSide?: TableRank;
};

export type TableItem =
	| TableRow
	| { type: "band"; cls: string; label: string; desc: string }
	| { type: "divider"; label: string; desc: string }
	| { type: "note"; text: string };

function songRow(
	row: LooseRow,
	opts: {
		phi: boolean;
		index: number;
		over: boolean;
		zebra: boolean;
		titleW: number;
		noPush: string;
	},
): TableRow {
	const rank = str(row.rank);
	const acc = num(row.acc);
	const score = paddedScore(row.score);
	const title = fitTitle(str(row.song), opts.titleW);
	const suggest = str(row.suggest).trim();
	const pushable = /^\d+(?:\.\d+)?%$/.test(suggest);
	const grade = str(row.Rating);
	const ranks = rankLines(row);
	const cls = [
		opts.phi ? "is-phi" : "",
		opts.over ? "is-over" : "",
		opts.zebra ? "is-alt" : "",
	]
		.filter(Boolean)
		.join(" ");
	return {
		type: "row",
		cls,
		rankPre: opts.phi ? "P" : "#",
		rankNum: String(opts.index + 1),
		empty: false,
		ill: str(row.illustration),
		lines: title.lines,
		titlePx: title.px,
		titleClip: title.clip,
		level: rank || "?",
		lv: levelClass(rank),
		constant: num(row.difficulty).toFixed(1),
		grade: GRADES.has(grade) ? grade : "",
		scoreLead: score.lead,
		score: score.rest,
		acc: `${acc.toFixed(4)}%`,
		accAp: acc >= 100,
		rks: num(row.rks).toFixed(4),
		push: pushable ? suggest : "",
		pushTier: pushable ? pushTier(suggest) : "",
		pushText: pushable ? "" : opts.noPush,
		...(ranks.length
			? {
					peerRank: fitRank(ranks[0]!),
					...(ranks[1] ? { peerRankSide: fitRank(ranks[1], RANK_SIDE_W) } : {}),
				}
			: { avg: peerAvg(row.accAvg, acc) }),
	};
}

function emptyPhiRow(index: number, zebra: boolean, label: string): TableRow {
	return {
		type: "row",
		cls: `is-phi is-empty${zebra ? " is-alt" : ""}`,
		rankPre: "P",
		rankNum: String(index + 1),
		empty: true,
		ill: "",
		lines: [label],
		titlePx: 16,
		titleClip: false,
		level: "",
		lv: "none",
		constant: "",
		grade: "",
		scoreLead: "",
		score: "",
		acc: "",
		accAp: false,
		rks: "",
		push: "",
		pushTier: "",
		pushText: "",
	};
}

export function tableItems(
	data: { phi?: unknown; b19_list?: unknown },
	kind: TableKind,
	copy: TableCopy,
	noPush: string,
): {
	items: TableItem[];
	rows: LooseRow[];
	hasPush: boolean;
	/** Rows above the Overflow line (#1…#27 on b30, #1…#30 otherwise) */
	mainCount: number;
} {
	const hasPhi = kind === "b30" && Array.isArray(data.phi);
	const hasPush = kind === "b30";
	const titleW = hasPush ? TITLE_W.push : TITLE_W.wide;
	const phi = hasPhi ? (data.phi as unknown[]).slice(0, 3) : [];
	const best = (Array.isArray(data.b19_list) ? data.b19_list : []).filter(
		(r): r is LooseRow => Boolean(r && typeof r === "object"),
	);
	const cutoff = hasPhi ? 27 : 30;
	const items: TableItem[] = [];
	const rows: LooseRow[] = [];
	if (hasPhi) {
		items.push({
			type: "band",
			cls: "is-phi",
			label: copy.bandPhi,
			desc: copy.bandPhiDesc,
		});
		for (let i = 0; i < 3; i++) {
			const row = phi[i];
			if (row && typeof row === "object") {
				rows.push(row as LooseRow);
				items.push(
					songRow(row as LooseRow, {
						phi: true,
						index: i,
						over: false,
						zebra: i % 2 === 1,
						titleW,
						noPush,
					}),
				);
			} else items.push(emptyPhiRow(i, i % 2 === 1, copy.emptyPhi));
		}
		items.push({
			type: "band",
			cls: "is-best",
			label: copy.bandBest,
			desc: copy.bandBestDesc,
		});
	}
	best.forEach((row, i) => {
		if (i === cutoff)
			items.push({
				type: "divider",
				label: copy.overflow,
				desc: hasPhi ? copy.overflowB30 : copy.overflowTop,
			});
		rows.push(row);
		const over = i >= cutoff;
		items.push(
			songRow(row, {
				phi: false,
				index: i,
				over,
				zebra: (over ? i - cutoff : i) % 2 === 1,
				titleW,
				noPush,
			}),
		);
	});
	if (!best.length) items.push({ type: "note", text: copy.noRows });
	else if (best.length < cutoff)
		items.push({
			type: "note",
			text: fill(copy.filled, { n: best.length, cap: cutoff }),
		});
	return { items, rows, hasPush, mainCount: Math.min(best.length, cutoff) };
}

type HistogramIn = {
	slots?: {
		label?: unknown;
		rks?: unknown;
		kind?: unknown;
		height?: unknown;
	}[];
	ticks?: { label?: unknown; position?: unknown }[];
	average?: unknown;
	stddev?: unknown;
	averagePosition?: unknown;
	count?: unknown;
};

type TagIn = { name?: unknown; rks?: unknown };

type AnalysisIn = {
	histogram?: HistogramIn;
	showTags?: unknown;
	/** Localized "RKS≥x · Scores n · Votes m" line (tagAnalysisMeta) */
	tagMeta?: unknown;
	/** Which scores the tag server pooled (tagPoolNote); may be empty */
	tagPoolNote?: unknown;
	/** "Not enough votes" or "service did not answer" (cards.ts b30AnalysisFor) */
	tagMessage?: unknown;
	tagAnalysis?: {
		totalVotes?: unknown;
		strong?: TagIn[];
		weak?: TagIn[];
		insufficient?: unknown;
	} | null;
};

function tagList(list: TagIn[] | undefined) {
	return (Array.isArray(list) ? list : [])
		.filter((tag) => tag && str(tag.name))
		.slice(0, TAG_LIST_MAX)
		.map((tag, i) => ({
			rank: String(i + 1),
			name: str(tag.name),
			rks: num(tag.rks).toFixed(2),
		}));
}

/** One font size for every tag name (the longest decides), never below 12px */
export function tagFontPx(names: string[]): number {
	const em = Math.max(0, ...names.map(textEm));
	return Math.max(12, fitEm(em, TAG_NAME_W, 15));
}

export type AnalysisCopy = {
	slotsUnit: string;
	validVotes: string;
	tagInsufficient: string;
};

/** Histogram bars, ticks and the optional strong / weak tag lists, all in px */
export function analysisView(
	raw: unknown,
	opts: {
		hasPhi: boolean;
		copy: TableCopy;
		t: AnalysisCopy;
		/** Rows above the Overflow line; defaults to the histogram's own count */
		mainCount?: number;
	},
) {
	if (!raw || typeof raw !== "object") return null;
	const a = raw as AnalysisIn;
	const h = a.histogram || {};
	const slots = Array.isArray(h.slots) ? h.slots : [];
	if (!slots.length) return null;
	const showTags = a.showTags === true;
	const plotW = (showTags ? HIST.tagsW : HIST.fullW) - HIST.gutter;
	const bestSlots = slots.filter((slot) => slot.kind !== "phi").length;
	// getB30AnalysisRecords charts at most #1–#27; x30 / fc30 show 30 main rows, so
	// a full list can have rows the histogram leaves out. Pad only a short list
	const truncated = !opts.hasPhi && bestSlots < (opts.mainCount ?? 0);
	// Fixed capacity so a sparse x30 reads as "2 of 30 filled", not two giant bars
	const cap = truncated ? slots.length : Math.max(slots.length, 30);
	const slotW = Math.floor((plotW / cap) * 100) / 100;
	const barW = Math.max(6, Math.min(24, Math.round(slotW * 0.62)));
	const px = (pct: unknown) =>
		Math.round((Math.min(100, Math.max(0, num(pct))) / 100) * HIST.plotH);
	const bars = slots.map((slot) => {
		const phi = slot.kind === "phi";
		const label = str(slot.label);
		return {
			cls: phi ? "is-phi" : "is-best",
			h: Math.max(3, px(slot.height)),
			label: phi ? label : label.replace(/^B/, ""),
		};
	});
	for (let i = slots.length; i < cap; i++)
		bars.push({ cls: "is-empty", h: 2, label: "" });
	const hasPhiBars = bars.some((b) => b.cls === "is-phi");
	const bestRange = `#1–#${bestSlots}`;
	const legend = [
		...(hasPhiBars ? [{ cls: "is-phi", text: "P1–P3" }] : []),
		{
			cls: "is-best",
			text: truncated
				? fill(opts.copy.legendOf, { range: bestRange, n: opts.mainCount ?? 0 })
				: bestRange,
		},
	];
	const ta = a.tagAnalysis;
	const strong = tagList(ta?.strong);
	const weak = tagList(ta?.weak);
	const insufficient = !ta || ta.insufficient === true;
	const tags = showTags
		? {
				meta:
					str(a.tagMeta).trim() ||
					(ta ? `${opts.t.validVotes} ${Math.round(num(ta.totalVotes))}` : ""),
				strong,
				weak,
				px: tagFontPx([...strong, ...weak].map((tag) => tag.name)),
				insufficient,
				message: insufficient
					? str(a.tagMessage).trim() || opts.t.tagInsufficient
					: "",
				note: insufficient ? "" : str(a.tagPoolNote).trim(),
			}
		: null;
	return {
		title: opts.hasPhi ? opts.copy.analysis : opts.copy.distribution,
		average: num(h.average).toFixed(4),
		stddev: num(h.stddev).toFixed(4),
		count: `${Math.round(num(h.count, slots.length))}${opts.t.slotsUnit}`,
		plotW,
		slotW,
		barW,
		bars,
		ticks: (Array.isArray(h.ticks) ? h.ticks : []).map((tick) => ({
			label: str(tick.label),
			bottom: px(tick.position),
		})),
		avgBottom: px(h.averagePosition),
		legend,
		tags,
	};
}

/**
 * Footer tip: one or two lines at 15 down to 13px, ellipsized at 13px. Broken in
 * prepare(), not by a CSS line clamp (which puts every emoji on its own line)
 */
export function tipView(tip: string): FittedTip {
	return fitTip(tip, TIP_W, TIP_PX, 2);
}

/** Push target colour key under the column header, when a row has a target */
export function pushKey(items: TableItem[], copy: TableCopy) {
	const tiers = (["easy", "mid", "hard"] as const).filter((tier) =>
		items.some((it) => it.type === "row" && it.pushTier === tier),
	);
	return tiers.length
		? (["easy", "mid", "hard"] as const).map((tier, i) => ({
				tier,
				text: copy.pushKey[tier],
				sep: i > 0,
			}))
		: [];
}

function tableKind(kind: string): TableKind {
	return kind === "x30" || kind === "fc30" ? kind : "b30";
}

export function prepareTable(
	data: CardData,
	ctx: Pick<VariantContext, "kind" | "locale"> & { tips?: string[] },
	now = new Date(),
) {
	const kind = tableKind(
		typeof data.cardKind === "string" ? data.cardKind : ctx.kind,
	);
	const copy = tableCopy(ctx.locale);
	const t = cardCopy(ctx.locale);
	const user = (data.gameuser || {}) as Record<string, unknown>;
	const stats = (Array.isArray(data.stats) ? data.stats : []) as Record<
		string,
		unknown
	>[];
	const showStats = data.hideRecordStats !== true && stats.length > 0;
	const nameHtml = str(user.PlayerId).trim() || escapeHtml(t.guest);
	const name = fitName(nameHtml, showStats ? NAME_W.stats : NAME_W.wide);
	const challengeRank = Math.round(num(user.ChallengeModeRank));
	const dataText = str(user.data).trim();
	const sd = num(data.rksStddev);
	const { items, rows, hasPush, mainCount } = tableItems(
		data,
		kind,
		copy,
		t.noPush,
	);
	const hasAvg = rows.some(
		(r) => rankLines(r).length || (r.accAvg != null && r.accAvg !== ""),
	);
	const hasPhi = kind === "b30" && Array.isArray(data.phi);
	return {
		kind,
		copy,
		title: copy.title[kind],
		desc: copy.desc[kind],
		chips: chipTexts(data.spInfo, copy, kind),
		saved: str(data.Date),
		avatar: str(user.avatar),
		nameHtml,
		namePx: name.px,
		nameClip: name.clip,
		rks: num(user.rks).toFixed(4),
		// x30 / fc30 show their spread in the analysis panel: beside the RKS it would read as the B30's
		sd: kind === "b30" && sd > 0 ? `±${sd.toFixed(2)}` : "",
		sdLabel: copy.sdB30,
		challenge:
			challengeRank > 0
				? { mode: Math.round(num(user.ChallengeMode)), rank: challengeRank }
				: null,
		dataText: dataText && dataText !== "0KiB" ? dataText : "",
		stats: showStats
			? stats.slice(0, 4).map((s) => ({
					title: str(s.title),
					lv: levelClass(str(s.title)),
					cleared: String(Math.round(num(s.cleared))),
					fc: String(Math.round(num(s.fc))),
					phi: String(Math.round(num(s.phi))),
				}))
			: [],
		hasPush,
		pushKey: hasPush ? pushKey(items, copy) : [],
		hasAvg,
		avgLabel: hasAvg ? avgLabel(rows, copy) : "",
		items,
		analysis: analysisView(data.b30Analysis, {
			hasPhi,
			mainCount,
			copy,
			t: {
				slotsUnit: t.histSlotsUnit,
				validVotes: t.validVotes,
				tagInsufficient: t.tagInsufficient,
			},
		}),
		tagCopy: {
			title: t.tagAbility,
			strong: t.strongTags,
			weak: t.weakTags,
			tip: t.tagTip,
			histTitle: t.histTitle,
			avgRks: t.avgRks,
		},
		tip: tipView(pickTip(data.tips, ctx.tips)),
		generated: fCompute.formatDate(now, "YYYY/MM/DD hh:mm"),
	};
}

export const variant: CardVariant = {
	tpl: "b19-table",
	width: WIDTH,
	prepare: (data, ctx) => ({
		...data,
		bt: prepareTable(data, { ...ctx, tips: ctx.catalog?.tips }),
	}),
};
