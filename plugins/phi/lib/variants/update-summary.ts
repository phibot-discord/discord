import type { PhiLocale } from "../card-i18n.ts";
import { fCompute } from "../fcompute.ts";
import { getInfo } from "../get-info.ts";
import type { UpdateBox, UpdateTile } from "../history.ts";
import { fitEm, fitFontPx, splitTwoLines, textEm } from "../text-fit.ts";
import type { CardData, CardVariant, VariantContext } from "./types.ts";

/** "Summary" history layout; prepare() derives everything the template prints (`us`) */

const COPY = {
	en: {
		eyebrow: "SCORE UPDATES",
		rks: "RANKING SCORE",
		sinceSync: "since last sync",
		saved: "SAVED",
		period: "PERIOD",
		periodDays: "{n} days with updates",
		periodDay: "1 day with updates",
		kpiRks: "RKS CHANGE",
		kpiRecords: "NEW RECORDS",
		kpiPhi: "NEW φ / AP",
		kpiPhiSub: "Score 1000000 reached",
		kpiPhiListed: "Among listed updates",
		kpiPhiNone: "None this period",
		kpiPhiNoneListed: "None among listed updates",
		kpiBest: "BEST GAIN",
		kpiBestScore: "BEST SCORE GAIN",
		kpiBestNone: "No earlier record",
		noTrend: "No RKS history yet",
		syncs: "in {n} syncs",
		sync: "in 1 sync",
		gains: "TOP GAINS",
		gainsMeta: "Ranked by RKS gain",
		gainsMetaListed: "Ranked by RKS gain · listed updates",
		firstRecord: "First record",
		movement: "B30 MOVEMENT",
		entered: "Entered B30",
		left: "Left B30",
		moreCharts: "+{n} more",
		none: "None",
		movementNone: "No chart entered or left your B30 since {d}.",
		movementSingle: "Sync again later to compare your B30 between saves.",
		updates: "OTHER UPDATES",
		updatesMeta: "Grouped by day",
		updatesAll: "ALL UPDATES",
		nUpdates: "{n} updates",
		oneUpdate: "1 update",
		notShown: "+{n} lower updates not shown",
		colChart: "CHART",
		colScore: "SCORE",
		colAcc: "ACC",
		colRks: "RKS",
		colGain: "GAIN",
		rowNew: "NEW",
		cmpRks: "RKS",
		cmpAcc: "ACC",
		cmpScore: "SCORE",
		tasks: "TASKS",
		taskDone: "Done",
		taskOpen: "Open",
		emptyTitle: "No score updates yet",
		emptyBody:
			"Play a few charts and sync your save —\nyour new records will show up here.",
		emptyMoved: "Your B30 still changed between the last two syncs.",
		tip: "TIP",
	},
	zh: {
		eyebrow: "成绩更新",
		rks: "RKS",
		sinceSync: "较上次同步",
		saved: "存档时间",
		period: "统计区间",
		periodDays: "{n} 天有更新",
		periodDay: "1 天有更新",
		kpiRks: "RKS 变化",
		kpiRecords: "新纪录",
		kpiPhi: "新 φ / AP",
		kpiPhiSub: "达成满分 1000000",
		kpiPhiListed: "仅统计列出的更新",
		kpiPhiNone: "本期暂无",
		kpiPhiNoneListed: "列出的更新中暂无",
		kpiBest: "单曲最大提升",
		kpiBestScore: "单曲最大分数提升",
		kpiBestNone: "暂无可比记录",
		noTrend: "暂无 RKS 记录",
		syncs: "共 {n} 次同步",
		sync: "共 1 次同步",
		gains: "提升最多",
		gainsMeta: "按 RKS 提升排序",
		gainsMetaListed: "按 RKS 提升排序 · 仅统计列出的更新",
		firstRecord: "首次记录",
		movement: "B30 变动",
		entered: "进入 B30",
		left: "移出 B30",
		moreCharts: "还有 {n} 首",
		none: "无",
		movementNone: "自 {d} 以来 B30 没有变化。",
		movementSingle: "再次同步存档后即可对比 B30 变化。",
		updates: "其他更新",
		updatesMeta: "按日期分组",
		updatesAll: "全部更新",
		nUpdates: "{n} 次更新",
		oneUpdate: "1 次更新",
		notShown: "另有 {n} 条较低的更新未显示",
		colChart: "谱面",
		colScore: "分数",
		colAcc: "准度",
		colRks: "RKS",
		colGain: "提升",
		rowNew: "新",
		cmpRks: "RKS",
		cmpAcc: "准度",
		cmpScore: "分数",
		tasks: "任务",
		taskDone: "已完成",
		taskOpen: "未完成",
		emptyTitle: "还没有成绩更新",
		emptyBody: "去打几首歌再同步存档吧，新的成绩会显示在这里。",
		emptyMoved: "不过最近两次同步之间，你的 B30 有所变化。",
		tip: "提示",
	},
} satisfies Record<PhiLocale, Record<string, string>>;

export type SummaryCopy = (typeof COPY)["en"];

// Geometry the text fitting relies on; keep in step with update-summary.css
export const CARD_WIDTH = 800;
const NAME_W = 420;
const GAIN_TITLE_W = 206;
/** Title column of a full-width gain tile (fewer than 3 tiles): 736 − 312 jacket − 46 padding */
const WIDE_TITLE_W = 374;
const ROW_TITLE_W = 244;
const MOVE_TITLE_W = 246;
const BEST_TITLE_W = 143;
/** Synthesized weights and Aldrich run wider than text-fit's table */
const SLACK = 0.92;

const TOP_GAINS_FULL = 6;
const TOP_GAINS_MIN = 3;
const MOVE_ROWS = 6;
const SPARK_W = 143;
const SPARK_H = 30;
/** Share of the sparkline width given to the dimmed stretch before the period */
const SPARK_LEAD = 0.2;
/** Most recent syncs drawn in the records-per-sync bars */
const SYNC_BARS = 30;
const BAR_W = 12;
/** New φ titles listed in their KPI tile, and the text column they share with the mark */
const PHI_TITLES = 2;
const PHI_TITLE_W = 131;
const LEVELS = new Set(["EZ", "HD", "IN", "AT", "LEGACY"]);

export type FitText = { px: number; lines: string[] };
export type Chip = { rank: string; cls: string; level: string };

type SongLookup = {
	idgetsong(id: string): string | undefined;
	getill(id: string, kind: "low"): string;
	raw(
		id: string,
	):
		| { song?: string; chart?: Record<string, { difficulty?: number }> }
		| undefined;
};

type Snap = {
	t?: number;
	rks?: number;
	phi?: { id: string; rank: string }[];
	b27?: { id: string; rank: string }[];
};

/** fCompute.formatDate, or "" for values that are not a valid time */
function fmtTime(t: unknown, format: string) {
	const n = num(t);
	if (n == null || !Number.isFinite(new Date(n).getTime())) return "";
	return fCompute.formatDate(n, format);
}

function fill(text: string, vars: Record<string, string | number>) {
	return text.replace(/\{(\w+)\}/g, (m, k: string) =>
		k in vars ? String(vars[k]) : m,
	);
}

function num(v: unknown): number | undefined {
	if (v == null || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

function decodeHtml(raw: string) {
	return raw
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
		.replace(/&amp;/g, "&");
}

function escapeHtml(s: string) {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Longest prefix of `text` that fits `widthPx` at `px`, with "…" when cut */
export function ellipsize(text: string, widthPx: number, px: number) {
	if (textEm(text) * px <= widthPx) return text;
	const chars = [...text];
	while (chars.length && textEm(`${chars.join("").trimEnd()}…`) * px > widthPx)
		chars.pop();
	return `${chars.join("").trimEnd()}…`;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
/** Never cut next to these: dashes / tildes wrap a subtitle, the rest must not open or close a line */
const NO_CUT = /[-~～ー・、。，．：；？！（）「」『』【】〔〕〈〉《》()[\]]/;

/** Two balanced title lines, at a space or next to CJK text */
export function splitTitle(text: string): [string, string] {
	const chars = [...text];
	let space: { w: number; at: [string, string] } | undefined;
	let cjk: { w: number; at: [string, string] } | undefined;
	for (let i = 1; i < chars.length; i++) {
		const a = chars[i - 1]!;
		const b = chars[i]!;
		const isSpace = b === " ";
		if (
			!isSpace &&
			(a === " " ||
				NO_CUT.test(a) ||
				NO_CUT.test(b) ||
				!(CJK.test(a) || CJK.test(b)))
		)
			continue;
		const head = chars.slice(0, i).join("").trimEnd();
		const tail = chars
			.slice(isSpace ? i + 1 : i)
			.join("")
			.trimStart();
		if (!head || !tail) continue;
		const w = Math.max(textEm(head), textEm(tail));
		if (isSpace && (!space || w < space.w)) space = { w, at: [head, tail] };
		if (!isSpace && (!cjk || w < cjk.w)) cjk = { w, at: [head, tail] };
	}
	if (space && (!cjk || space.w <= cjk.w * 1.15)) return space.at;
	if (cjk) return cjk.at;
	return splitTwoLines(text);
}

/**
 * One line down to the `wrap` size; below that two balanced lines (at most `wrap`
 * px) unless one line still fits larger; else ellipsize the second line at `min`
 */
export function fitTitle(
	text: string,
	widthPx: number,
	opts: { max: number; min: number; wrap: number; lines?: 1 | 2 },
): FitText {
	const clean = text.replace(/\s+/g, " ").trim() || "?";
	const width = widthPx * SLACK;
	const one = fitFontPx(clean, width, opts.max);
	if (one >= opts.wrap || (opts.lines === 1 && one >= opts.min))
		return { px: one, lines: [clean] };
	if (opts.lines === 1)
		return { px: opts.min, lines: [ellipsize(clean, width, opts.min)] };
	const [head, tail] = splitTitle(clean);
	const two = tail
		? Math.min(
				fitFontPx(head, width, opts.wrap),
				fitFontPx(tail, width, opts.wrap),
			)
		: 0;
	if (two >= opts.min && two >= one) return { px: two, lines: [head, tail] };
	if (one >= opts.min) return { px: one, lines: [clean] };
	// Greedy at the smallest size: fill the first line, ellipsize the rest
	const chars = [...clean];
	let cut = chars.length;
	while (cut > 1 && textEm(chars.slice(0, cut).join("")) * opts.min > width)
		cut--;
	const prefix = chars.slice(0, cut).join("");
	const space = prefix.lastIndexOf(" ");
	if (space > prefix.length / 2 && cut < chars.length)
		cut = [...prefix.slice(0, space)].length;
	const first = chars.slice(0, cut).join("").trimEnd();
	const rest = chars.slice(cut).join("").trimStart();
	return {
		px: opts.min,
		lines: rest ? [first, ellipsize(rest, width, opts.min)] : [first],
	};
}

/** Decoded characters of an HTML text run, entities counted the way decodeHtml decodes them */
function htmlUnits(text: string) {
	return text.match(/&(?:lt|gt|quot|amp|#39|#\d+);|[\s\S]/gu) ?? [];
}

/** Insert a <br> into rich-text HTML after `at` visible characters, closing and reopening open tags */
export function breakRichHtml(raw: string, at: number, resume = at) {
	const open: { name: string; tag: string }[] = [];
	let seen = 0;
	let out = "";
	let state: "head" | "gap" | "tail" = "head";
	for (const tok of raw.match(/<[^>]*>|[^<]+/g) ?? []) {
		if (tok.startsWith("<")) {
			if (state !== "tail") {
				const m = /^<\s*(\/)?\s*([a-z][\w-]*)/i.exec(tok);
				const name = m?.[2]?.toLowerCase();
				if (name && name !== "br" && !tok.endsWith("/>")) {
					if (!m?.[1]) open.push({ name, tag: tok });
					else {
						const i = open.map((o) => o.name).lastIndexOf(name);
						if (i >= 0) open.splice(i, 1);
					}
				}
			}
			out += tok;
			continue;
		}
		for (const unit of htmlUnits(tok)) {
			if (state === "head" && seen === at) {
				out += `${open
					.map((o) => `</${o.name}>`)
					.reverse()
					.join("")}<br>${open.map((o) => o.tag).join("")}`;
				state = "gap";
			}
			if (state === "gap" && seen >= resume) state = "tail";
			if (state !== "gap") out += unit;
			seen++;
		}
	}
	return out;
}

/** Two name lines: at a space, else after a separator or a script / case change */
export function splitName(text: string): [string, string] {
	if (text.includes(" ")) return splitTwoLines(text);
	const chars = [...text];
	const plain = splitTwoLines(text);
	const plainW = Math.max(textEm(plain[0]), textEm(plain[1]));
	const kind = (ch: string) =>
		/[a-z]/.test(ch)
			? "lower"
			: /[A-Z]/.test(ch)
				? "upper"
				: /\d/.test(ch)
					? "digit"
					: /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)
						? "cjk"
						: "other";
	let best: [string, string] | undefined;
	let bestW = Number.POSITIVE_INFINITY;
	for (let i = 1; i < chars.length; i++) {
		const a = chars[i - 1]!;
		const b = chars[i]!;
		const ka = kind(a);
		const kb = kind(b);
		const natural =
			/[_\-.·・]/.test(a) ||
			(ka === "lower" && kb === "upper") ||
			(ka !== kb && (ka === "cjk" || kb === "cjk")) ||
			(ka === "digit") !== (kb === "digit");
		if (!natural) continue;
		const head = chars.slice(0, i).join("");
		const tail = chars.slice(i).join("");
		const w = Math.max(textEm(head), textEm(tail));
		if (w < bestW) {
			bestW = w;
			best = [head, tail];
		}
	}
	return best && bestW <= plainW * 1.3 ? best : plain;
}

/**
 * Player name (rich-text HTML): one font size that fits every line. A long
 * single-line name wraps into two balanced lines (rich text keeps its tags)
 */
export function fitPlayerName(html: string, widthPx = NAME_W) {
	const raw = html || "";
	const lines = raw
		.split(/<br\s*\/?>/i)
		.map((line) => decodeHtml(line.replace(/<[^>]*>/g, "")).trim())
		.filter(Boolean);
	if (!lines.length) return { px: 34, html: "—" };
	const bold = /<b>/i.test(raw) ? 1.08 : 1;
	const width = widthPx * SLACK;
	const tall = lines.length > 1 ? 26 : 38;
	const em = Math.max(...lines.map(textEm)) * bold;
	const px = fitEm(em, width, tall);
	if (px >= 22 || lines.length > 1) return { px: Math.max(px, 16), html: raw };
	const [head, tail] = splitName(lines[0]!);
	if (!tail) return { px: Math.max(px, 16), html: raw };
	const wrapPx = Math.max(
		16,
		Math.min(
			fitEm(textEm(head) * bold, width, 26),
			fitEm(textEm(tail) * bold, width, 26),
		),
	);
	if (!/</.test(raw))
		return { px: wrapPx, html: `${escapeHtml(head)}<br>${escapeHtml(tail)}` };
	// Positions in the untrimmed decoded text, which is what breakRichHtml counts
	const full = [...decodeHtml(raw.replace(/<[^>]*>/g, ""))];
	const lead = full.length - [...full.join("").trimStart()].length;
	const headLen = [...head].length;
	const tailAt = lines[0]!.indexOf(tail, head.length);
	const resume =
		lead + (tailAt >= 0 ? [...lines[0]!.slice(0, tailAt)].length : headLen);
	return { px: wrapPx, html: breakRichHtml(raw, lead + headLen, resume) };
}

export function difficultyChip(rank: string, level?: number): Chip {
	const r = LEVELS.has(rank) ? rank : String(rank || "?");
	return {
		rank: r,
		cls: LEVELS.has(r) ? r : "AT",
		level: level != null && level > 0 ? level.toFixed(1) : "",
	};
}

/** Chart constant recovered from rks = constant × ((acc − 55) / 45)² */
export function tileLevel(t: UpdateTile): number | undefined {
	const rks = num(t.rks_new);
	const acc = num(t.acc_new);
	if (!rks || acc == null || acc < 70) return undefined;
	if (acc >= 100) return Math.round(rks * 10) / 10;
	const f = ((acc - 55) / 45) ** 2;
	return Math.round((rks / f) * 10) / 10;
}

export function fmtDelta(d: number, digits = 4) {
	const v = Number(d.toFixed(digits));
	if (v === 0) return `±${(0).toFixed(digits)}`;
	return `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}`;
}

function fmtAcc(v: number | undefined) {
	return v == null ? "—" : `${v.toFixed(4)}%`;
}

function fmtRks(v: number | undefined) {
	return v == null ? "—" : v.toFixed(4);
}

/** Score as the game prints it: 7 digits, zero-padded */
export function fmtScore(score: number | undefined) {
	if (score == null) return "—";
	return String(Math.max(0, Math.round(score))).padStart(7, "0");
}

type Group = { date: string; total: number; tiles: UpdateTile[] };

/** box_line rows back into date groups (a box with `date` opens a group) */
export function regroup(boxLine: unknown): Group[] {
	const groups: Group[] = [];
	if (!Array.isArray(boxLine)) return groups;
	for (const line of boxLine) {
		if (!Array.isArray(line)) continue;
		for (const box of line as UpdateBox[]) {
			if (!box || typeof box !== "object") continue;
			if (box.date || !groups.length)
				groups.push({ date: String(box.date || ""), total: 0, tiles: [] });
			const g = groups[groups.length - 1]!;
			for (const tile of box.song || []) if (tile) g.tiles.push(tile);
			if (num(box.update_num)) g.total = Number(box.update_num);
		}
	}
	for (const g of groups) g.total = Math.max(g.total, g.tiles.length);
	return groups;
}

/** Same calendar day (the YYYY/MM/DD prefix) → one group, newest first */
export function groupByDay(groups: Group[]) {
	const out: { day: string; total: number; tiles: UpdateTile[] }[] = [];
	for (const g of groups) {
		const day = /^\d{4}\/\d{2}\/\d{2}/.exec(g.date)?.[0] ?? g.date;
		const last = out[out.length - 1];
		if (last && last.day === day) {
			last.total += g.total;
			last.tiles.push(...g.tiles);
		} else out.push({ day, total: g.total, tiles: [...g.tiles] });
	}
	for (const g of out)
		g.tiles.sort((a, b) => (num(b.rks_new) ?? 0) - (num(a.rks_new) ?? 0));
	return out;
}

function chartKey(t: UpdateTile) {
	return `${t.illustration || t.song}|${t.rank}`;
}

export type ChartChange = {
	key: string;
	newest: UpdateTile;
	oldest: UpdateTile;
	hasPrev: boolean;
	rksDelta: number;
	scoreDelta: number;
	newPhi: boolean;
};

/** One entry per chart over the whole period: newest values against the oldest previous record */
export function chartChanges(groups: Group[]): ChartChange[] {
	const byKey = new Map<string, { newest: UpdateTile; oldest: UpdateTile }>();
	for (const g of groups) {
		for (const t of g.tiles) {
			const key = chartKey(t);
			const hit = byKey.get(key);
			if (!hit) byKey.set(key, { newest: t, oldest: t });
			else hit.oldest = t;
		}
	}
	return [...byKey].map(([key, { newest, oldest }]) => {
		const hasPrev = num(oldest.score_old) != null;
		const scoreNew = num(newest.score_new) ?? 0;
		const scoreOld = num(oldest.score_old);
		return {
			key,
			newest,
			oldest,
			hasPrev,
			rksDelta: hasPrev
				? (num(newest.rks_new) ?? 0) - (num(oldest.rks_old) ?? 0)
				: (num(newest.rks_new) ?? 0),
			scoreDelta: hasPrev ? scoreNew - (scoreOld ?? 0) : scoreNew,
			newPhi:
				scoreNew >= 1_000_000 && (scoreOld == null || scoreOld < 1_000_000),
		};
	});
}

/** Biggest improvements first; first records only fill up to the minimum tile count */
export function pickTopGains(changes: ChartChange[]) {
	const improved = changes
		.filter((c) => c.hasPrev && (c.rksDelta > 1e-9 || c.scoreDelta > 0))
		.sort(
			(a, b) =>
				b.rksDelta - a.rksDelta ||
				b.scoreDelta - a.scoreDelta ||
				(num(b.newest.rks_new) ?? 0) - (num(a.newest.rks_new) ?? 0),
		);
	const firsts = changes
		.filter((c) => !c.hasPrev)
		.sort(
			(a, b) => (num(b.newest.rks_new) ?? 0) - (num(a.newest.rks_new) ?? 0),
		);
	const pool =
		improved.length >= TOP_GAINS_MIN
			? improved
			: [...improved, ...firsts.slice(0, TOP_GAINS_MIN - improved.length)];
	const n =
		pool.length >= TOP_GAINS_FULL
			? TOP_GAINS_FULL
			: Math.min(pool.length, TOP_GAINS_MIN);
	return { top: pool.slice(0, n), best: improved[0] };
}

/**
 * "YYYY/MM/DD hh:mm:ss" (or its date prefix) → ms. Every stamp on the card comes
 * from the same formatter, so reading the wall-clock time as UTC keeps them comparable
 */
export function parseStamp(s: unknown): number | undefined {
	const m =
		/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
			String(s ?? "").trim(),
		);
	if (!m) return undefined;
	const t = Date.UTC(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		Number(m[4] ?? 0),
		Number(m[5] ?? 0),
		Number(m[6] ?? 0),
	);
	return Number.isFinite(t) ? t : undefined;
}

/** A vertex of the rks line: percents of rks_date (x) and rks_range (y, up) */
export type LinePt = { x: number; y: number };

/** Vertices of the rks line from its [x1%, y1%, x2%, y2%] segments */
export function linePoints(segs: unknown): LinePt[] {
	const pts: LinePt[] = [];
	if (!Array.isArray(segs)) return pts;
	for (const seg of segs) {
		if (!Array.isArray(seg) || seg.length < 4) continue;
		const [x1, y1, x2, y2] = seg.map(Number) as [
			number,
			number,
			number,
			number,
		];
		if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
		const last = pts[pts.length - 1];
		if (!last || Math.abs(last.x - x1) > 1e-6 || Math.abs(last.y - y1) > 1e-6)
			pts.push({ x: x1, y: y1 });
		pts.push({ x: x2, y: y2 });
	}
	return pts;
}

function pctValue(y: number, range: unknown) {
	const lo = num(Array.isArray(range) ? range[0] : undefined);
	const hi = num(Array.isArray(range) ? range[1] : undefined);
	if (lo == null || hi == null) return undefined;
	return lo + (y / 100) * (hi - lo);
}

/**
 * RKS when the period began: the last vertex of the rks line recorded before
 * `startMs` (else the first vertex), with its index for the sparkline
 */
export function rksBefore(
	pts: LinePt[],
	range: unknown,
	dates: unknown,
	startMs?: number,
) {
	if (!pts.length) return;
	const span = Array.isArray(dates) ? dates : [];
	const d0 = parseStamp(span[0]);
	const d1 = parseStamp(span[1]);
	let idx = 0;
	if (startMs != null && d0 != null && d1 != null && d1 > d0) {
		const at = ((startMs - d0) / (d1 - d0)) * 100;
		// A minute of slack: the record written by the period's first sync is not "before"
		const slack = (60_000 / (d1 - d0)) * 100;
		pts.forEach((p, i) => {
			if (p.x < at - slack) idx = i;
		});
	}
	const value = pctValue(pts[idx]!.y, range);
	return value == null ? undefined : { value, idx };
}

/** Snapshot fallback for rksBefore when there is no rks line */
function snapRksBefore(snaps: Snap[], startMs?: number) {
	if (snaps.length < 2) return undefined;
	let pick: number | undefined;
	for (const s of snaps) {
		const v = num(s?.rks);
		if (v == null) continue;
		const t = parseStamp(fmtTime(s?.t, "YYYY/MM/DD hh:mm:ss"));
		if (pick == null || (startMs != null && t != null && t < startMs - 60_000))
			pick = v;
	}
	return pick;
}

/** Sparkline of the period, from the last record before it to the end */
export function sparkline(pts: LinePt[], from = 0, w = SPARK_W, h = SPARK_H) {
	if (pts.length < 2) return "";
	const start = Math.min(Math.max(0, Math.floor(from)), pts.length - 1);
	const lead = start > 0 ? pts[start - 1] : undefined;
	const period = pts.slice(start);
	// No record after the period began: RKS stayed put, draw it flat to the end
	if (period.length === 1) period.push({ x: 100, y: period[0]!.y });
	const padX = 5;
	const padY = 5;
	const x0 = lead ? padX + (w - padX * 2) * SPARK_LEAD : padX;
	const p0 = period[0]!;
	const end = period[period.length - 1]!;
	const span = end.x - p0.x;
	const X = (p: LinePt, i: number) =>
		x0 +
		(w - padX - x0) *
			(span > 1e-9 ? (p.x - p0.x) / span : i / (period.length - 1));
	const ys = [...(lead ? [lead.y] : []), ...period.map((p) => p.y)];
	const lo = Math.min(...ys);
	const hi = Math.max(...ys);
	const Y = (y: number) =>
		hi - lo > 1e-9 ? h - padY - ((y - lo) / (hi - lo)) * (h - padY * 2) : h / 2;
	const f = (v: number) => v.toFixed(2);
	const xy = period.map((p, i) => [X(p, i), Y(p.y)] as const);
	const line = xy
		.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`)
		.join(" ");
	const [ax, ay] = xy[0]!;
	const [ex, ey] = xy[xy.length - 1]!;
	const stroke = `stroke-linejoin="round" stroke-linecap="round"`;
	const out = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
		`<defs><linearGradient id="usSpark" x1="0" y1="0" x2="0" y2="1">`,
		`<stop offset="0" stop-color="#62d2ff" stop-opacity="0.3"/>`,
		`<stop offset="1" stop-color="#62d2ff" stop-opacity="0"/></linearGradient></defs>`,
		`<path d="${line} L${f(ex)} ${h} L${f(ax)} ${h} Z" fill="url(#usSpark)"/>`,
	];
	if (lead)
		out.push(
			`<path d="M${f(ax)} 0 L${f(ax)} ${h}" stroke="#62d2ff" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="2 2"/>`,
			`<path d="M${f(padX)} ${f(Y(lead.y))} L${f(ax)} ${f(ay)}" fill="none" stroke="#62d2ff" stroke-opacity="0.4" stroke-width="1.4" ${stroke}/>`,
		);
	out.push(
		`<path d="${line}" fill="none" stroke="#62d2ff" stroke-width="1.8" ${stroke}/>`,
	);
	if (lead)
		out.push(
			`<circle cx="${f(ax)}" cy="${f(ay)}" r="2.4" fill="#0a1018" stroke="#62d2ff" stroke-width="1.3"/>`,
		);
	out.push(
		`<circle cx="${f(ex)}" cy="${f(ey)}" r="4.6" fill="#62d2ff" fill-opacity="0.25"/>`,
		`<circle cx="${f(ex)}" cy="${f(ey)}" r="2.4" fill="#ffffff"/></svg>`,
	);
	return out.join("");
}

/**
 * Records per sync as slanted bars, oldest on the left (`totals` is newest first,
 * like box_line); the latest sync is drawn at full strength
 */
export function syncBars(totals: number[], w = SPARK_W, h = SPARK_H) {
	const list = totals.slice(0, SYNC_BARS).reverse();
	if (list.length < 2) return "";
	const max = Math.max(...list, 1);
	const gap = list.length > 12 ? 2 : 5;
	const bw = Math.min(BAR_W, (w - gap * (list.length - 1)) / list.length);
	const slant = Math.min(2.5, bw / 3);
	const base = h - 1;
	const f = (v: number) => v.toFixed(2);
	const bars = list.map((n, i) => {
		const x = i * (bw + gap);
		const top = base - Math.max(2, (Math.max(0, n) / max) * (base - 2));
		const last = i === list.length - 1;
		return `<path d="M${f(x + slant)} ${f(top)} L${f(x + bw)} ${f(top)} L${f(x + bw - slant)} ${base} L${f(x)} ${base} Z" fill="#62d2ff" fill-opacity="${last ? 1 : 0.45}"/>`;
	});
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M0 ${base + 0.5} L${w} ${base + 0.5}" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>${bars.join("")}</svg>`;
}

function snapCharts(s: Snap) {
	const out = new Map<string, { id: string; rank: string }>();
	for (const c of [...(s.phi || []), ...(s.b27 || [])]) {
		if (c?.id) out.set(`${c.id}|${c.rank}`, c);
	}
	return out;
}

export type MoveRow = { title: FitText; ill: string; chip: Chip };

export function b30Movement(snaps: unknown, info: SongLookup) {
	const list = Array.isArray(snaps) ? (snaps as Snap[]) : [];
	if (list.length < 2) return { state: "single" as const };
	const prev = list[list.length - 2]!;
	const cur = list[list.length - 1]!;
	const a = snapCharts(prev);
	const b = snapCharts(cur);
	const row = (c: { id: string; rank: string }): MoveRow => {
		const raw = info.raw(c.id);
		const title = info.idgetsong(c.id) || raw?.song || c.id.replace(/\.0$/, "");
		let ill = "";
		try {
			ill = info.getill(c.id, "low");
		} catch {}
		return {
			title: fitTitle(title, MOVE_TITLE_W, { max: 15, min: 12, wrap: 13 }),
			ill,
			chip: difficultyChip(c.rank, num(raw?.chart?.[c.rank]?.difficulty)),
		};
	};
	const entered = [...b].filter(([k]) => !a.has(k)).map(([, c]) => c);
	const left = [...a].filter(([k]) => !b.has(k)).map(([, c]) => c);
	const when = (t: unknown) => fmtTime(t, "YYYY/MM/DD hh:mm");
	return {
		state:
			entered.length || left.length ? ("changed" as const) : ("same" as const),
		from: when(prev.t),
		to: when(cur.t),
		entered: entered.slice(0, MOVE_ROWS).map(row),
		left: left.slice(0, MOVE_ROWS).map(row),
		enteredCount: entered.length,
		leftCount: left.length,
		enteredMore: Math.max(0, entered.length - MOVE_ROWS),
		leftMore: Math.max(0, left.length - MOVE_ROWS),
	};
}

export type MoveSide = {
	dir: "in" | "out";
	title: string;
	count: string;
	rows: MoveRow[];
	more: string;
	/** Solo layout: the empty other side, e.g. "Left B30 · None" */
	aside: string;
};

/**
 * Template shape of the B30 movement: both sides next to each other, or one
 * full-width side (rows in two columns) when nothing moved the other way
 */
export function movementView(
	move: ReturnType<typeof b30Movement>,
	vt: SummaryCopy,
) {
	const meta =
		"from" in move && move.from && move.to ? `${move.from} → ${move.to}` : "";
	if (move.state !== "changed")
		return {
			state: move.state,
			layout: "split",
			sides: [] as MoveSide[],
			meta: move.state === "same" ? meta : "",
			note:
				move.state === "same"
					? fill(vt.movementNone, { d: move.from || "—" })
					: vt.movementSingle,
		};
	const more = (n: number) => (n ? fill(vt.moreCharts, { n }) : "");
	const sides: MoveSide[] = [
		{
			dir: "in",
			title: vt.entered,
			count: String(move.enteredCount),
			rows: move.entered,
			more: more(move.enteredMore),
			aside: "",
		},
		{
			dir: "out",
			title: vt.left,
			count: String(move.leftCount),
			rows: move.left,
			more: more(move.leftMore),
			aside: "",
		},
	];
	const filled = sides.filter((s) => s.rows.length);
	if (filled.length === 1) {
		const other = sides.find((s) => !s.rows.length)!;
		return {
			state: move.state,
			layout: "solo",
			sides: [{ ...filled[0]!, aside: `${other.title} · ${vt.none}` }],
			meta,
			note: "",
		};
	}
	return { state: move.state, layout: "split", sides, meta, note: "" };
}

/** RKS stayed put (or fell) while the score rose: the score gain is the headline */
function scoreOnly(c: ChartChange) {
	return c.hasPrev && c.rksDelta < 5e-5 && c.scoreDelta > 0;
}

/** Headline number of a change and its unit label */
export function gainHeadline(c: ChartChange, vt: SummaryCopy) {
	if (!c.hasPrev)
		return { gain: fmtRks(num(c.newest.rks_new)), label: vt.firstRecord };
	if (scoreOnly(c))
		return { gain: `+${Math.round(c.scoreDelta)}`, label: vt.cmpScore };
	return { gain: fmtDelta(c.rksDelta), label: "RKS" };
}

function gainTile(c: ChartChange, i: number, vt: SummaryCopy, wide: boolean) {
	const t = c.newest;
	const o = c.oldest;
	const head = gainHeadline(c, vt);
	return {
		n: i + 1,
		title: wide
			? fitTitle(t.song || "?", WIDE_TITLE_W, { max: 20, min: 14, wrap: 17 })
			: fitTitle(t.song || "?", GAIN_TITLE_W, { max: 17, min: 13, wrap: 15 }),
		ill: t.illustration || "",
		rating: t.Rating || "",
		chip: difficultyChip(t.rank, tileLevel(t)),
		first: !c.hasPrev,
		phi: c.newPhi,
		gain: head.gain,
		gainLabel: head.label,
		// First records have no "before" column: the old cells stay empty
		rksOld: c.hasPrev ? fmtRks(num(o.rks_old)) : "",
		rksNew: fmtRks(num(t.rks_new)),
		accOld: c.hasPrev ? fmtAcc(num(o.acc_old)) : "",
		accNew: fmtAcc(num(t.acc_new)),
		scoreOld: c.hasPrev ? fmtScore(num(o.score_old)) : "",
		scoreNew: fmtScore(num(t.score_new)),
	};
}

function listRow(t: UpdateTile, vt: SummaryCopy) {
	const scoreOld = num(t.score_old);
	const hasPrev = scoreOld != null;
	const delta = (num(t.rks_new) ?? 0) - (num(t.rks_old) ?? 0);
	return {
		title: fitTitle(t.song || "?", ROW_TITLE_W, { max: 15, min: 12, wrap: 13 }),
		rating: t.Rating || "",
		phi: (num(t.score_new) ?? 0) >= 1_000_000 && (scoreOld ?? 0) < 1_000_000,
		chip: difficultyChip(t.rank, tileLevel(t)),
		score: fmtScore(num(t.score_new)),
		acc: fmtAcc(num(t.acc_new)),
		rks: fmtRks(num(t.rks_new)),
		delta: hasPrev ? fmtDelta(delta) : vt.rowNew,
		deltaCls: !hasPrev ? "new" : Number(delta.toFixed(4)) > 0 ? "up" : "flat",
	};
}

/**
 * Titles of the new φ charts for their KPI tile, highest RKS first; the last line
 * carries "+N" when more were reached than fit
 */
export function phiTitles(changes: ChartChange[]) {
	const phis = changes
		.filter((c) => c.newPhi)
		.sort(
			(a, b) => (num(b.newest.rks_new) ?? 0) - (num(a.newest.rks_new) ?? 0),
		);
	const shown = phis.slice(0, PHI_TITLES);
	const rest = phis.length - shown.length;
	return shown.map((c, i) => {
		const more = rest > 0 && i === shown.length - 1 ? `+${rest}` : "";
		const room = more ? Math.ceil((textEm(more) * 12) / SLACK) + 6 : 0;
		return {
			title: fitTitle(c.newest.song || "?", PHI_TITLE_W - room, {
				max: 12,
				min: 11,
				wrap: 11,
				lines: 1,
			}),
			more,
		};
	});
}

type TaskIn = {
	song?: string;
	illustration?: string;
	finished?: boolean;
	request?: { rank?: string; type?: string; value?: string };
};

function taskRows(raw: unknown, vt: SummaryCopy) {
	if (!Array.isArray(raw)) return [];
	return (raw as (TaskIn | null)[]).flatMap((task) => {
		if (!task) return [];
		const rank = String(task.request?.rank || "");
		const label = task.request?.type === "acc" ? vt.cmpAcc : vt.cmpScore;
		return [
			{
				title: fitTitle(String(task.song || "?"), ROW_TITLE_W, {
					max: 15,
					min: 12,
					wrap: 13,
				}),
				ill: task.illustration || "",
				chip: difficultyChip(rank),
				target: `${label} ≥ ${task.request?.value ?? ""}`,
				done: Boolean(task.finished),
				status: task.finished ? vt.taskDone : vt.taskOpen,
			},
		];
	});
}

/** Everything the update-summary template prints, derived from buildUpdateCard's data */
export function summaryView(
	data: CardData,
	locale: PhiLocale,
	info: SongLookup,
) {
	const vt: SummaryCopy = COPY[locale] ?? COPY.en;
	const syncs = regroup(data.box_line);
	const days = groupByDay(syncs);
	const changes = chartChanges(syncs);
	const { top, best } = pickTopGains(changes);
	const topKeys = new Set(top.map((c) => c.key));
	const shown = syncs.reduce((n, g) => n + g.tiles.length, 0);
	const records = syncs.reduce((n, g) => n + g.total, 0);
	const hidden = records - shown;
	const empty = shown === 0;

	// Header
	const name = fitPlayerName(String(data.PlayerId ?? ""));
	const notes = Array.isArray(data.added_rks_notes) ? data.added_rks_notes : [];
	const delta = String(notes[0] ?? "").trim();
	const mode = num(data.ChallengeMode);
	const rank = num(data.ChallengeModeRank);
	const challenge =
		rank && rank > 0 && mode != null && mode >= 0 && mode <= 5
			? { mode, rank: String(rank) }
			: null;
	const rksNum = num(data.Rks);

	// The period is the span of the listed syncs; the RKS change runs from the last
	// RKS recorded before its first sync to the current RKS shown in the header
	const snaps = Array.isArray(data.hisb30Snaps)
		? (data.hisb30Snaps as Snap[])
		: [];
	const startMs = parseStamp(syncs[syncs.length - 1]?.date);
	const pts = linePoints(data.rks_history);
	const atStart = rksBefore(pts, data.rks_range, data.rks_date, startMs);
	const fromRks = atStart?.value ?? snapRksBefore(snaps, startMs);
	const lastPt = pts[pts.length - 1];
	const toRks =
		rksNum ?? (lastPt ? pctValue(lastPt.y, data.rks_range) : undefined);
	const change = fromRks != null && toRks != null ? toRks - fromRks : undefined;
	const changeR = change == null ? 0 : Number(change.toFixed(4));
	const firstDay = days[days.length - 1]?.day ?? "";
	const lastDay = days[0]?.day ?? "";

	const phiCount = changes.filter((c) => c.newPhi).length;
	const bestHead = best ? gainHeadline(best, vt) : null;
	const bestTitle = best
		? fitTitle(best.newest.song || "?", BEST_TITLE_W, {
				max: 13,
				min: 11,
				wrap: 11,
				lines: 1,
			})
		: null;

	const groups = days
		.map((d) => {
			const rows = d.tiles
				.filter((t) => !topKeys.has(chartKey(t)))
				.map((t) => listRow(t, vt));
			const notShown = d.total - d.tiles.length;
			return {
				day: d.day,
				count: d.total === 1 ? vt.oneUpdate : fill(vt.nUpdates, { n: d.total }),
				rows,
				more: notShown > 0 ? fill(vt.notShown, { n: notShown }) : "",
			};
		})
		.filter((g) => g.rows.length || g.more);

	const move = b30Movement(snaps, info);
	const wide = top.length < TOP_GAINS_MIN;

	return {
		vt,
		lc: locale === "zh" ? "zh" : "en",
		empty,
		name,
		rks: rksNum != null ? rksNum.toFixed(4) : String(data.Rks ?? "—"),
		delta,
		deltaCls: delta.startsWith("-") ? "down" : delta ? "up" : "",
		challenge,
		saved: String(data.Date ?? ""),
		period: {
			range:
				firstDay && lastDay && firstDay !== lastDay
					? `${firstDay} → ${lastDay}`
					: lastDay,
			meta:
				days.length === 1
					? vt.periodDay
					: fill(vt.periodDays, { n: days.length }),
		},
		kpi: {
			rks: change == null ? "—" : fmtDelta(change),
			rksCls:
				change == null || changeR === 0
					? "flat"
					: changeR > 0
						? "accent"
						: "down",
			rksSub:
				change == null || fromRks == null || toRks == null
					? vt.noTrend
					: `${fromRks.toFixed(4)} → ${toRks.toFixed(4)}`,
			spark: sparkline(pts, atStart?.idx ?? 0),
			records: String(records),
			recordsSub:
				syncs.length === 1 ? vt.sync : fill(vt.syncs, { n: syncs.length }),
			// One bar per sync, matching "in N syncs" under it
			bars: syncBars(syncs.map((g) => g.total)),
			phi: String(phiCount),
			phiOn: phiCount > 0,
			phiList: phiTitles(changes),
			phiSub:
				phiCount === 0
					? hidden > 0
						? vt.kpiPhiNoneListed
						: vt.kpiPhiNone
					: hidden > 0
						? vt.kpiPhiListed
						: vt.kpiPhiSub,
			best: bestHead ? bestHead.gain : "—",
			bestCls: best ? "accent" : "flat",
			bestLabel: best && scoreOnly(best) ? vt.kpiBestScore : vt.kpiBest,
			bestChip: best
				? difficultyChip(best.newest.rank, tileLevel(best.newest))
				: null,
			bestTitle,
		},
		gains: top.map((c, i) => gainTile(c, i, vt, wide)),
		gainsLayout: wide ? "wide" : "grid",
		// Top gains only see the listed tiles (history caps them per sync)
		gainsMeta: hidden > 0 ? vt.gainsMetaListed : vt.gainsMeta,
		listTitle: top.length ? vt.updates : vt.updatesAll,
		groups,
		// Column headings only above actual rows (a day can be just "+N not shown")
		listCols: groups.some((g) => g.rows.length > 0),
		movement: movementView(move, vt),
		showMovement: !empty || move.state === "changed",
		// No records but the B30 moved (e.g. new chart constants): say so, and keep the panel compact
		emptyMoved: empty && move.state === "changed",
		emptyLines: (empty && move.state === "changed"
			? vt.emptyMoved
			: vt.emptyBody
		).split("\n"),
		tasks: taskRows(data.task_data, vt),
		taskTime: String(data.task_time ?? ""),
	};
}

export const variant: CardVariant = {
	tpl: "update-summary",
	width: CARD_WIDTH,
	prepare: (data: CardData, ctx: VariantContext) => ({
		...data,
		us: summaryView(data, ctx.locale, ctx.rt?.getInfo ?? getInfo),
	}),
};
