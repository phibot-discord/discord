/** "Timeline" history layout: header, RKS trend, then updates per day with before → after */
import type { PhiLocale } from "../card-i18n.ts";
import { getInfo } from "../get-info.ts";
import { fitEm, textEm } from "../text-fit.ts";
import type { CardData, CardVariant, VariantContext } from "./types.ts";

const COPY = {
	en: {
		overline: "Score timeline",
		save: "Saved",
		rks: "Ranking score",
		trend: "RKS trend",
		updates: "Recent updates",
		updatesTotal: (n: number, d: number) =>
			`${plural(n, "update", "updates")} · ${plural(d, "day", "days")}`,
		dayCount: (n: number) => plural(n, "update", "updates"),
		dayShown: (n: number) => `top ${n} shown`,
		latest: "Latest",
		colScore: "Score",
		colAcc: "Accuracy",
		colRks: "RKS",
		legendNow: "now",
		legendWas: "before",
		legendDelta: "change",
		firstRecord: "First record",
		firstHint: "Your trend line starts with the next sync.",
		isNew: "NEW",
		inB30: "B30",
		tasks: "Tasks",
		taskDone: "Done",
		taskOpen: "To do",
		taskAcc: "ACC",
		taskScore: "Score",
		emptyTitle: "No score updates yet",
		/** One sentence per line: a deliberate break instead of a one-word orphan */
		emptyBody: [
			"Play a few charts and sync your save.",
			"New records will show up here as a timeline.",
		],
		tip: "Tip",
		weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
	},
	zh: {
		overline: "成绩时间线",
		save: "存档时间",
		rks: "RKS",
		trend: "RKS 走势",
		updates: "最近更新",
		updatesTotal: (n: number, d: number) => `共 ${n} 次更新 · ${d} 天`,
		dayCount: (n: number) => `${n} 次更新`,
		dayShown: (n: number) => `显示前 ${n} 条`,
		latest: "最新",
		colScore: "分数",
		colAcc: "准确率",
		colRks: "RKS",
		legendNow: "当前",
		legendWas: "之前",
		legendDelta: "变化",
		firstRecord: "首条记录",
		firstHint: "下次同步后即可看到走势。",
		isNew: "NEW",
		inB30: "B30",
		tasks: "任务",
		taskDone: "已完成",
		taskOpen: "未完成",
		taskAcc: "ACC",
		taskScore: "分数",
		emptyTitle: "还没有成绩更新",
		emptyBody: [
			"游玩几首曲目并同步存档后，",
			"新纪录会以时间线的形式出现在这里。",
		],
		tip: "提示",
		weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
	},
};

type Copy = (typeof COPY)[PhiLocale];

function plural(n: number, one: string, many: string) {
	return `${n} ${n === 1 ? one : many}`;
}

/** Synthesized bold (600/700) is wider than the weight-400 widths text-fit measures */
const BOLD_SLACK = 1.1;

// Geometry shared with update-timeline.css (CSS px)
const NAME_W = 404;
const NAME_H = 100;
const TITLE_W = 202;
const TASK_TITLE_W = 228;
const WAS_PX = 16;
/** "Before" lines: a right-aligned old-value box, an 8px gap, then the delta box */
const SCORE_OLD_W = 56;
const SCORE_DELTA_W = 58;
const ACC_OLD_W = 60;
const ACC_DELTA_W = 60;
const RKS_W = 84;
/** Above this many points the per-point markers merge into a bead chain */
const CHART_MAX_DOTS = 40;
const CHART_W = 640;
const CHART_H = 150;
const CHART_PAD_X = 10;
const CHART_PAD_Y = 12;

const RANKS = ["EZ", "HD", "IN", "AT", "LEGACY"];
// "NEW" (score 0) is left out: entries without an old record get their own NEW tag
const GRADES = ["phi", "FC", "V", "S", "A", "B", "C", "F"];

type Delta = { text: string; cls: string };

export type TimelineEntry = {
	ill: string;
	titleLines: string[];
	titlePx: number;
	/** Two-line title: tighter leading keeps the tags row clear of the row edge */
	twoLine: boolean;
	rank: string;
	rankCls: string;
	constText: string;
	grade: string;
	/** φ (all perfect): the new score is shown in gold */
	ap: boolean;
	isNew: boolean;
	inB30: boolean;
	scoreLead: string;
	scoreMain: string;
	/** Previous score without leading zeros; "" for a first record */
	scoreOld: string;
	scoreDelta: Delta;
	scoreWasPx: number;
	acc: string;
	accOld: string;
	/** In percentage points */
	accDelta: Delta;
	accWasPx: number;
	/** "" when the chart constant is unknown (a known one below 70% gives 0.0000) */
	rks: string;
	rksDelta: Delta;
	rksWasPx: number;
};

export type TimelineDay = {
	date: string;
	weekday: string;
	times: string;
	updates: number;
	count: string;
	shown: string;
	latest: boolean;
	entries: TimelineEntry[];
};

export type TimelineChart = {
	/** Only one RKS record so far: no line, just the value and its date */
	single: boolean;
	svg: string;
	/** "" when every point has the same value (the range around it is padding) */
	max: string;
	mid: string;
	min: string;
	from: string;
	to: string;
	first: string;
	last: string;
	change: Delta;
};

export type TimelineTask = {
	ill: string;
	titleLines: string[];
	titlePx: number;
	rank: string;
	rankCls: string;
	request: string;
	done: boolean;
	status: string;
};

export type TimelineView = {
	nameLines: string[];
	namePx: number;
	rks: string;
	rksDelta: Delta;
	challenge: { mode: number; rank: number } | null;
	saveDate: string;
	chart: TimelineChart | null;
	tasks: TimelineTask[];
	taskTime: string;
	days: TimelineDay[];
	total: string;
	empty: boolean;
};

/** Chart constant for a song (id, else title) + difficulty, when the catalog has it */
export type ConstLookup = (
	songId: string,
	rank: string,
	song: string,
) => number | undefined;

function num(v: unknown): number | undefined {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

function rec(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
}

function list(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}

/** Ellipsize `text` so it fits `capEm` ems */
export function clipEm(text: string, capEm: number): string {
	if (textEm(text) <= capEm) return text;
	const room = capEm - textEm("…");
	let out = "";
	let w = 0;
	for (const ch of text) {
		const cw = textEm(ch);
		if (w + cw > room) break;
		out += ch;
		w += cw;
	}
	return `${out.trimEnd()}…`;
}

/** Greedy wrap into two lines of at most `capEm` ems each (the second ellipsized) */
function wrapTwo(text: string, capEm: number): [string, string] {
	const words = text.split(" ");
	let head = "";
	let i = 0;
	for (; i < words.length; i++) {
		const next = head ? `${head} ${words[i]}` : words[i]!;
		if (textEm(next) > capEm) break;
		head = next;
	}
	if (!head) {
		// The first word alone is too wide: break it by characters
		let w = 0;
		const chars = [...text];
		let cut = 0;
		for (; cut < chars.length; cut++) {
			const cw = textEm(chars[cut]!);
			if (w + cw > capEm) break;
			w += cw;
		}
		head = chars.slice(0, cut).join("");
		return [head, clipEm(chars.slice(cut).join("").trimStart(), capEm)];
	}
	return [head, clipEm(words.slice(i).join(" "), capEm)];
}

/**
 * Two-line split that balances widths: at a space when there is one, anywhere
 * when `anywhere` (CJK text, which wraps between any two characters)
 */
function balancedSplit(
	text: string,
	anywhere = false,
): [string, string] | null {
	const chars = [...text];
	if (chars.length < 2) return null;
	const spaces = chars.flatMap((ch, i) => (ch === " " ? [i] : []));
	const atSpace = spaces.length > 0 && !anywhere;
	const cuts = atSpace ? spaces : chars.map((_, i) => i).slice(1);
	let best: [string, string] | null = null;
	let bestW = Number.POSITIVE_INFINITY;
	for (const cut of cuts) {
		const head = chars.slice(0, cut).join("").trimEnd();
		const tail = chars
			.slice(atSpace ? cut + 1 : cut)
			.join("")
			.trimStart();
		if (!head || !tail) continue;
		const w = Math.max(textEm(head), textEm(tail));
		if (w < bestW) {
			bestW = w;
			best = [head, tail];
		}
	}
	return best;
}

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

/**
 * Fit a title in `widthPx`: one line down to `min1`, then two balanced lines
 * down to `min2`, then two lines at `min2` with the second ellipsized
 */
export function fitTitle(
	text: string,
	widthPx: number,
	opts: { max: number; min1: number; max2: number; min2: number } = {
		max: 19,
		min1: 15,
		max2: 14.5,
		min2: 12.5,
	},
): { lines: string[]; px: number } {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return { lines: [""], px: opts.max };
	const one = fitEm(textEm(clean) * BOLD_SLACK, widthPx, opts.max);
	if (one >= opts.min1) return { lines: [clean], px: one };
	// The split at a space wins ties; a CJK split anywhere wins when it fits larger
	const splits = [balancedSplit(clean)];
	if (CJK.test(clean)) splits.push(balancedSplit(clean, true));
	let best: { lines: string[]; px: number } | null = null;
	for (const split of splits) {
		if (!split) continue;
		const two = fitEm(
			Math.max(textEm(split[0]), textEm(split[1])) * BOLD_SLACK,
			widthPx,
			opts.max2,
		);
		if (two >= opts.min2 && (!best || two > best.px))
			best = { lines: split, px: two };
	}
	if (best) return best;
	const cap = widthPx / (opts.min2 * BOLD_SLACK);
	const [a, b] = wrapTwo(clean, cap);
	return { lines: b ? [a, b] : [a], px: opts.min2 };
}

/** Typographic minus (U+2212): as wide as "+" in the numeric font */
const MINUS = "\u2212";

function delta(d: number | undefined, digits: number, unit = ""): Delta {
	if (d == null) return { text: "", cls: "" };
	const eps = 0.5 * 10 ** -digits;
	if (Math.abs(d) < eps)
		return { text: `±${(0).toFixed(digits)}${unit}`, cls: "tl-flat" };
	return d > 0
		? { text: `+${d.toFixed(digits)}${unit}`, cls: "tl-up" }
		: { text: `${MINUS}${Math.abs(d).toFixed(digits)}${unit}`, cls: "tl-down" };
}

/**
 * Accuracy change in percentage points, at 2 dp like the game shows accuracy; a
 * non-zero change below 0.005 keeps 4 dp so it never reads as ±0.00%
 */
function accDelta(d: number | undefined): Delta {
	if (d != null && Math.abs(d) >= 0.00005 && Math.abs(d) < 0.005)
		return delta(d, 4, "%");
	return delta(d, 2, "%");
}

/** Score as Phigros shows it: 7 digits, the leading zeros dimmed */
function scoreParts(score: number): { lead: string; main: string } {
	const full = String(Math.max(0, Math.round(score))).padStart(7, "0");
	const main = full.replace(/^0+/, "") || "0";
	return { lead: full.slice(0, full.length - main.length), main };
}

/**
 * Advance widths (em) in the numeric font (NOTO, tabular figures) for what the
 * number columns show; anything else falls back to the text-fit table
 */
const NUM_EM: Record<string, number> = {
	".": 0.268,
	"%": 0.831,
	"+": 0.572,
	"-": 0.322,
	[MINUS]: 0.551,
	"±": 0.572,
};

export function numEm(text: string): number {
	let em = 0;
	for (const ch of text)
		em += NUM_EM[ch] ?? (ch >= "0" && ch <= "9" ? 0.572 : textEm(ch));
	return em;
}

/** Font size for a "before" line: shrinks only when a value overflows its box */
function wasPx(parts: [string, number][]) {
	let px = WAS_PX;
	for (const [text, boxPx] of parts)
		if (text) px = Math.min(px, fitEm(numEm(text), boxPx, WAS_PX));
	return Math.max(11, px);
}

function songIdOf(ill: string): string {
	const m = /([^/\\]+)\.png$/i.exec(ill);
	return m ? `${m[1]}.0` : "";
}

function rankCls(rank: string) {
	return `tl-r-${RANKS.includes(rank) ? rank.toLowerCase() : "unknown"}`;
}

function constText(c: number | undefined) {
	if (c == null || !(c > 0)) return "";
	return c.toFixed(1);
}

function entryOf(
	raw: unknown,
	lookup: ConstLookup,
	b30: Set<string>,
): TimelineEntry {
	const t = rec(raw);
	const song = str(t.song);
	const rank = str(t.rank).toUpperCase();
	const ill = str(t.illustration);
	const id = songIdOf(ill);
	const fit = fitTitle(song, TITLE_W);
	const scoreNew = num(t.score_new) ?? 0;
	const scoreOld = num(t.score_old);
	const accNew = num(t.acc_new) ?? 0;
	const accOld = num(t.acc_old);
	const rksNew = num(t.rks_new) ?? 0;
	const rksOld = num(t.rks_old);
	const isNew = scoreOld == null && accOld == null;
	const s = scoreParts(scoreNew);
	const sOld =
		scoreOld == null ? "" : String(Math.max(0, Math.round(scoreOld)));
	const sDelta =
		scoreOld == null ? delta(undefined, 0) : delta(scoreNew - scoreOld, 0);
	const aOld = accOld == null ? "" : accOld.toFixed(4);
	const aDelta = accDelta(accOld == null ? undefined : accNew - accOld);
	const cText = constText(lookup(id, rank, song));
	// With a known constant rks_old 0 is real (below 70%), so the change still counts
	const rDelta =
		rksNew > 0 && !isNew && rksOld != null
			? delta(rksNew - rksOld, 4)
			: delta(undefined, 4);
	const grade = str(t.Rating);
	return {
		ill,
		titleLines: fit.lines,
		titlePx: fit.px,
		twoLine: fit.lines.length > 1,
		rank,
		rankCls: rankCls(rank),
		constText: cText,
		grade: GRADES.includes(grade) ? grade : "",
		ap: grade === "phi",
		isNew,
		inB30: b30.has(`${id}|${rank}`),
		scoreLead: s.lead,
		scoreMain: s.main,
		scoreOld: sOld,
		scoreDelta: sDelta,
		scoreWasPx: wasPx([
			[sOld, SCORE_OLD_W],
			[sDelta.text, SCORE_DELTA_W],
		]),
		acc: `${accNew.toFixed(4)}%`,
		accOld: aOld,
		accDelta: aDelta,
		accWasPx: wasPx([
			[aOld, ACC_OLD_W],
			[aDelta.text, ACC_DELTA_W],
		]),
		rks: rksNew > 0 || cText ? rksNew.toFixed(4) : "",
		rksDelta: rDelta,
		rksWasPx: wasPx([[rDelta.text, RKS_W]]),
	};
}

function splitStamp(stamp: string): { day: string; time: string } {
	const [day = "", time = ""] = stamp.trim().split(/\s+/);
	return { day, time };
}

function weekday(day: string, copy: Copy): string {
	const m = /^(\d{4})\D(\d{1,2})\D(\d{1,2})$/.exec(day);
	if (!m) return "";
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return Number.isFinite(d.getTime())
		? (copy.weekdays[d.getUTCDay()] ?? "")
		: "";
}

type RawGroup = { stamp: string; updates: number; tiles: unknown[] };

/** Regroup box_line rows (5 tiles each) into one group per upload */
export function regroupBoxLine(boxLine: unknown): RawGroup[] {
	const groups: RawGroup[] = [];
	for (const row of list(boxLine)) {
		for (const rawBox of list(row)) {
			const box = rec(rawBox);
			const tiles = list(box.song);
			let group = groups[groups.length - 1];
			if (typeof box.date === "string" || !group) {
				group = { stamp: str(box.date), updates: 0, tiles: [] };
				groups.push(group);
			}
			group.tiles.push(...tiles);
			const n = num(box.update_num);
			if (n != null) group.updates = n;
		}
	}
	for (const g of groups) g.updates = Math.max(g.updates, g.tiles.length);
	return groups;
}

/** Merge upload groups (already newest first) that share a calendar day */
export function groupDays(
	groups: RawGroup[],
): { day: string; times: string[]; updates: number; tiles: unknown[] }[] {
	const days: {
		day: string;
		times: string[];
		updates: number;
		tiles: unknown[];
	}[] = [];
	for (const g of groups) {
		const { day, time } = splitStamp(g.stamp);
		let cur = days[days.length - 1];
		if (!cur || cur.day !== day) {
			cur = { day, times: [], updates: 0, tiles: [] };
			days.push(cur);
		}
		if (time) cur.times.push(time);
		cur.updates += g.updates;
		cur.tiles.push(...g.tiles);
	}
	return days;
}

/** Upload times as HH:MM, newest first */
function timesLabel(times: string[]) {
	const short = times.map((t) => t.slice(0, 5));
	return short.length > 3
		? `${short.slice(0, 3).join(" · ")} +${short.length - 3}`
		: short.join(" · ");
}

function f(n: number) {
	return Number(n.toFixed(2));
}

/** RKS trend as inline SVG; segment y is measured up from rks_range[0] */
export function chartOf(
	segs: unknown,
	range: unknown,
	dates: unknown,
): TimelineChart | null {
	const lines = list(segs)
		.map((s) => list(s).slice(0, 4).map(num))
		.filter((s): s is number[] => s.length === 4 && s.every((v) => v != null));
	if (!lines.length) return null;
	const r = list(range);
	const lo = num(r[0]) ?? 0;
	const hi = num(r[1]) ?? lo + 1;
	const pts: [number, number][] = [];
	const push = (x: number, y: number) => {
		const prev = pts[pts.length - 1];
		if (!prev || prev[0] !== x || prev[1] !== y) pts.push([x, y]);
	};
	for (const [x1, y1, x2, y2] of lines as [number, number, number, number][]) {
		push(x1, y1);
		push(x2, y2);
	}
	const value = (y: number) => lo + (y / 100) * (hi - lo);
	const v0 = value(pts[0]![1]);
	const v1 = value(pts[pts.length - 1]![1]);
	const ds = list(dates).map(str);
	const a = splitStamp(ds[0] ?? "");
	const b = splitStamp(ds[1] ?? "");
	const sameDay = a.day === b.day;
	const flat = pts.every(([, y]) => y === pts[0]![1]);
	if (flat && str(ds[0]) === str(ds[1]))
		return {
			single: true,
			svg: "",
			max: "",
			mid: "",
			min: "",
			from: str(ds[1]),
			to: str(ds[1]),
			first: v1.toFixed(4),
			last: v1.toFixed(4),
			change: delta(undefined, 4),
		};
	const innerW = CHART_W - 2 * CHART_PAD_X;
	const innerH = CHART_H - 2 * CHART_PAD_Y;
	const px = (x: number) =>
		f(CHART_PAD_X + (Math.min(100, Math.max(0, x)) / 100) * innerW);
	const py = (y: number) =>
		f(CHART_PAD_Y + (1 - Math.min(100, Math.max(0, y)) / 100) * innerH);
	const xy = pts.map(([x, y]) => [px(x), py(y)] as const);
	const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
	const base = CHART_H - CHART_PAD_Y;
	const first = xy[0]!;
	const last = xy[xy.length - 1]!;
	const area = `${d} L${last[0]} ${base} L${first[0]} ${base} Z`;
	const r0 = xy.length > 20 ? 2.6 : 3.4;
	const grid = [CHART_PAD_Y, CHART_H / 2, base]
		.map(
			(y) =>
				`<line x1="0" y1="${y}" x2="${CHART_W}" y2="${y}" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1" stroke-dasharray="4 6"/>`,
		)
		.join("");
	const dots = (xy.length > CHART_MAX_DOTS ? [] : xy.slice(0, -1))
		.map(
			([x, y]) =>
				`<circle cx="${x}" cy="${y}" r="${r0}" fill="#0d1526" stroke="#5fd4ff" stroke-width="1.8"/>`,
		)
		.join("");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">` +
		`<defs><linearGradient id="tlArea" x1="0" y1="0" x2="0" y2="1">` +
		`<stop offset="0" stop-color="#5fd4ff" stop-opacity="0.32"/>` +
		`<stop offset="1" stop-color="#5fd4ff" stop-opacity="0"/></linearGradient></defs>` +
		grid +
		`<path d="${area}" fill="url(#tlArea)" stroke="none"/>` +
		`<path d="${d}" fill="none" stroke="#5fd4ff" stroke-opacity="0.22" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>` +
		`<path d="${d}" fill="none" stroke="#5fd4ff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
		dots +
		`<circle cx="${last[0]}" cy="${last[1]}" r="9" fill="#5fd4ff" fill-opacity="0.22"/>` +
		`<circle cx="${last[0]}" cy="${last[1]}" r="4.6" fill="#ffffff" stroke="#5fd4ff" stroke-width="2"/>` +
		`</svg>`;
	return {
		single: false,
		svg,
		max: flat ? "" : hi.toFixed(4),
		mid: flat ? v1.toFixed(4) : ((lo + hi) / 2).toFixed(4),
		min: flat ? "" : lo.toFixed(4),
		from: sameDay ? str(ds[0]) : a.day,
		to: sameDay ? str(ds[1]) : b.day,
		first: v0.toFixed(4),
		last: v1.toFixed(4),
		change: delta(v1 - v0, 4),
	};
}

/** "song id|rank" pairs of the newest B30 snapshot (P3 + B27) */
function latestB30(snaps: unknown): Set<string> {
	const all = list(snaps);
	const last = rec(all[all.length - 1]);
	const out = new Set<string>();
	for (const row of [...list(last.phi), ...list(last.b27)]) {
		const r = rec(row);
		if (r.id) out.add(`${str(r.id)}|${str(r.rank)}`);
	}
	return out;
}

/**
 * Split PlayerId's rich-text HTML at <br> into self-contained lines: tags still open
 * at a break are closed there and reopened on the next line
 */
export function splitRichLines(html: string): string[] {
	const lines: string[] = [];
	const open: { name: string; tag: string }[] = [];
	let cur = "";
	for (const m of html.matchAll(/<[^>]*>|[^<]+/g)) {
		const tok = m[0];
		const tag = /^<(\/?)([a-z0-9]+)/i.exec(tok);
		if (!tag) {
			cur += tok;
			continue;
		}
		const name = tag[2]!.toLowerCase();
		if (name === "br") {
			lines.push(
				cur +
					open
						.map((t) => `</${t.name}>`)
						.reverse()
						.join(""),
			);
			cur = open.map((t) => t.tag).join("");
		} else if (tag[1]) {
			const at = open.map((t) => t.name).lastIndexOf(name);
			if (at >= 0) open.splice(at, 1);
			cur += tok;
		} else {
			if (!tok.endsWith("/>")) open.push({ name, tag: tok });
			cur += tok;
		}
	}
	lines.push(cur);
	return lines;
}

/** Visible text of PlayerId's rich-text HTML, one entry per line */
export function richTextLines(html: string): string[] {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.split("\n");
}

function taskOf(raw: unknown, copy: Copy): TimelineTask | null {
	const t = rec(raw);
	if (!t.song) return null;
	const req = rec(t.request);
	const rank = str(req.rank).toUpperCase();
	const fit = fitTitle(str(t.song), TASK_TITLE_W, {
		max: 18,
		min1: 14,
		max2: 15,
		min2: 12,
	});
	const kind = str(req.type) === "acc" ? copy.taskAcc : copy.taskScore;
	return {
		ill: str(t.illustration),
		titleLines: fit.lines,
		titlePx: fit.px,
		rank,
		rankCls: rankCls(rank),
		request: `${kind} ≥ ${str(req.value)}`,
		done: t.finished === true,
		status: t.finished === true ? copy.taskDone : copy.taskOpen,
	};
}

export function defaultConstLookup(
	info: Pick<typeof getInfo, "raw" | "SongGetId"> = getInfo,
): ConstLookup {
	return (songId, rank, song) => {
		const row =
			(songId && info.raw(songId)) || info.raw(info.SongGetId(song) ?? "");
		const d = row?.chart?.[rank]?.difficulty;
		return Number.isFinite(d) ? d : undefined;
	};
}

/** Name size per visible line, so it stays inside the header */
export function nameFontPx(lines: string[]): number {
	const em = Math.max(0, ...lines.map(textEm)) * BOLD_SLACK;
	const rows = Math.max(1, lines.length);
	const byHeight = (n: number) => Math.floor(NAME_H / (n * 1.2));
	const one = Math.min(fitEm(em, NAME_W, 38), byHeight(rows));
	if (one >= 22 || rows > 1) return Math.max(16, one);
	// Wrapped rows are uneven: leave 8% for the break position
	return Math.max(16, Math.min(byHeight(2), fitEm(em * 0.54, NAME_W, 26)));
}

/** Everything the template shows, derived from the classic hisb30 data */
export function buildTimeline(
	data: CardData,
	locale: PhiLocale,
	lookup: ConstLookup,
): TimelineView {
	const copy = COPY[locale];
	const b30 = latestB30(data.hisb30Snaps);
	const days = groupDays(regroupBoxLine(data.box_line)).map(
		(d, i): TimelineDay => ({
			date: d.day,
			weekday: weekday(d.day, copy),
			times: timesLabel(d.times),
			updates: d.updates,
			count: copy.dayCount(d.updates),
			shown: d.tiles.length < d.updates ? copy.dayShown(d.tiles.length) : "",
			latest: i === 0,
			entries: d.tiles.map((tile) => entryOf(tile, lookup, b30)),
		}),
	);
	const total = days.reduce((n, d) => n + d.updates, 0);
	const nameHtml = str(data.PlayerId);
	const nameLines = richTextLines(nameHtml);
	const mode = num(data.ChallengeMode) ?? 0;
	const clgRank = num(data.ChallengeModeRank) ?? 0;
	const rksNum = num(data.Rks);
	const added = str(list(data.added_rks_notes)[0]).trim();
	const tasks = list(data.task_data)
		.map((t) => taskOf(t, copy))
		.filter((t): t is TimelineTask => t != null);
	return {
		nameLines: splitRichLines(nameHtml),
		namePx: nameFontPx(nameLines),
		rks: rksNum == null ? str(data.Rks) : rksNum.toFixed(4),
		rksDelta: !added
			? { text: "", cls: "" }
			: added.startsWith("-")
				? { text: `${MINUS}${added.slice(1)}`, cls: "tl-down" }
				: { text: added, cls: "tl-gold" },
		challenge: clgRank > 0 ? { mode, rank: clgRank } : null,
		saveDate: str(data.Date),
		chart: chartOf(data.rks_history, data.rks_range, data.rks_date),
		tasks,
		taskTime: str(data.task_time),
		days,
		total: copy.updatesTotal(total, days.length),
		empty: days.length === 0,
	};
}

export const variant: CardVariant = {
	tpl: "update-timeline",
	width: 800,
	prepare: (data, ctx: VariantContext) => {
		const lookup = defaultConstLookup(ctx.rt?.getInfo ?? getInfo);
		return {
			...data,
			vt: COPY[ctx.locale],
			tl: buildTimeline(data, ctx.locale, lookup),
		};
	},
};
