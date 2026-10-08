import type { PhiLocale } from "../card-i18n.ts";
import {
	type Board,
	fmtCount,
	fmtTopPercent,
	type Placement,
} from "../leaderboard.ts";
import type { LookupState, SongCardData, SongLevelRow } from "../song-card.ts";
import { fitFontPx, textEm } from "../text-fit.ts";
import { splitTitle } from "./b19-portrait.ts";
import type { CardData, CardVariant } from "./types.ts";

/** Per-song card: prepare() turns song-card.ts numbers into the strings and offsets the template prints */

const COPY = {
	en: {
		eyebrow: "SONG LEADERBOARD",
		composer: "Composer",
		charter: "Charter",
		notes: "{n} notes",
		record: "YOUR RECORD",
		score: "SCORE",
		acc: "ACCURACY",
		chartRks: "CHART RKS",
		noRecord: "No record on this chart yet",
		noRecordSub: "Play it and sync your save to see where you would place.",
		standing: "STANDING",
		standingMeta: "Estimated from your accuracy",
		allRecords: "ALL RECORDS",
		allSub: "Among every phib19.top record on this chart",
		allSubN: "Among {n} phib19.top records on this chart, plus you",
		band: "RKS {a}–{b}",
		bandSub: "Among records set by players at a similar RKS",
		bandSubN: "Among {n} records set at a similar RKS, plus you",
		top: "Top {p}%",
		apShare: "AP · {p}% of records",
		apShort: "AP {p}%",
		tiedAp: "Tied with {n} other AP records",
		dist: "ACCURACY DISTRIBUTION",
		distMeta: "Non-AP records in {s}% steps",
		distBelow: "{n} records below {lo}%",
		you: "YOU",
		ap: "AP",
		median: "Median",
		top25: "Top 25%",
		top10: "Top 10%",
		field: "Your place in the field",
		counts: "AP / FC",
		records: "RECORDS",
		recordsSub: "phib19.top records on this chart",
		apRate: "ALL PERFECT",
		fcRate: "FULL COMBO",
		ofRecords: "{p}% of records",
		fcSub: "{p}% of records · incl. AP",
		levels: "ALL LEVELS",
		colLevel: "LEVEL",
		colScore: "SCORE",
		colAcc: "ACC",
		colPos: "POSITION",
		colAp: "AP RATE",
		late: "phib19.top is slow right now. This fills in on the next refresh.",
		failed: "phib19.top did not answer. Try again in a minute.",
		unavailable: "Leaderboard data isn't available right now.",
		off: "Online leaderboard lookups are off in your settings.",
		empty: "phib19.top has no records on this chart yet.",
		foot: "You are not in phib19.top's dataset, so your position is estimated from your accuracy. Ties share a rank, so every AP is #1. Only anonymous totals are used: no other player is named.",
		source: "Data: phib19.top · {d}",
	},
	zh: {
		eyebrow: "单曲排行",
		composer: "曲师",
		charter: "谱师",
		notes: "物量 {n}",
		record: "你的成绩",
		score: "分数",
		acc: "准度",
		chartRks: "单曲 RKS",
		noRecord: "还没有这张谱面的成绩",
		noRecordSub: "游玩并同步存档后，即可看到你的位置。",
		standing: "排名",
		standingMeta: "按准度估算",
		allRecords: "全部记录",
		allSub: "在 phib19.top 该谱面的全部记录中",
		allSubN: "在 phib19.top 该谱面的 {n} 条记录中",
		band: "RKS {a}–{b}",
		bandSub: "在 RKS 相近的玩家的记录中",
		bandSubN: "在 RKS 相近玩家的 {n} 条记录中",
		top: "前 {p}%",
		apShare: "AP · 占记录 {p}%",
		apShort: "AP {p}%",
		tiedAp: "与另外 {n} 条 AP 记录并列",
		dist: "准度分布",
		distMeta: "非 AP 记录，每格 {s}%",
		distBelow: "另有 {n} 条记录低于 {lo}%",
		you: "你",
		ap: "AP",
		median: "中位数",
		top25: "前 25%",
		top10: "前 10%",
		field: "你在全部记录中的位置",
		counts: "AP / FC",
		records: "记录数",
		recordsSub: "phib19.top 上该谱面的记录",
		apRate: "AP",
		fcRate: "FC",
		ofRecords: "占记录的 {p}%",
		fcSub: "占记录的 {p}%（含 AP）",
		levels: "全部难度",
		colLevel: "难度",
		colScore: "分数",
		colAcc: "准度",
		colPos: "位置",
		colAp: "AP 率",
		late: "phib19.top 响应较慢，刷新后即可显示。",
		failed: "phib19.top 暂无响应，请稍后再试。",
		unavailable: "排行数据暂时不可用。",
		off: "在线排行查询已在设置中关闭。",
		empty: "phib19.top 上还没有这张谱面的记录。",
		foot: "位置按准度估算",
		source: "数据：phib19.top · {d}",
	},
} satisfies Record<PhiLocale, Record<string, string>>;

type Copy = (typeof COPY)["en"];

export const CARD_WIDTH = 800;
const CONTENT_W = CARD_WIDTH - 2 * 32;
/** Jacket 336 × 177 (the 2048 × 1080 art), 28 px gap, text column the rest */
const HERO_TEXT_W = CONTENT_W - 336 - 28;
const TITLE_MARGIN = 16;
/** Histogram: 15 px per bin (12 bar + 3 gap), then a gap and the AP column */
export const BIN_W = 15;
export const PLOT_H = 150;
const AP_GAP = 20;
const AP_W = 44;
/** Fixed boxes the template centres its labels in (song.css uses the same widths) */
const MARK_LABEL_W = 132;
const TICK_W = 60;
const STRIP_TICK_W = 90;
/** Percentile strip: 0 = the worst record (left), 100 = the best (right) */
export const STRIP_W = 600 + AP_GAP + AP_W;
/** Standing tiles: 2 × 356 with a 24 px gap; 24 px padding each side */
const TILE_TEXT_W = 356 - 48;
/** AP / FC meters (Takumi drops % widths inside them) */
const METER_W = 190;

function fill(text: string, vars: Record<string, string | number>) {
	return text.replace(/\{(\w+)\}/g, (m, k: string) =>
		k in vars ? String(vars[k]) : m,
	);
}

type FitText = { px: number; lines: string[] };

/** Cut `text` with "…" so it fits `widthPx` at `px` */
export function ellipsize(text: string, widthPx: number, px: number) {
	if (textEm(text) * px <= widthPx) return text;
	const chars = [...text];
	while (chars.length && textEm(`${chars.join("").trimEnd()}…`) * px > widthPx)
		chars.pop();
	return `${chars.join("").trimEnd()}…`;
}

/** One line shrunk to at least `min`; else two balanced lines at `wrap`; else cut */
export function fitLines(
	text: string,
	widthPx: number,
	opts: { max: number; min: number; wrap: number },
): FitText {
	const clean = text.replace(/\s+/g, " ").trim() || "?";
	const one = fitFontPx(clean, widthPx, opts.max);
	if (one >= opts.min) return { px: one, lines: [clean] };
	// Phrase-aware: "Retribution ~" / "Cycle of Redemption ~", not mid-phrase
	const [head, tail] = splitTitle(clean, widthPx / opts.wrap);
	if (tail) {
		const px = Math.min(
			fitFontPx(head, widthPx, opts.wrap),
			fitFontPx(tail, widthPx, opts.wrap),
		);
		if (px >= opts.min) return { px, lines: [head, tail] };
	}
	return { px: opts.min, lines: [ellipsize(clean, widthPx, opts.min)] };
}

/** Phigros prints scores as 7 digits: 0910415 */
export function fmtScore(score: number) {
	return String(Math.max(0, Math.round(score))).padStart(7, "0");
}

function fmtAcc(acc: number, digits = 4) {
	return `${acc.toFixed(digits)}%`;
}

/** "80", "97.5", "99.75": no trailing zeros */
function fmtTick(v: number) {
	return String(Math.round(v * 100) / 100);
}

function fmtRate(part: number, total: number) {
	if (!(total > 0)) return "0";
	const p = (part / total) * 100;
	return p > 0 && p < 0.1 ? "<0.1" : p.toFixed(1);
}

/** Filled px of a METER_W meter; anything above zero shows at least a dot */
function meterPx(part: number, total: number) {
	if (!(total > 0) || !(part > 0)) return 0;
	return Math.max(6, Math.round(Math.min(1, part / total) * METER_W));
}

function stateNote(state: LookupState, vt: Copy): string {
	if (state === "late") return vt.late;
	if (state === "failed") return vt.failed;
	if (state === "unavailable") return vt.unavailable;
	if (state === "off") return vt.off;
	return "";
}

/**
 * "Top 5.1%"; for an AP (#1, tied with every other AP) the AP share instead, since
 * "Top 9.8%" next to #1 would contradict it
 */
function placePct(place: Placement, vt: Copy, short = false) {
	const p = fmtTopPercent(place.percent);
	if (!place.ap) return fill(vt.top, { p });
	return fill(short ? vt.apShort : vt.apShare, { p });
}

type Tile = {
	label: string;
	ok: boolean;
	pos: string;
	posPx: number;
	of: string;
	pct: string;
	sub: string;
	note: string;
	ap: boolean;
};

function standingTile(
	label: string,
	sub: { plain: string; counted: string },
	place: Placement | null,
	state: LookupState,
	hasRecord: boolean,
	vt: Copy,
): Tile {
	if (!place) {
		// Without a record the record panel already says why; the tile stays quiet
		const note = !hasRecord
			? ""
			: stateNote(state, vt) || (state === "ok" ? vt.empty : "");
		return {
			label,
			ok: false,
			pos: "—",
			posPx: 44,
			of: "",
			pct: "",
			sub: sub.plain,
			note,
			ap: false,
		};
	}
	const pos = `#${fmtCount(place.rank)}`;
	const of = `/ ${fmtCount(place.of)}`;
	// The big number gives way to the "/ total" next to it (18 px, 10 px gap)
	const room = TILE_TEXT_W - textEm(of) * 18 - 10;
	return {
		label,
		ok: true,
		pos,
		posPx: Math.max(26, fitFontPx(pos, room, 44)),
		of,
		pct: placePct(place, vt),
		// "/ 70,519" counts the user too; say so, next to "RECORDS 70,518" below
		sub: fill(sub.counted, { n: fmtCount(place.total) }),
		note:
			place.ap && place.tied > 0
				? fill(vt.tiedAp, { n: fmtCount(place.tied) })
				: "",
		ap: place.ap,
	};
}

/**
 * Share of records at or above `acc`, read off the board's quantiles (q[k] is the
 * acc of the best k·0.5 %). Used for the strip marker when the rank lookup missed
 */
export function boardTopPercent(board: Board, acc: number): number | null {
	const q = board.q;
	if (!q.length || !(board.n > 0)) return null;
	if (acc >= 100) return Math.max((board.ap / board.n) * 100, 100 / board.n);
	const step = 100 / (q.length - 1);
	let k = 0;
	while (k < q.length - 1 && (q[k + 1] ?? 0) > acc) k++;
	return Math.min(100, (k + 1) * step);
}

type Bar = { h: number; cls: "hi" | "you" | "lo" | "mid" };

type Marker = {
	/** Centre of the marker; `left` is its line's left edge, `labelX` its label's */
	x: number;
	left: number;
	labelX: number;
	label: string;
	/** Draw the line (an AP's column is outlined instead) */
	line: boolean;
};

export type DistView = {
	ok: boolean;
	note: string;
	meta: string;
	below: string;
	bars: Bar[];
	binsW: number;
	plotW: number;
	ap: {
		x: number;
		h: number;
		cut: boolean;
		/** Count over the column; empty when the user's own marker sits there */
		label: string;
		axisX: number;
		you: boolean;
	};
	ticks: Array<{ x: number; left: number; label: string }>;
	marker: Marker | null;
	strip: {
		apW: number;
		marker: Marker | null;
		ticks: Array<{
			x: number;
			left: number;
			tick: number;
			label: string;
			acc: string;
		}>;
	};
};

/** Histogram bars, the user's marker and the percentile strip, in px */
export function distView(
	board: Board | null,
	state: LookupState,
	acc: number | null,
	topPercent: number | null,
	vt: Copy,
): DistView {
	const binsCount = board?.hist.bins.length ?? 0;
	const binsW = binsCount * BIN_W;
	const plotW = binsW + AP_GAP + AP_W;
	const empty: DistView = {
		ok: false,
		note: board ? vt.empty : stateNote(state, vt) || vt.failed,
		meta: "",
		below: "",
		bars: [],
		binsW,
		plotW,
		ap: { x: 0, h: 0, cut: false, label: "", axisX: 0, you: false },
		ticks: [],
		marker: null,
		strip: { apW: 0, marker: null, ticks: [] },
	};
	if (!board || !(board.n > 0) || !binsCount) return empty;
	const { lo, step, bins, below } = board.hist;
	const max = Math.max(1, ...bins);
	const isAp = acc != null && acc >= 100;
	// The user's bin: -1 when below the plotted range, bins.length for an AP
	const userBin =
		acc == null
			? null
			: isAp
				? binsCount
				: acc < lo
					? -1
					: Math.min(binsCount - 1, Math.floor((acc - lo) / step + 1e-9));
	const bars: Bar[] = bins.map((count, i) => ({
		h: count > 0 ? Math.max(2, Math.round((count / max) * PLOT_H)) : 0,
		cls:
			userBin == null
				? "mid"
				: i > userBin
					? "hi"
					: i === userBin
						? "you"
						: "lo",
	}));
	const apX = binsW + AP_GAP;
	const markX =
		acc == null
			? null
			: isAp
				? apX + AP_W / 2
				: acc < lo
					? 0
					: Math.min(binsW, ((acc - lo) / step) * BIN_W);
	const tickEvery = Math.max(1, Math.round(binsCount / 4));
	const tick = (x: number, label: string) => ({
		x,
		left: x - TICK_W / 2,
		label,
	});
	const ticks: DistView["ticks"] = [];
	for (let i = 0; i <= binsCount; i += tickEvery) {
		ticks.push(tick(i * BIN_W, `${fmtTick(lo + i * step)}%`));
	}
	if (ticks.at(-1)?.x !== binsW) ticks.push(tick(binsW, "100%"));
	const youLabel =
		acc == null ? "" : `${vt.you} · ${isAp ? "100%" : fmtAcc(acc, 2)}`;
	const labelAt = (x: number, width: number, total: number) =>
		Math.round(Math.min(Math.max(0, x - width / 2), total - width));
	const marker = (
		x: number,
		lineW: number,
		total: number,
		label: string,
		line = true,
	): Marker => ({
		x: Math.round(x),
		left: Math.round(x - lineW / 2),
		labelX: labelAt(x, MARK_LABEL_W, total),
		label,
		line,
	});
	const quantile = (topPct: number) =>
		board.q[Math.min(board.q.length - 1, Math.round(topPct / 0.5))];
	const stripTicks = [
		{ top: 50, label: vt.median },
		{ top: 25, label: vt.top25 },
		{ top: 10, label: vt.top10 },
	].flatMap(({ top, label }) => {
		const v = quantile(top);
		const x = Math.round(((100 - top) / 100) * STRIP_W);
		return v == null
			? []
			: [
					{
						x,
						left: x - STRIP_TICK_W / 2,
						tick: x - 1,
						label,
						acc: fmtAcc(v, 2),
					},
				];
	});
	const stripX =
		topPercent == null
			? null
			: Math.round(((100 - Math.min(100, topPercent)) / 100) * STRIP_W);
	return {
		ok: true,
		note: "",
		meta: fill(vt.distMeta, { s: fmtTick(step) }),
		below:
			below > 0
				? fill(vt.distBelow, { n: fmtCount(below), lo: fmtTick(lo) })
				: "",
		bars,
		binsW,
		plotW,
		ap: {
			x: apX,
			h:
				board.ap > 0
					? Math.max(2, Math.round(Math.min(1, board.ap / max) * PLOT_H))
					: 0,
			cut: board.ap > max,
			label: isAp || !(board.ap > 0) ? "" : fmtCount(board.ap),
			axisX: apX + AP_W / 2 - TICK_W / 2,
			you: isAp,
		},
		ticks,
		marker: markX == null ? null : marker(markX, 2, plotW, youLabel, !isAp),
		strip: {
			apW: Math.round(Math.min(1, board.ap / board.n) * STRIP_W),
			marker:
				stripX == null || topPercent == null
					? null
					: marker(
							stripX,
							4,
							STRIP_W,
							// An AP sits in the AP block; "Top x%" there would read as a rank
							isAp
								? `${vt.you} · ${vt.ap}`
								: `${vt.you} · ${fill(vt.top, { p: fmtTopPercent(topPercent) })}`,
						),
			ticks: stripTicks,
		},
	};
}

type LevelView = {
	cls: string;
	rank: string;
	constant: string;
	notes: string;
	current: boolean;
	played: boolean;
	rating: string;
	score: string;
	acc: string;
	pos: string;
	pct: string;
	ap: string;
};

function levelRows(
	rows: SongLevelRow[],
	current: string,
	vt: Copy,
): LevelView[] {
	return rows.map((row) => ({
		cls: row.level,
		rank: row.level,
		constant: row.constant > 0 ? row.constant.toFixed(1) : "?",
		notes: row.notes ? fmtCount(row.notes) : "",
		current: row.level === current,
		played: Boolean(row.record),
		rating: row.record?.rating || "",
		score: row.record ? fmtScore(row.record.score) : "—",
		acc: row.record ? fmtAcc(row.record.acc) : "—",
		pos: row.place
			? `#${fmtCount(row.place.rank)} / ${fmtCount(row.place.of)}`
			: "—",
		pct: row.place ? placePct(row.place, vt, true) : "",
		ap: row.apfc ? `${fmtRate(row.apfc.ap, row.apfc.total)}%` : "—",
	}));
}

/** Everything song.art prints */
export function songView(card: SongCardData, locale: PhiLocale) {
	const vt = COPY[locale] ?? COPY.en;
	const rec = card.record;
	const hasRecord = Boolean(rec);
	const counts =
		card.apfc ??
		(card.board
			? { total: card.board.n, ap: card.board.ap, fc: card.board.fc }
			: null);
	const topPercent =
		card.overall?.percent ??
		(rec && card.board ? boardTopPercent(card.board, rec.acc) : null);
	const kinds = card.noteKinds;
	return {
		lc: locale,
		vt,
		head: {
			// Keep clear of the card edge; two balanced lines read better than one tiny one
			title: fitLines(card.title, HERO_TEXT_W - TITLE_MARGIN, {
				max: 32,
				min: 22,
				wrap: 26,
			}),
			composer: ellipsize(card.composer || "—", HERO_TEXT_W - 90, 15),
			charter: card.charter
				? ellipsize(card.charter.replace(/\s+/g, " "), HERO_TEXT_W - 90, 15)
				: "",
			chip: {
				cls: card.level,
				rank: card.level,
				level: card.constant > 0 ? card.constant.toFixed(1) : "?",
			},
			notes: card.notes ? fill(vt.notes, { n: fmtCount(card.notes) }) : "",
			kinds: kinds
				? [
						["Tap", kinds.tap],
						["Drag", kinds.drag],
						["Hold", kinds.hold],
						["Flick", kinds.flick],
					].map(([k, n]) => ({ k: String(k), n: fmtCount(Number(n)) }))
				: [],
			jacket: card.jacket,
		},
		player: {
			name: ellipsize(card.player.name || "Player", 220, 16),
			rks: card.player.rks > 0 ? card.player.rks.toFixed(4) : "",
			avatar: card.player.avatar,
		},
		record: rec
			? {
					rating: rec.rating,
					score: fmtScore(rec.score),
					acc: fmtAcc(rec.acc),
					rks: rec.rks.toFixed(4),
					badge: rec.score >= 1_000_000 ? "AP" : rec.fc ? "FC" : "",
				}
			: null,
		tiles: [
			standingTile(
				vt.allRecords,
				{ plain: vt.allSub, counted: vt.allSubN },
				card.overall,
				card.state.rank,
				hasRecord,
				vt,
			),
			standingTile(
				fill(vt.band, {
					a: card.rksBand.minRks.toFixed(2),
					b: card.rksBand.maxRks.toFixed(2),
				}),
				{ plain: vt.bandSub, counted: vt.bandSubN },
				card.band,
				card.state.band,
				hasRecord,
				vt,
			),
		],
		dist: distView(
			card.board,
			card.state.board,
			rec ? rec.acc : null,
			topPercent,
			vt,
		),
		counts:
			counts && counts.total > 0
				? {
						ok: true,
						note: "",
						records: fmtCount(counts.total),
						ap: fmtCount(counts.ap),
						apSub: fill(vt.ofRecords, { p: fmtRate(counts.ap, counts.total) }),
						apW: meterPx(counts.ap, counts.total),
						fc: fmtCount(counts.fc),
						fcSub: fill(vt.fcSub, { p: fmtRate(counts.fc, counts.total) }),
						fcW: meterPx(counts.fc, counts.total),
					}
				: {
						ok: false,
						note:
							stateNote(card.state.apfc, vt) ||
							(card.state.apfc === "ok" ? vt.empty : vt.failed),
					},
		levels: levelRows(card.levels, card.level, vt),
		source: fill(vt.source, { d: card.asOf }),
	};
}

export type SongView = ReturnType<typeof songView>;

export const variant: CardVariant = {
	tpl: "song",
	width: CARD_WIDTH,
	prepare: (data: CardData, ctx) => {
		const card = data.songCard as SongCardData | undefined;
		return card ? { ...data, sc: songView(card, ctx.locale) } : data;
	},
};
