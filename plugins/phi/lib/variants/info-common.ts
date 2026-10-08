import type { PhiLocale } from "../card-i18n.ts";
import { fitFontPx, textEm } from "../text-fit.ts";
import type { CardData } from "./types.ts";

/** Shared view model for the info layouts: fitted text, per-difficulty progress, charts in pixels */

const LEVELS = ["EZ", "HD", "IN", "AT"] as const;

const COPY = {
	en: {
		kicker: "Player profile",
		rks: "RKS",
		challenge: "Challenge",
		data: "Data",
		intro: "Self-introduction",
		levels: "Progress by difficulty",
		unlocked: "Unlocked",
		cleared: "Cleared",
		fc: "Full combo",
		phi: "φ (all perfect)",
		phiShort: "φ",
		score: "Score",
		best: "Best",
		lowest: "Lowest",
		charts: "Trends",
		rksTrend: "RKS over time",
		dataTrend: "Data over time",
		accTitle: "RKS if every score below an accuracy were dropped",
		accNote:
			"Each point: your RKS counting only scores at or above that accuracy",
		noTrend: "No history yet. Refresh your save a few times to build one.",
		total: "Total",
		charts_: "charts",
		clearRate: "Clear rate",
		tip: "Tip",
		generated: "Generated",
		level: "Level",
	},
	zh: {
		kicker: "玩家资料",
		rks: "RKS",
		challenge: "课题模式",
		data: "Data",
		intro: "个人简介",
		levels: "各难度进度",
		unlocked: "已解锁",
		cleared: "已通关",
		fc: "Full Combo",
		phi: "φ（全 Perfect）",
		phiShort: "φ",
		score: "总分",
		best: "最高",
		lowest: "最低",
		charts: "走势",
		rksTrend: "RKS 走势",
		dataTrend: "Data 走势",
		accTitle: "剔除某 ACC 以下成绩后的 RKS",
		accNote: "每个点：只计入不低于该 ACC 的成绩时的 RKS",
		noTrend: "还没有历史记录。多刷新几次存档后这里会出现走势。",
		total: "合计",
		charts_: "谱面",
		clearRate: "通关率",
		tip: "提示",
		generated: "生成于",
		level: "难度",
	},
};

export type InfoCopy = (typeof COPY)["en"];

export function infoCopy(locale: PhiLocale): InfoCopy {
	return locale === "zh" ? COPY.zh : COPY.en;
}

export type ChartBox = { w: number; h: number };

/** Width right of each plot that holds its max / min labels */
export const CHART_GUTTER = 84;

export type InfoChart = {
	w: number;
	h: number;
	line: string;
	area: string;
	dots: { x: number; y: number }[];
	last: { x: number; y: number };
	yTop: string;
	yBottom: string;
	xTicks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
	/** Horizontal grid lines (px from the top) */
	grid: number[];
};

export type InfoLevel = {
	key: (typeof LEVELS)[number];
	rating: string;
	unlocked: number;
	total: number;
	cleared: number;
	fc: number;
	phi: number;
	/** Bar widths in % of unlocked charts */
	clearedPct: number;
	fcPct: number;
	phiPct: number;
	clearRate: string;
	score: string;
	scoreMax: string;
	scorePct: string;
	best: string;
	lowest: string;
	empty: boolean;
};

export type InfoGeometry = {
	nameW: number;
	nameMax: number;
	nameMin: number;
	introW: number;
	introMaxLines: number;
	introMax: number;
	introMin: number;
	rks: ChartBox;
	data: ChartBox;
	acc: ChartBox;
};

function num(v: unknown, fallback = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : v == null ? "" : String(v);
}

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

/** Visible text of rich-text HTML (PlayerId, selfIntro), `<br>` as newlines */
export function richPlain(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
		.replace(/\r/g, "");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Wrapped line count of `text` at `px` in a `widthPx` box (newlines kept) */
export function lineCount(text: string, widthPx: number, px: number): number {
	let lines = 0;
	for (const para of text.split("\n")) {
		const em = textEm(para.trim());
		lines += Math.max(1, Math.ceil((em * px) / widthPx));
	}
	return lines;
}

/** Largest intro size that fits `maxLines`; else plain text cut with "…" */
export function fitIntro(
	html: string,
	widthPx: number,
	opts: { maxLines: number; max: number; min: number },
): { html: string; px: number; lines: number } | null {
	const plain = richPlain(html)
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.join("\n");
	if (!plain) return null;
	// 10% slack: Latin text measures a little narrower than it renders here
	const width = widthPx * 0.9;
	for (let px = opts.max; px >= opts.min; px--) {
		const lines = lineCount(plain, width, px);
		if (lines <= opts.maxLines) return { html: cleanIntro(html), px, lines };
	}
	// Too many short lines: let them flow as one paragraph before cutting
	const flowing = plain.replace(/\n/g, " ");
	for (let px = opts.max; px >= opts.min; px--) {
		const lines = lineCount(flowing, width, px);
		if (lines <= opts.maxLines)
			return {
				html: cleanIntro(html).replace(/<br\s*\/?>/gi, " "),
				px,
				lines,
			};
	}
	const px = opts.min;
	const budget = Math.floor((width / px) * opts.maxLines) - 2;
	let out = "";
	let used = 0;
	for (const ch of plain.replace(/\n/g, " ")) {
		const w = textEm(ch);
		if (used + w > budget) break;
		out += ch;
		used += w;
	}
	return {
		html: `${escapeHtml(out.trimEnd())}…`,
		px,
		lines: opts.maxLines,
	};
}

/** Rich-text intro without the save's stray carriage returns and blank lines */
function cleanIntro(html: string): string {
	return html
		.replace(/\r/g, "")
		.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>")
		.replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, "");
}

/** "601.0 MiB" from a KiB total (the data line counts KiB) */
export function fmtKiB(kib: number): string {
	const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
	let v = Math.max(0, kib);
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function fmtInt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

function pct(part: number, whole: number): number {
	if (!(whole > 0)) return 0;
	return Math.max(0, Math.min(100, (part / whole) * 100));
}

function shortDate(raw: string): string {
	return raw.split(" ")[0] ?? raw;
}

/**
 * Chart geometry from history segments `[x1%, y1%, x2%, y2%]` (y measured up
 * from the range minimum), in a `w`×`h` px box with 8 px of headroom
 */
export function buildChart(
	segs: unknown,
	box: ChartBox,
	labels: {
		yTop: string;
		yBottom: string;
		xTicks: { pct: number; label: string }[];
	},
): InfoChart | null {
	if (!Array.isArray(segs) || !segs.length) return null;
	const pad = 8;
	const padX = 6;
	const plotW = box.w - CHART_GUTTER;
	const innerH = box.h - pad * 2;
	const innerW = plotW - padX * 2;
	const at = (xPct: number, yPct: number) => ({
		x:
			Math.round(
				(padX + (Math.max(0, Math.min(100, xPct)) / 100) * innerW) * 10,
			) / 10,
		y:
			Math.round(
				(pad + innerH - (Math.max(0, Math.min(100, yPct)) / 100) * innerH) * 10,
			) / 10,
	});
	const pts: { x: number; y: number }[] = [];
	for (const seg of segs) {
		if (!Array.isArray(seg) || seg.length < 4) continue;
		const [x1, y1, x2, y2] = seg.map((v) => num(v));
		if (!pts.length) pts.push(at(x1!, y1!));
		pts.push(at(x2!, y2!));
	}
	if (pts.length < 2) return null;
	const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
	const first = pts[0]!;
	const last = pts[pts.length - 1]!;
	const area = `${line} L${last.x} ${box.h} L${first.x} ${box.h} Z`;
	// Grid lines run under the range labels in the gutter too
	const ticks = labels.xTicks.map((t) => {
		const x = Math.round(padX + (t.pct / 100) * innerW);
		const anchor: "start" | "middle" | "end" =
			t.pct <= 2 ? "start" : t.pct >= 98 ? "end" : "middle";
		return { x, label: t.label, anchor };
	});
	return {
		w: plotW,
		h: box.h,
		line,
		area,
		dots: pts.length <= 24 ? pts : [],
		last,
		yTop: labels.yTop,
		yBottom: labels.yBottom,
		xTicks: ticks,
		grid: [pad, pad + innerH / 2, pad + innerH].map((y) => Math.round(y)),
	};
}

export type InfoView = {
	copy: InfoCopy;
	nameHtml: string;
	namePx: number;
	rks: string;
	challenge: { mode: number; rank: number } | null;
	dataText: string;
	avatar: string;
	banner: string;
	intro: { html: string; px: number; lines: number } | null;
	levels: InfoLevel[];
	totals: {
		unlocked: number;
		total: number;
		cleared: number;
		fc: number;
		phi: number;
		clearRate: string;
		score: string;
		scoreMax: string;
		scorePct: string;
	};
	charts: {
		rks: InfoChart | null;
		data: InfoChart | null;
		acc: InfoChart | null;
		rksRange: [string, string];
		dataRange: [string, string];
		accRange: [string, string];
		rksDates: [string, string];
	};
	/** RKS and data trends, in the order the layouts draw them */
	trends: { chart: InfoChart | null; title: string; value: string }[];
	tip: string;
	generated: string;
};

/** View model for one info layout; `geo` gives its text widths and chart boxes */
export function infoView(
	data: CardData,
	locale: PhiLocale,
	geo: InfoGeometry,
	now: Date = new Date(),
): InfoView {
	const copy = infoCopy(locale);
	const user = (data.gameuser ?? {}) as Record<string, unknown>;
	const nameHtml = str(user.PlayerId) || "—";
	const namePlain = richPlain(nameHtml).replace(/\n/g, " ").trim() || "—";
	const namePx = Math.max(
		geo.nameMin,
		fitFontPx(namePlain, geo.nameW * 0.92, geo.nameMax),
	);
	const mode = Math.round(num(user.ChallengeMode));
	const rank = Math.round(num(user.ChallengeModeRank));
	const dataText = str(user.data).trim();
	const stats = Array.isArray(data.userstats) ? data.userstats : [];
	const levels: InfoLevel[] = LEVELS.map((key, i) => {
		const s = (stats[i] ?? {}) as Record<string, unknown>;
		const unlocked = num(s.unlock);
		const total = num(s.tot);
		const cleared = num(s.cleared);
		const fc = num(s.fc);
		const phi = num(s.phi);
		const real = num(s.real_score);
		const max = num(s.tot_score);
		const best = num(s.highest);
		const low = num(s.lowest);
		return {
			key,
			rating: cleared === 0 && real === 0 ? "" : str(s.Rating),
			unlocked,
			total,
			cleared,
			fc,
			phi,
			clearedPct: pct(cleared, unlocked),
			fcPct: pct(fc, unlocked),
			phiPct: pct(phi, unlocked),
			clearRate: `${pct(cleared, unlocked).toFixed(1)}%`,
			score: fmtInt(real),
			scoreMax: fmtInt(max),
			scorePct: max > 0 ? `${((real / max) * 100).toFixed(2)}%` : "—",
			best: best > 0 ? best.toFixed(2) : "—",
			lowest: low > 0 ? low.toFixed(2) : "—",
			empty: cleared === 0 && real === 0,
		};
	});
	const sum = (f: (l: InfoLevel) => number) =>
		levels.reduce((a, l) => a + f(l), 0);
	const realSum = stats.reduce(
		(a: number, s) => a + num((s as Record<string, unknown>).real_score),
		0,
	);
	const maxSum = stats.reduce(
		(a: number, s) => a + num((s as Record<string, unknown>).tot_score),
		0,
	);
	const totals = {
		unlocked: sum((l) => l.unlocked),
		total: sum((l) => l.total),
		cleared: sum((l) => l.cleared),
		fc: sum((l) => l.fc),
		phi: sum((l) => l.phi),
		clearRate: `${pct(
			sum((l) => l.cleared),
			sum((l) => l.unlocked),
		).toFixed(1)}%`,
		score: fmtInt(realSum),
		scoreMax: fmtInt(maxSum),
		scorePct: maxSum > 0 ? `${((realSum / maxSum) * 100).toFixed(2)}%` : "—",
	};

	const rksRange = Array.isArray(data.rks_range) ? data.rks_range : [];
	const dataRange = Array.isArray(data.data_range) ? data.data_range : [];
	const accRange = Array.isArray(data.acc_rks_range) ? data.acc_rks_range : [];
	const rksDates = (
		Array.isArray(data.rks_date) ? data.rks_date : ["", ""]
	).map((d) => shortDate(str(d))) as [string, string];
	const dataDates = (
		Array.isArray(data.data_date) ? data.data_date : ["", ""]
	).map((d) => shortDate(str(d))) as [string, string];
	const fmtRks = (v: unknown) => (num(v) > 0 ? num(v).toFixed(4) : "—");
	const fmtData = (v: unknown) => (num(v) > 0 ? fmtKiB(num(v)) : "—");
	const accTicks = (
		Array.isArray(data.acc_rks_AccRange) ? data.acc_rks_AccRange : []
	)
		.filter((t): t is [number, number] => Array.isArray(t) && t.length >= 2)
		.map(([acc, at]) => ({
			pct: num(at),
			label: `${num(acc) % 1 === 0 ? num(acc) : num(acc).toFixed(2)}%`,
		}));

	const tips = str(data.tips).trim();
	const charts: InfoView["charts"] = {
		rks: buildChart(data.rks_history, geo.rks, {
			yTop: fmtRks(rksRange[1]),
			yBottom: fmtRks(rksRange[0]),
			xTicks: [
				{ pct: 0, label: rksDates[0] },
				{ pct: 100, label: rksDates[1] },
			],
		}),
		data: buildChart(data.data_history, geo.data, {
			yTop: fmtData(dataRange[1]),
			yBottom: fmtData(dataRange[0]),
			xTicks: [
				{ pct: 0, label: dataDates[0] },
				{ pct: 100, label: dataDates[1] },
			],
		}),
		acc: buildChart(data.acc_rks_data, geo.acc, {
			yTop: fmtRks(accRange[1]),
			yBottom: fmtRks(accRange[0]),
			xTicks: accTicks,
		}),
		rksRange: [fmtRks(rksRange[0]), fmtRks(rksRange[1])],
		dataRange: [fmtData(dataRange[0]), fmtData(dataRange[1])],
		accRange: [fmtRks(accRange[0]), fmtRks(accRange[1])],
		rksDates,
	};
	return {
		copy,
		nameHtml,
		namePx,
		rks: num(user.rks).toFixed(4),
		challenge: mode > 0 && rank > 0 ? { mode, rank } : null,
		dataText: dataText && dataText !== "0KiB" ? dataText : "",
		avatar: str(user.avatar),
		banner: str(user.backgroundurl),
		intro: fitIntro(str(user.selfIntro), geo.introW, {
			maxLines: geo.introMaxLines,
			max: geo.introMax,
			min: geo.introMin,
		}),
		levels,
		totals,
		charts,
		trends: [
			{
				chart: charts.rks,
				title: copy.rksTrend,
				value: num(user.rks) > 0 ? num(user.rks).toFixed(4) : "—",
			},
			{
				chart: charts.data,
				title: copy.dataTrend,
				value: dataText && dataText !== "0KiB" ? dataText : "—",
			},
		],
		tip: tips,
		generated: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`,
	};
}
