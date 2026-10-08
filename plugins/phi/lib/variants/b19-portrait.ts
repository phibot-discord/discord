/**
 * "Phone" layout for b30 / x30 / fc30: one chart per row on a 640 px card
 * prepare() derives everything the template prints (`pv`) and its copy (`vt`)
 */
import type { CardKind } from "../../../../src/card-kinds.ts";
import { cardCopy, type PhiLocale } from "../card-i18n.ts";
import { fitEm, textEm } from "../text-fit.ts";
import {
	type FittedTip,
	fitTip,
	pickTip,
	type RankParts,
	rankLines,
} from "./b19-common.ts";
import type { CardData, CardVariant, VariantContext } from "./types.ts";

/** Card geometry in CSS px; keep in sync with b19-portrait.css */
export const GEOMETRY = {
	cardW: 640,
	/** Player-name box: 600 px content minus the 132 px avatar and its 20 px gap */
	nameW: 448,
	/** Inner width of a chart row's text column (600 - 156 jacket - 16 - 18 padding) */
	infoW: 410,
	/** Font sizes on the third row line (accuracy, push target / peer average) */
	accPx: 22,
	pushPx: 20,
	/** Push marker plus its gap; peer arrow plus its gap; gap between items */
	pushMarkW: 16,
	peerMarkW: 17,
	metaGap: 12,
	/** Horizontal padding of the peer-average badge */
	peerPadW: 16,
	/** Histogram plot area inside the analysis panel */
	plotW: 496,
	plotH: 184,
	/** Histogram x-label box, centred under its bar */
	xLabelW: 60,
	/** Inner width of an analysis panel (600 - 2 x 20 padding) */
	panelW: 560,
	/** Tag-name text width in the strengths / weaknesses columns (the CSS box is 176 px) */
	tagNameW: 172,
	/** Difficulty chip text box on the jacket (the jacket's slant limits it) */
	chipTextW: 114,
	/** Header kicker: content width, gap between chips, mode-chip padding */
	kickerW: 600,
	kickerGap: 12,
	chipPadW: 36,
	/** Card-title chip: 22 px bold, 3 px letter-spacing, 40 px padding */
	kindPx: 22,
	kindTrackPx: 3,
	kindPadW: 40,
	/** Rank line: gap after "±0.05", between "#3,611" and "/ 70,388", then before the share */
	rankTagGapW: 8,
	rankGapW: 6,
	rankPctGapW: 14,
	/** Tip text box in the footer (600 - 36 padding - label - 14 gap) */
	tipW: 480,
} as const;

const TITLE_MAX_PX = 30;
const TITLE_MIN_PX = 28;
/**
 * Two-line titles may go a little smaller than one-line ones: 26 px on this
 * 640 px card is still larger on a phone than 28 px on a 720 px card
 */
const TITLE_TWO_MIN_PX = 26;
const NAME_MAX_PX = 42;
const NAME_MIN_PX = 28;
const NAME_WRAP_MAX_PX = 32;
const NAME_WRAP_MIN_PX = 22;
const SMALL_MAX_PX = 20;
const SMALL_MIN_PX = 18;
const CHIP_MAX_PX = 22;
/** text-fit is calibrated for weight 400; synthesized bold and kerning drift need slack */
const SLACK = 0.95;
const BOLD_SLACK = 0.88;

const RATINGS = new Set(["phi", "V", "S", "A", "B", "C", "F", "FC", "NEW"]);
const RANKS = new Set(["EZ", "HD", "IN", "AT", "LEGACY"]);

/**
 * Block heights in CSS px for the height estimate, measured on renders; keep in
 * sync with b19-portrait.css. `rows.compact` is the `.is-compact` chart row
 */
const HEIGHTS = {
	/** Header top padding, kicker line and wrap gap, id block top margin */
	headTop: 28,
	kickerLine: 36,
	kickerGap: 10,
	idTop: 20,
	avatar: 132,
	rksLine: 66,
	meta: 68,
	stats: 170,
	listTop: 24,
	legend: 28,
	empty: 64,
	overflow: 88,
	none: 120,
	/** Analysis: margin, heading and gap; summary panel; histogram and legend */
	analysisHead: 77,
	summary: 114,
	histogram: 266,
	/** Tag panel: gap, padding, heading; column top; one tag row; note line */
	tagsTop: 77,
	tagsMeta: 28,
	tagsCols: 54,
	tagRow: 36,
	noteLine: 27,
	foot: 158,
	/**
	 * Chart rows: min-height, padding plus score and meta lines, the rank line,
	 * list gap, title line-height
	 */
	rows: {
		normal: { min: 112, base: 80, rank: 26, gap: 6, lh: 1.1 },
		compact: { min: 104, base: 66, rank: 24, gap: 3, lh: 1.05 },
	},
};
/** Tip sizes, largest first; the footer holds two lines of any of them */
const TIP_PX = [22, 20, 18];
const RANK_PX = [20, 18];
/**
 * Paint stays 2x while 640 x height x 4 <= 16 Mi pixels (6553 px). The estimate
 * leaves room for the 24-64 px of measure slack and its own error
 */
const SHARP_MAX_H = 6460;

const COPY = {
	en: {
		kindTitle: { b30: "BEST 30", x30: "x30", fc30: "FC30" },
		rks: "RKS",
		statsRows: ["Clear", "FC", "Phi"],
		legendScore: "Score · Acc",
		legendScorePeer: "Score · Acc · Peers",
		legendScoreRank: "Score · Acc · Rank",
		legendRks: "RKS · Push",
		legendRksOnly: "RKS",
		overflow: "OVERFLOW",
		overflowNoteB30: "Not counted in RKS",
		overflowNote: "Beyond the top 30",
		emptySlot: "No Phi (AP) score yet",
		noCharts: "No charts match this mode yet",
		peerAvg: "avg",
		peerB30Avg: "B30 avg",
		analysisB30: "B30 ANALYSIS",
		analysis: "TOP {n} ANALYSIS",
		average: "Avg chart RKS",
		stddev: "Std dev",
		charts: "Charts",
		legendAvg: "Average",
		tagsOtherList: "From all your scores, not this list",
		tip: "TIP",
	},
	zh: {
		kindTitle: { b30: "B30 成绩", x30: "性30", fc30: "FC30" },
		rks: "RKS",
		statsRows: ["通过", "FC", "Phi"],
		legendScore: "分数 · ACC",
		legendScorePeer: "分数 · ACC · 均值",
		legendScoreRank: "分数 · ACC · 名次",
		legendRks: "RKS · 推分",
		legendRksOnly: "RKS",
		overflow: "溢出",
		overflowNoteB30: "以下成绩不计入 RKS",
		overflowNote: "前 30 名以外",
		emptySlot: "暂无 Phi 成绩",
		noCharts: "暂无符合条件的成绩",
		peerAvg: "均值",
		peerB30Avg: "B30 均值",
		analysisB30: "B30 数据分析",
		analysis: "前 {n} 数据分析",
		average: "单曲 RKS 均值",
		stddev: "标准差",
		charts: "谱面数",
		legendAvg: "平均线",
		tagsOtherList: "基于全部成绩，而非本列表",
		tip: "提示",
	},
};

export type PortraitCopy = (typeof COPY)["en"];

export function portraitCopy(locale: PhiLocale): PortraitCopy {
	return COPY[locale] ?? COPY.en;
}

type Row = {
	id?: unknown;
	song?: unknown;
	rank?: unknown;
	difficulty?: unknown;
	rks?: unknown;
	score?: unknown;
	acc?: unknown;
	Rating?: unknown;
	illustration?: unknown;
	num?: unknown;
	suggest?: unknown;
	accAvg?: unknown;
	accRank?: unknown;
	accRanks?: unknown;
};

export type ChartRowView = {
	type: "chart";
	label: string;
	gold: boolean;
	over: boolean;
	/** A Phi (AP) score: gold score digits */
	ap: boolean;
	ill: string;
	rankCls: string;
	rankText: string;
	constText: string;
	chipPx: number;
	/** The chip only fits at 18 px without synthesized bold */
	chipThin: boolean;
	titleLines: string[];
	titlePx: number;
	rating: string;
	/** "—" without a score; otherwise the digits come from `digits` */
	score: string;
	/** Seven digits, zero-padded like the game; leading zeros are `pad` */
	digits: { c: string; pad: boolean }[];
	acc: string;
	rks: string;
	push: string;
	pushMuted: boolean;
	peer: string;
	peerDir: "" | "up" | "down";
	peerPx: number;
	/** Peer ranks ("rank" mode): a line each under the accuracy */
	peerRanks: RankView[];
};

export type RankView = RankParts & { px: number; showOf: boolean };

export type RowView =
	| ChartRowView
	| { type: "empty"; label: string }
	| { type: "overflow"; note: string };

const num = (v: unknown) => {
	if (v == null || v === "") return undefined;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : undefined;
};

const fixed = (v: unknown, dp: number, fallback = "—") => {
	const n = num(v);
	return n == null ? fallback : n.toFixed(dp);
};

/** Cut `text` to at most `widthEm` ems, ending with "…" when it was cut */
export function truncateEm(text: string, widthEm: number): string {
	if (textEm(text) <= widthEm) return text;
	const budget = widthEm - textEm("…");
	let out = "";
	let em = 0;
	for (const ch of text) {
		const w = textEm(ch);
		if (em + w > budget) break;
		out += ch;
		em += w;
	}
	return `${out.trimEnd()}…`;
}

const CJK =
	/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
/** Never start a line with these (closing punctuation, CJK and Latin) */
const NO_LINE_START = /^[、。，．・：；！？）」』】〕〉》ー～,.:;!?)\]}]/;
const OPENERS = "([（【「『《〔〈";
const CLOSERS = ")]）】」』》〕〉";
/** A first line ending in one of these ends a phrase ("Silence is Golden,") */
const PHRASE_END = /[,:;!?/，：；！？、／]$/;

export type TitleSplit = { head: string; tail: string; widest: number };

/** Phrase open/close marks (brackets, "~ … ~", spaced " -…-") and depth per character */
function phraseMarks(chars: string[]) {
	const opens: boolean[] = [];
	const closes: boolean[] = [];
	const depth: number[] = [];
	let brackets = 0;
	let tilde = false;
	let dash = false;
	chars.forEach((ch, i) => {
		depth[i] = brackets + (tilde ? 1 : 0) + (dash ? 1 : 0);
		const prev = chars[i - 1] ?? " ";
		const next = chars[i + 1];
		if (OPENERS.includes(ch)) {
			brackets++;
			opens[i] = true;
		} else if (CLOSERS.includes(ch)) {
			brackets = Math.max(0, brackets - 1);
			closes[i] = true;
		} else if (ch === "~" || ch === "～") {
			if (tilde) closes[i] = true;
			else opens[i] = next !== undefined;
			tilde = !tilde && next !== undefined;
		} else if (ch === "-") {
			if (dash && prev !== " " && (next === undefined || next === " ")) {
				dash = false;
				closes[i] = true;
			} else if (!dash && prev === " " && next !== undefined) {
				dash = true;
				opens[i] = true;
			}
		}
	});
	return { opens, closes, depth };
}

/** Two-line title splits, best first: prefer spaces and phrase boundaries, then balance */
export function titleSplits(text: string, fitEm = 0): TitleSplit[] {
	const chars = [...text];
	const { opens, closes, depth } = phraseMarks(chars);
	const out: (TitleSplit & { cost: number })[] = [];
	for (let i = 1; i < chars.length; i++) {
		const prev = chars[i - 1]!;
		const next = chars[i]!;
		// First character of the second line, last one of the first
		let j = i;
		while (chars[j] === " ") j++;
		let k = i - 1;
		while (k > 0 && chars[k] === " ") k--;
		const atSpace = prev === " " || next === " ";
		const atOpener = opens[j] === true;
		if (!atSpace && !atOpener && !CJK.test(prev) && !CJK.test(next)) continue;
		// Never end a line on an opener or start one on a closer
		if (opens[k] || closes[j]) continue;
		const head = chars.slice(0, i).join("").trimEnd();
		const tail = chars.slice(i).join("").trimStart();
		if (!head || !tail || NO_LINE_START.test(tail)) continue;
		const widest = Math.max(textEm(head), textEm(tail));
		const cost =
			Math.max(widest, fitEm) -
			(atSpace ? 1 : 0) -
			(atOpener ? 1.5 : 0) -
			(PHRASE_END.test(head) ? 1 : 0) +
			((depth[j] ?? 0) > 0 ? 1.5 : 0);
		out.push({ head, tail, widest, cost });
	}
	return out
		.sort((a, b) => a.cost - b.cost || a.widest - b.widest)
		.map(({ head, tail, widest }) => ({ head, tail, widest }));
}

/** The best two-line split of `text` (see titleSplits), or the text and "" */
export function splitTitle(text: string, fitEm = 0): [string, string] {
	const [best] = titleSplits(text, fitEm);
	return best ? [best.head, best.tail] : [text, ""];
}

/** Title lines and size: one line at 30–28 px, else the best two-line split at ≥ 26 px, else ellipsized */
export function fitTitle(
	raw: string,
	widthPx: number = GEOMETRY.infoW,
): { lines: string[]; px: number } {
	const text = raw.replace(/\s+/g, " ").trim() || "—";
	const width = widthPx * SLACK;
	const one = fitEm(textEm(text), width, TITLE_MAX_PX);
	if (one >= TITLE_MIN_PX) return { lines: [text], px: one };
	for (const split of titleSplits(text, width / TITLE_MAX_PX)) {
		const two = fitEm(split.widest, width, TITLE_MAX_PX);
		if (two >= TITLE_TWO_MIN_PX)
			return { lines: [split.head, split.tail], px: two };
	}
	return {
		lines: fillTwoLines(text, width / TITLE_TWO_MIN_PX),
		px: TITLE_TWO_MIN_PX,
	};
}

/** Fill line one, rest on line two (ellipsized); break at a space only if line one stays ≥ 70% full */
export function fillTwoLines(text: string, lineEm: number): string[] {
	const chars = [...text];
	let cut = 0;
	let em = 0;
	while (cut < chars.length && em + textEm(chars[cut]!) <= lineEm) {
		em += textEm(chars[cut]!);
		cut++;
	}
	const prev = chars[cut - 1] ?? " ";
	const next = chars[cut] ?? " ";
	// Already at a space or a CJK boundary: nothing to back off from
	const atBreak =
		prev === " " || next === " " || CJK.test(prev) || CJK.test(next);
	const space = chars.slice(0, cut).lastIndexOf(" ");
	if (
		!atBreak &&
		space > 0 &&
		textEm(chars.slice(0, space).join("")) >= lineEm * 0.7
	)
		cut = space;
	const first = chars.slice(0, cut).join("").trimEnd();
	const rest = chars.slice(cut).join("").trim();
	return rest ? [first, truncateEm(rest, lineEm)] : [first];
}

function decodeEntities(s: string) {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&amp;/g, "&");
}

/** Visible text lines of a rich-text player name (tags dropped, <br> splits) */
export function nameLines(html: string): string[] {
	return html
		.split(/<br\s*\/?>/i)
		.map((line) => decodeEntities(line.replace(/<[^>]*>/g, "")).trim())
		.filter(Boolean);
}

/**
 * Rich-text HTML with a <br> inserted before the visible character `index`
 * (tags skipped, entities counted as nameLines decodes them)
 */
export function breakHtmlAt(html: string, index: number): string {
	let seen = 0;
	let i = 0;
	while (i < html.length) {
		if (html[i] === "<") {
			const end = html.indexOf(">", i);
			if (end < 0) break;
			i = end + 1;
			continue;
		}
		if (seen >= index) return `${html.slice(0, i)}<br>${html.slice(i)}`;
		// Count characters the way nameLines decodes them
		const entity = /^&(?:#\d+|[a-z]+);/i.exec(html.slice(i, i + 12));
		const piece = entity
			? entity[0]
			: String.fromCodePoint(html.codePointAt(i) ?? 32);
		i += piece.length;
		seen += [...decodeEntities(piece)].length;
	}
	return html;
}

/**
 * Two balanced lines for a name: at a space or CJK boundary, or mid-word when
 * that is more than 2 em better balanced (names are often one long "word")
 */
export function splitName(text: string): [string, string] {
	const chars = [...text];
	const half = textEm(text) / 2;
	let em = 0;
	let cut = 0;
	while (cut < chars.length - 1 && em + textEm(chars[cut]!) / 2 < half) {
		em += textEm(chars[cut]!);
		cut++;
	}
	cut = Math.max(1, cut);
	const mid: [string, string] = [
		chars.slice(0, cut).join(""),
		chars.slice(cut).join(""),
	];
	const [head, tail] = splitTitle(text);
	const widest = (pair: [string, string]) =>
		Math.max(textEm(pair[0]), textEm(pair[1]));
	return tail && widest([head, tail]) <= widest(mid) + 2 ? [head, tail] : mid;
}

/** Player name (rich text): one line at 42–28 px, else two balanced lines via an inserted <br> */
export function fitPlayerName(
	raw: string,
	widthPx: number = GEOMETRY.nameW,
): { px: number; multi: boolean; html: string } {
	// Raw newlines would break lines under the template's pre-line wrapping
	const html = raw.replace(/\s*\n\s*/g, " ").trim();
	const lines = nameLines(html);
	const width = widthPx * BOLD_SLACK;
	if (!lines.length) return { px: NAME_MAX_PX, multi: false, html: "—" };
	if (lines.length > 1) {
		const widest = Math.max(...lines.map(textEm));
		const px = Math.min(
			fitEm(widest, width, NAME_WRAP_MAX_PX),
			Math.floor((2 * NAME_WRAP_MAX_PX) / lines.length),
		);
		if (px >= SMALL_MIN_PX) return { px, multi: true, html };
	}
	// Too many or too wide explicit lines are joined and fitted as plain text
	const single = lines.length === 1;
	const text = lines.join(" ");
	const one = fitEm(textEm(text), width, NAME_MAX_PX);
	if (one >= NAME_MIN_PX)
		return { px: one, multi: false, html: single ? html : escapeHtml(text) };
	const [head, tail] = splitName(text);
	const two = fitEm(
		Math.max(textEm(head), textEm(tail)),
		width,
		NAME_WRAP_MAX_PX,
	);
	if (two >= NAME_WRAP_MIN_PX) {
		// The visible text of `html` may start with spaces that nameLines trimmed
		const lead = decodeEntities(html.replace(/<[^>]*>/g, "")).search(/\S/);
		const at = Math.max(0, lead) + [...text].length - [...tail].length;
		return {
			px: two,
			multi: true,
			html: single
				? breakHtmlAt(html, at)
				: `${escapeHtml(head)}<br>${escapeHtml(tail)}`,
		};
	}
	const cut = fillTwoLines(text, width / NAME_WRAP_MIN_PX);
	return {
		px: NAME_WRAP_MIN_PX,
		multi: cut.length > 1,
		html: cut.map(escapeHtml).join("<br>"),
	};
}

function escapeHtml(s: string) {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Peer-average candidates from `accAvg` (formats in score-avg.ts) and whether the player is above them */
export function peerAverage(
	accAvg: unknown,
	acc: number | undefined,
	vt: PortraitCopy,
): { texts: string[]; dir: "" | "up" | "down" } {
	const none = { texts: [], dir: "" as const };
	if (accAvg == null || accAvg === "") return none;
	const dir = (value: number) =>
		acc == null
			? ("" as const)
			: acc >= value
				? ("up" as const)
				: ("down" as const);
	const avg = (value: number, label: string) => {
		const pct = `${value.toFixed(2)}%`;
		return { texts: [`${label} ${pct}`, pct], dir: dir(value) };
	};
	if (typeof accAvg === "number")
		return Number.isFinite(accAvg) ? avg(accAvg, vt.peerAvg) : none;
	const s = String(accAvg).trim();
	const m = /^(B?Avg):\s*(-?\d+(?:\.\d+)?)%?$/i.exec(s);
	if (m)
		return avg(
			Number(m[2]),
			m[1]!.toLowerCase() === "bavg" ? vt.peerB30Avg : vt.peerAvg,
		);
	if (/^-?\d+(?:\.\d+)?$/.test(s)) return avg(Number(s), vt.peerAvg);
	const top = /(Top\s+[\d.]+%)/i.exec(s);
	return { texts: top && top[1] !== s ? [s, top[1]!] : [s], dir: "" };
}

/** First candidate that fits `widthPx` at 18–20 px; the last one is ellipsized otherwise */
export function fitSmall(
	texts: string[],
	widthPx: number,
): { text: string; px: number } {
	const width = Math.max(0, widthPx * SLACK);
	for (const text of texts) {
		const px = fitEm(textEm(text), width, SMALL_MAX_PX);
		if (px >= SMALL_MIN_PX) return { text, px };
	}
	const last = texts[texts.length - 1] ?? "";
	return { text: truncateEm(last, width / SMALL_MIN_PX), px: SMALL_MIN_PX };
}

/** Difficulty chip on the jacket: 22 px bold, down to 18 px, then 18 px regular */
export function fitChip(text: string): { px: number; thin: boolean } {
	const em = textEm(text);
	const bold = fitEm(em, GEOMETRY.chipTextW * BOLD_SLACK, CHIP_MAX_PX);
	if (bold >= SMALL_MIN_PX) return { px: bold, thin: false };
	return { px: SMALL_MIN_PX, thin: true };
}

/**
 * Score digits in fixed cells so place values line up from row to row, padded
 * to seven like the game (0977992); nothing for a missing or oversized score
 */
export function scoreDigits(score: string): { c: string; pad: boolean }[] {
	if (!/^\d{1,7}$/.test(score)) return [];
	const padded = score.padStart(7, "0");
	return [...padded].map((c, i) => ({ c, pad: i < 7 - score.length }));
}

/**
 * The rank line: "#3,611" (bold), "/ 70,388" and the "Top 5.1%" share at 20 px,
 * else 18 px, else 18 px without the record count
 */
export function fitRank(
	parts: RankParts,
	widthPx: number = GEOMETRY.infoW,
): RankView {
	const { rankTagGapW, rankGapW, rankPctGapW } = GEOMETRY;
	const width = widthPx * SLACK;
	// A ±0.05 badge may show only the place or only the share
	const lineW = (px: number, withOf: boolean) =>
		(parts.tag ? textEm(parts.tag) * px + rankTagGapW : 0) +
		(textEm(parts.pos) * px) / BOLD_SLACK +
		(withOf ? textEm(parts.of) * px + rankGapW : 0) +
		(parts.pct ? (parts.pos ? rankPctGapW : 0) + textEm(parts.pct) * px : 0);
	const showOf = Boolean(parts.of);
	for (const px of RANK_PX)
		if (lineW(px, showOf) <= width) return { ...parts, px, showOf };
	return { ...parts, px: RANK_PX[RANK_PX.length - 1]!, showOf: false };
}

function chartRow(
	row: Row,
	opts: {
		label: string;
		gold: boolean;
		over: boolean;
		showPush: boolean;
		vt: PortraitCopy;
	},
): ChartRowView {
	const rank = String(row.rank ?? "");
	const rating = String(row.Rating ?? "");
	const score = num(row.score);
	const acc = num(row.acc);
	const title = fitTitle(String(row.song ?? row.id ?? ""));
	const accText = acc == null ? "—" : `${acc.toFixed(4)}%`;
	const suggest = typeof row.suggest === "string" ? row.suggest.trim() : "";
	// A Phi (AP) chart cannot be pushed further; the "can't push" line is noise there
	const perfect = (score ?? 0) >= 1e6 || (acc ?? 0) >= 100;
	const push = opts.showPush && !perfect ? suggest : "";
	const pushMuted = Boolean(push) && !push.endsWith("%");
	// "rank" mode rows carry the badge pieces; they get a line of their own
	const ranks = rankLines(row);
	const peer = ranks.length
		? { texts: [], dir: "" as const }
		: peerAverage(row.accAvg, acc, opts.vt);
	let peerText = "";
	let peerPx = SMALL_MAX_PX;
	if (peer.texts.length) {
		const { infoW, accPx, pushPx, pushMarkW, peerMarkW, peerPadW, metaGap } =
			GEOMETRY;
		const pushW = push
			? textEm(push) * pushPx + (pushMuted ? 0 : pushMarkW) + metaGap
			: 0;
		const avail =
			infoW -
			textEm(accText) * accPx -
			metaGap -
			pushW -
			peerPadW -
			(peer.dir ? peerMarkW : 0);
		const fit = fitSmall(peer.texts, avail);
		peerText = fit.text;
		peerPx = fit.px;
	}
	const rankText = rank || "?";
	const constText = fixed(row.difficulty, 1, "");
	const scoreText = score == null ? "—" : String(Math.round(score));
	const chip = fitChip(`${rankText} ${constText}`.trim());
	return {
		type: "chart",
		label: opts.label,
		gold: opts.gold,
		over: opts.over,
		ap: perfect,
		ill: typeof row.illustration === "string" ? row.illustration : "",
		rankCls: RANKS.has(rank) ? rank.toLowerCase() : "unknown",
		rankText,
		constText,
		chipPx: chip.px,
		chipThin: chip.thin,
		titleLines: title.lines,
		titlePx: title.px,
		rating: RATINGS.has(rating) ? rating : "",
		score: scoreText,
		digits: scoreDigits(scoreText),
		acc: accText,
		rks: fixed(row.rks, 4),
		push,
		pushMuted,
		peer: peerText,
		peerDir: peerText ? peer.dir : "",
		peerPx,
		peerRanks: ranks.map((r) => fitRank(r)),
	};
}

/** Chart rows in display order with the empty P slots and the OVERFLOW divider */
export function buildRows(
	data: { phi?: unknown; b19_list?: unknown },
	kind: CardKind,
	vt: PortraitCopy,
): RowView[] {
	const out: RowView[] = [];
	const hasPhi = Array.isArray(data.phi);
	const phi = hasPhi ? (data.phi as (Row | undefined)[]) : [];
	const best = Array.isArray(data.b19_list) ? (data.b19_list as Row[]) : [];
	const showPush = kind === "b30";
	if (hasPhi) {
		for (let i = 0; i < Math.max(3, phi.length); i++) {
			const row = phi[i];
			const label = `P${i + 1}`;
			if (row && typeof row === "object")
				out.push(
					chartRow(row, { label, gold: true, over: false, showPush, vt }),
				);
			else out.push({ type: "empty", label });
		}
	}
	// Same cut as the classic card: B27 after the P rows, else the top 30
	const limit = hasPhi ? 27 : 30;
	best.forEach((row, i) => {
		if (!row || typeof row !== "object") return;
		if (i === limit)
			out.push({
				type: "overflow",
				note: kind === "b30" ? vt.overflowNoteB30 : vt.overflowNote,
			});
		out.push(
			chartRow(row, {
				label: `#${num(row.num) ?? i + 1}`,
				gold: false,
				over: i >= limit,
				showPush,
				vt,
			}),
		);
	});
	return out;
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

/** Pixel geometry for the compact histogram (bars, grid lines, sparse x labels) */
export function buildHistogram(h: HistogramIn, kind: CardKind) {
	const slots = Array.isArray(h.slots) ? h.slots : [];
	const { plotW, plotH, xLabelW } = GEOMETRY;
	const n = slots.length;
	if (n < 3) return null;
	const step = plotW / n;
	const barW = Math.max(4, Math.min(30, Math.round(step * 0.62)));
	// x30 / fc30 lists have no P slots: their "B" slots are just list positions
	const relabel = (label: string) =>
		kind === "b30" ? label : label.replace(/^B/, "#");
	const bars = slots.map((slot, i) => ({
		left: Math.round(i * step + (step - barW) / 2),
		width: barW,
		height: Math.max(
			2,
			Math.round((Math.min(100, num(slot.height) ?? 0) / 100) * plotH),
		),
		gold: slot.kind === "phi",
	}));
	const ticks = (Array.isArray(h.ticks) ? h.ticks : []).map((tick) => {
		const bottom = Math.round(((num(tick.position) ?? 0) / 100) * plotH);
		// Labels are 22 px boxes centred on their grid line
		return {
			bottom,
			labelBottom: bottom - 11,
			label: String(tick.label ?? ""),
		};
	});
	// Label the first slot of each kind, every 5th best slot and the last one,
	// dropping labels that would collide
	const xLabels: {
		center: number;
		left: number;
		align: "start" | "center" | "end";
		text: string;
		gold: boolean;
	}[] = [];
	const minGap = 44;
	slots.forEach((slot, i) => {
		const label = String(slot.label ?? "");
		const index = Number(label.replace(/^\D+/, ""));
		const firstOfKind = i === 0 || slots[i - 1]?.kind !== slot.kind;
		const wanted =
			firstOfKind || i === n - 1 || (slot.kind !== "phi" && index % 5 === 0);
		if (!wanted) return;
		const center = Math.round(i * step + step / 2);
		const prev = xLabels[xLabels.length - 1];
		if (prev && center - prev.center < minGap) {
			if (i !== n - 1) return;
			xLabels.pop();
		}
		// Labels that would overhang the plot start at their bar's left edge (or end
		// at its right edge) instead of being centred on it
		const bar = bars[i]!;
		const align =
			center - xLabelW / 2 < 0
				? "start"
				: center + xLabelW / 2 > plotW
					? "end"
					: "center";
		xLabels.push({
			center,
			left:
				align === "start"
					? bar.left
					: align === "end"
						? bar.left + bar.width - xLabelW
						: center - xLabelW / 2,
			align,
			text: relabel(label),
			gold: slot.kind === "phi",
		});
	});
	const phiCount = slots.filter((s) => s.kind === "phi").length;
	const bestCount = n - phiCount;
	return {
		bars,
		ticks,
		xLabels,
		avgBottom: Math.round(
			(Math.min(100, Math.max(0, num(h.averagePosition) ?? 0)) / 100) * plotH,
		),
		legendPhi: phiCount ? `P1–P${phiCount}` : "",
		legendBest: bestCount
			? kind === "b30"
				? `B1–B${bestCount}`
				: `#1–#${bestCount}`
			: "",
	};
}

type TagIn = { name?: unknown; rks?: unknown };

/** Tag-name lines: one line, else the best two-line split, else ellipsized */
export function tagNameLines(name: string, px: number): string[] {
	const text = name.replace(/\s+/g, " ").trim() || "—";
	const lineEm = (GEOMETRY.tagNameW * SLACK) / px;
	if (textEm(text) <= lineEm) return [text];
	const split = titleSplits(text, lineEm).find((s) => s.widest <= lineEm);
	return split ? [split.head, split.tail] : fillTwoLines(text, lineEm);
}

type TagRow = { rank: number; lines: string[]; rks: string };

/** Strength / weakness rows in pairs, so a wrapped name keeps both columns level */
export function buildTags(strongRaw: unknown, weakRaw: unknown) {
	const list = (raw: unknown) =>
		(Array.isArray(raw) ? (raw as TagIn[]) : [])
			.slice(0, 5)
			.map((tag) => ({ name: String(tag?.name ?? ""), rks: tag?.rks }));
	const strongIn = list(strongRaw);
	const weakIn = list(weakRaw);
	const widest = Math.max(
		0,
		...[...strongIn, ...weakIn].map((t) => textEm(t.name)),
	);
	const px = widest * 22 <= GEOMETRY.tagNameW * SLACK ? 22 : 20;
	const rows = (tags: typeof strongIn): TagRow[] =>
		tags.map((tag, i) => ({
			rank: i + 1,
			lines: tagNameLines(tag.name, px),
			rks: fixed(tag.rks, 2),
		}));
	const strong = rows(strongIn);
	const weak = rows(weakIn);
	const pairs = Array.from(
		{ length: Math.max(strong.length, weak.length) },
		(_, i) => ({
			strong: strong[i] ?? null,
			weak: weak[i] ?? null,
			lines: Math.max(strong[i]?.lines.length ?? 0, weak[i]?.lines.length ?? 0),
		}),
	);
	return { px, strong, weak, pairs };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Analysis panel view. `tagTitle` is the tag panel's heading (t.tagAbility);
 * it decides whether the meta line fits beside it
 */
export function buildAnalysis(
	raw: unknown,
	kind: CardKind,
	vt: PortraitCopy,
	tagTitle = "",
) {
	if (!raw || typeof raw !== "object") return null;
	const a = raw as {
		histogram?: HistogramIn;
		tagAnalysis?: {
			insufficient?: unknown;
			strong?: unknown;
			weak?: unknown;
		} | null;
		showTags?: unknown;
		tagMeta?: unknown;
		tagPoolNote?: unknown;
		tagMessage?: unknown;
	};
	const h = a.histogram ?? {};
	const count = num(h.count) ?? (Array.isArray(h.slots) ? h.slots.length : 0);
	if (!count) return null;
	const tags = a.tagAnalysis;
	const tagsOk = Boolean(tags && !tags.insufficient);
	const tagList = buildTags(
		tagsOk ? tags?.strong : [],
		tagsOk ? tags?.weak : [],
	);
	const { strong, weak } = tagList;
	const poolNote = str(a.tagPoolNote);
	return {
		title:
			kind === "b30"
				? vt.analysisB30
				: vt.analysis.replace("{n}", String(count)),
		average: fixed(h.average, 4),
		// Two decimals, like the ± beside the header RKS (the same spread on b30)
		stddev: `±${fixed(h.stddev, 2)}`,
		count: String(count),
		hist: buildHistogram(h, kind),
		showTags: a.showTags === true,
		tagsOk: tagsOk && (strong.length > 0 || weak.length > 0),
		tagMeta: str(a.tagMeta),
		// Heading (24 px bold) and meta (20 px) share a line when both fit in 560 px
		tagMetaWraps:
			Boolean(str(a.tagMeta)) &&
			(textEm(tagTitle) * 24) / BOLD_SLACK + 16 + textEm(str(a.tagMeta)) * 20 >
				GEOMETRY.panelW,
		// The tag profile never comes from the x30 / fc30 list itself
		tagNote: poolNote || (kind === "b30" ? "" : vt.tagsOtherList),
		tagMessage: str(a.tagMessage),
		tagPx: tagList.px,
		strong,
		weak,
		tagPairs: tagList.pairs,
	};
}

export function buildStats(raw: unknown, vt: PortraitCopy) {
	if (!Array.isArray(raw) || !raw.length) return null;
	const list = raw.slice(0, 4) as Record<string, unknown>[];
	const cols = list.map((s) => {
		const title = String(s?.title ?? "");
		return { title, cls: RANKS.has(title) ? title.toLowerCase() : "unknown" };
	});
	const rows = (["cleared", "fc", "phi"] as const).map((key, i) => ({
		label: vt.statsRows[i]!,
		cls: key,
		cells: list.map((s) => String(num(s?.[key]) ?? 0)),
	}));
	return { cols, rows };
}

/** Width of the card-title chip in the header kicker */
export function kindChipW(title: string): number {
	const { kindPx, kindTrackPx, kindPadW } = GEOMETRY;
	return (
		(textEm(title) * kindPx) / BOLD_SLACK +
		kindTrackPx * [...title].length +
		kindPadW
	);
}

export type Chip = { lines: string[]; px: number };

/** Outer width of a mode chip */
const chipW = (chip: Chip) =>
	Math.max(0, ...chip.lines.map(textEm)) * chip.px + GEOMETRY.chipPadW;

/** Mode chips after the title, fitted to the kicker line; a chip that doesn't fit gets its own line */
export function buildChips(raw: unknown, title: string): Chip[] {
	if (!Array.isArray(raw)) return [];
	const { kickerW, kickerGap, chipPadW } = GEOMETRY;
	let room = kickerW - kindChipW(title) - kickerGap;
	const fit = (em: number, w: number) =>
		fitEm(em, (w - chipPadW) * SLACK, CHIP_MAX_PX);
	return raw
		.map((s) => String(s ?? "").trim())
		.filter(Boolean)
		.slice(0, 2)
		.map((text) => {
			if (fit(textEm(text), room) < SMALL_MIN_PX) room = kickerW;
			const px = fit(textEm(text), room);
			let chip: Chip = { lines: [text], px };
			if (px < SMALL_MIN_PX) {
				const lineEm = ((kickerW - chipPadW) * SLACK) / SMALL_MIN_PX;
				const split = titleSplits(text, lineEm).find((s) => s.widest <= lineEm);
				chip = split
					? { lines: [split.head, split.tail], px: fit(split.widest, kickerW) }
					: { lines: fillTwoLines(text, lineEm), px: SMALL_MIN_PX };
			}
			room -= chipW(chip) + kickerGap;
			return chip;
		});
}

const LEGACY_MODE_LABELS = [
	"1 Good Mode",
	"1 Good 模式",
	"Full Combo Mode",
	"Full Combo 模式",
];

/**
 * spInfo without the x30 / fc30 mode labels (the card title already names the
 * mode) and without the rank population legend (a footnote under the list)
 */
export function modeChips(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	// The older long labels too ("1 Good Mode", "Full Combo 模式")
	const modes = new Set<string>(LEGACY_MODE_LABELS);
	for (const copy of [cardCopy("en"), cardCopy("zh")]) {
		modes.add(copy.fcMode);
		modes.add(copy.x30Mode);
	}
	return raw
		.map((s) => String(s ?? "").trim())
		.filter((text) => text && !modes.has(text));
}

type ViewParts = {
	title: string;
	chips: Chip[];
	namePx: number;
	nameHtml: string;
	date: string;
	dataSize: string;
	stats: ReturnType<typeof buildStats>;
	rows: RowView[];
	analysis: ReturnType<typeof buildAnalysis>;
};

/**
 * Kicker height: the card title plus mode chips, wrapping like the flex row
 * (36 px lines, taller for a two-line chip, 10 px between lines)
 */
export function kickerHeight(title: string, chips: Chip[]): number {
	const { kickerW, kickerGap } = GEOMETRY;
	const lines = [HEIGHTS.kickerLine];
	let room = kickerW - kindChipW(title) - kickerGap;
	for (const chip of chips) {
		const w = chipW(chip);
		if (w > room + 0.5) {
			lines.push(HEIGHTS.kickerLine);
			room = kickerW;
		}
		// 7 px of padding around 1.2 line-height text
		const h = chip.lines.length * chip.px * 1.2 + 7;
		lines[lines.length - 1] = Math.max(lines[lines.length - 1]!, h);
		room -= w + kickerGap;
	}
	return (
		lines.reduce((sum, h) => sum + h, 0) +
		(lines.length - 1) * HEIGHTS.kickerGap
	);
}

/** Estimated card height in CSS px (without the engine's measure slack) */
export function estimateHeight(v: ViewParts, compact = false): number {
	const H = HEIGHTS;
	const row = compact ? H.rows.compact : H.rows.normal;
	// Wrapped (rich-text) names lay out at about 1.375 line height, not 1.15
	const lines = nameLines(v.nameHtml).length;
	const name = lines * v.namePx * (lines > 1 ? 1.375 : 1.15);
	let h =
		H.headTop +
		kickerHeight(v.title, v.chips) +
		H.idTop +
		Math.max(H.avatar, name + 2 + H.rksLine);
	if (v.date || v.dataSize) h += H.meta;
	if (v.stats) h += H.stats;
	h += H.listTop;
	const charts = v.rows.filter((r) => r.type === "chart").length;
	if (charts) h += H.legend;
	else h += H.none;
	for (const r of v.rows) {
		h += row.gap;
		if (r.type === "chart")
			h += Math.max(
				row.min,
				// Takumi rounds each line box up to a whole pixel
				row.base +
					r.peerRanks.length * row.rank +
					r.titleLines.length * Math.ceil(r.titlePx * row.lh),
			);
		else h += r.type === "empty" ? H.empty : H.overflow;
	}
	const a = v.analysis;
	if (a) {
		h += H.analysisHead + H.summary + (a.hist ? H.histogram : 0);
		if (a.showTags) {
			h += H.tagsTop + (a.tagMetaWraps ? H.tagsMeta : 0);
			if (a.tagsOk) {
				h += H.tagsCols;
				for (const pair of a.tagPairs)
					h += Math.max(H.tagRow, pair.lines * a.tagPx * 1.2 + 4);
				if (a.tagNote)
					h +=
						12 +
						Math.ceil((textEm(a.tagNote) * 20) / GEOMETRY.panelW) * H.noteLine;
			} else {
				// The failure message (22 px, 1.35 line height), one line if unknown
				const msg =
					Math.ceil((textEm(a.tagMessage) * 22) / GEOMETRY.panelW) || 1;
				h += 12 + msg * 30;
			}
		}
	}
	return Math.round(h + H.foot);
}

/**
 * Tighter chart rows when that is what keeps the card under the 2x paint
 * budget; cards too tall either way (count 99) keep the normal spacing
 */
export function wantsCompact(v: ViewParts): boolean {
	return (
		estimateHeight(v) > SHARP_MAX_H && estimateHeight(v, true) <= SHARP_MAX_H
	);
}

export function buildView(data: CardData, ctx: VariantContext) {
	const vt = portraitCopy(ctx.locale);
	const kind: CardKind = ctx.kind;
	const user = (data.gameuser ?? {}) as {
		avatar?: unknown;
		ChallengeMode?: unknown;
		ChallengeModeRank?: unknown;
		rks?: unknown;
		data?: unknown;
		PlayerId?: unknown;
	};
	const nameHtml = String(user.PlayerId ?? data.PlayerId ?? "");
	const name = fitPlayerName(nameHtml);
	const mode = num(user.ChallengeMode ?? data.ChallengeMode);
	const level = num(user.ChallengeModeRank ?? data.ChallengeModeRank);
	const sd = num(data.rksStddev);
	const titles = vt.kindTitle as Record<string, string>;
	const title = titles[kind] ?? vt.kindTitle.b30;
	const rows = buildRows(data, kind, vt);
	const charts = rows.filter((row) => row.type === "chart");
	const hasRank = charts.some((row) => row.peerRanks.length);
	const dataSize = str(user.data);
	const parts: ViewParts = {
		title,
		chips: buildChips(modeChips(data.spInfo), title),
		namePx: name.px,
		nameHtml: name.html,
		date: str(data.Date),
		// Manual-mode saves have no Data balance ("0KiB")
		dataSize: dataSize === "0KiB" ? "" : dataSize,
		stats: data.hideRecordStats === true ? null : buildStats(data.stats, vt),
		rows,
		analysis: buildAnalysis(
			data.b30Analysis,
			kind,
			vt,
			cardCopy(ctx.locale).tagAbility,
		),
	};
	return {
		vt,
		pv: {
			...parts,
			kind,
			compact: wantsCompact(parts),
			avatar: str(user.avatar),
			nameMulti: name.multi,
			rks: fixed(user.rks ?? data.Rks, 4),
			// On x30 / fc30 the spread is of the filtered list, not of the B30 behind
			// the RKS; the analysis panel shows it there
			sd: kind === "b30" && sd != null && sd > 0 ? `±${sd.toFixed(2)}` : "",
			// Manual-mode saves carry rank 0: no challenge badge then
			challenge:
				level != null && level > 0 && mode != null && mode >= 0 && mode <= 5
					? { mode: String(Math.floor(mode)), level: String(level) }
					: null,
			legendScore: hasRank
				? vt.legendScoreRank
				: charts.some((row) => row.peer)
					? vt.legendScorePeer
					: vt.legendScore,
			legendRks: kind === "b30" ? vt.legendRks : vt.legendRksOnly,
			noCharts: !charts.length,
			tip: portraitTip(data.tips, ctx.catalog?.tips),
		},
	};
}

/** Footer tip in at most two lines, so the footer height never depends on the tip */
export function portraitTip(tips: unknown, catalogTips?: string[]): FittedTip {
	return fitTip(pickTip(tips, catalogTips), GEOMETRY.tipW * SLACK, TIP_PX, 2);
}

export const variant: CardVariant = {
	tpl: "b19-portrait",
	width: GEOMETRY.cardW,
	prepare: (data, ctx) => ({ ...data, ...buildView(data, ctx) }),
};
