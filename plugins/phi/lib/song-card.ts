import { runInBackground } from "../../../src/background.ts";
import type { SongLevel } from "../../../src/card-kinds.ts";
import { logger } from "../../../src/logger.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import type { PhiLocale } from "./card-i18n.ts";
import type { Catalog } from "./catalog.ts";
import { type CardMissing, watchExternal } from "./external.ts";
import {
	type ApFcCounts,
	apiSongId,
	type Board,
	clampAcc,
	LB_CARD_BUDGET_MS,
	LB_LEVELS,
	type LbDeps,
	type LbLevel,
	LeaderboardError,
	type Placement,
	placeUser,
	type RankQuery,
	type RankRowsResult,
	type RksBand,
	rankKey,
	rankRows,
	songApFc,
	songBoard,
} from "./leaderboard.ts";
import type { UserNotes } from "./notes.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save } from "./save.ts";
import { rankBand } from "./score-avg.ts";

export type SongCardOpts = {
	/** Song id as the catalog knows it (with or without the trailing ".0") */
	chart: string;
	level: SongLevel;
	locale: PhiLocale;
	notes: UserNotes;
};

export type SongCardResult =
	| { templateId: string; data: Record<string, unknown> }
	| { error: "unknown_card"; status: 404 };

export const SONG_TEMPLATE = "phi/song/song";

/** Lookup state; late, failed and unavailable make the card partial (never cached) */
export type LookupState =
	| "ok"
	| "late"
	| "failed"
	| "unavailable"
	| "off"
	| "none";

const PARTIAL_STATES: ReadonlySet<LookupState> = new Set([
	"late",
	"failed",
	"unavailable",
]);

export type SongRecord = {
	score: number;
	acc: number;
	fc: boolean;
	rks: number;
	/** fCompute.rate: phi, FC, V, S, A, B, C, F */
	rating: string;
};

export type ApFcCell = { total: number; ap: number; fc: number };

export type SongLevelRow = {
	level: LbLevel;
	constant: number;
	notes?: number;
	record: SongRecord | null;
	place: Placement | null;
	apfc: ApFcCell | null;
};

/** Everything the "song" template shows, before formatting (variants/song.ts) */
export type SongCardData = {
	id: string;
	level: LbLevel;
	title: string;
	composer: string;
	charter: string;
	illustrator: string;
	constant: number;
	notes?: number;
	/** Tap, drag, hold, flick counts when notesInfo has the chart */
	noteKinds: { tap: number; drag: number; hold: number; flick: number } | null;
	jacket: string;
	/** `avatar` is a file name under html/avatar/ ("" when the save has none) */
	player: { name: string; rks: number; avatar: string };
	record: SongRecord | null;
	/** Among every phib19.top record on the chart */
	overall: Placement | null;
	/** Among records set at an RKS within ±0.05 of the player's (phib19's own "top" band) */
	band: Placement | null;
	rksBand: RksBand;
	apfc: ApFcCell | null;
	board: Board | null;
	levels: SongLevelRow[];
	state: {
		rank: LookupState;
		band: LookupState;
		apfc: LookupState;
		board: LookupState;
	};
	/** UTC day the numbers were read (the image cache key has the same day) */
	asOf: string;
};

type Settled<T> =
	| { state: "ok"; value: T }
	| { state: "late" | "failed" | "unavailable" | "off" };

function errorState(err: unknown): "failed" | "unavailable" {
	return err instanceof LeaderboardError && err.code === "unsupported"
		? "unavailable"
		: "failed";
}

/**
 * The state of one row of a rank lookup: answered, or why not. `key` undefined
 * asks about the lookup as a whole
 */
function rowState(
	res: Settled<RankRowsResult> | null,
	key?: string,
): LookupState {
	if (!res) return "none";
	if (res.state !== "ok") return res.state;
	if (key == null || res.value.rows.has(key)) return "ok";
	return errorState(res.value.error);
}

/** Waits for `job` until `deadline`; a late job keeps running so it still fills the caches */
async function settleBy<T>(
	job: Promise<T>,
	deadline: number,
	label: string,
): Promise<Settled<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"late">((resolve) => {
		timer = setTimeout(
			() => resolve("late"),
			Math.max(0, deadline - Date.now()),
		);
	});
	try {
		const first = await Promise.race([
			job.then(
				(value) => ({ value }),
				(err: unknown) => ({ err }),
			),
			late,
		]);
		if (first === "late") {
			logger.warn(`song card ${label}: over budget, finishing in background`);
			runInBackground(job, (err) =>
				logger.warn(
					`song card ${label} background miss: ${err instanceof Error ? err.message : err}`,
				),
			);
			return { state: "late" };
		}
		if ("err" in first) {
			const err = first.err;
			logger.warn(
				`song card ${label}: ${err instanceof Error ? err.message : err}`,
			);
			return { state: errorState(err) };
		}
		return { state: "ok", value: first.value };
	} finally {
		clearTimeout(timer);
	}
}

function plainName(raw: unknown) {
	return String(raw ?? "")
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function levelRecord(
	save: Save,
	id: string,
	level: LbLevel,
): SongRecord | null {
	const rec = save.getScore(id, level);
	if (!rec || !(rec.score > 0)) return null;
	return {
		score: rec.score,
		acc: clampAcc(rec.acc),
		fc: Boolean(rec.fc),
		rks: Number.isFinite(rec.rks) ? rec.rks : 0,
		rating: rec.Rating || "",
	};
}

function apfcCell(counts: ApFcCounts | null, level: LbLevel) {
	const cell = counts?.[level];
	return cell && cell.total > 0 ? cell : null;
}

function noteKinds(chart: {
	tap?: number;
	drag?: number;
	hold?: number;
	flick?: number;
}): SongCardData["noteKinds"] {
	const n = [chart.tap, chart.drag, chart.hold, chart.flick].map(Number);
	if (!n.every((v) => Number.isFinite(v) && v >= 0)) return null;
	const [tap = 0, drag = 0, hold = 0, flick = 0] = n;
	return { tap, drag, hold, flick };
}

/**
 * Per-song card data: the user's record next to phib19's anonymous population
 * phib19 gets `budgetMs` in total; anything later keeps the image out of the cache
 */
export async function buildSongCard(
	rt: PhiRuntime,
	save: Save,
	db: Pick<Kv, "get" | "set"> | undefined,
	catalog: Pick<Catalog, "fallbackIll">,
	opts: SongCardOpts,
	extra: {
		budgetMs?: number;
		deps?: LbDeps;
		now?: Date;
		/** True while the card waits on phib19.top, false when it no longer does */
		onExternalWait?: (waiting: boolean) => void;
	} = {},
): Promise<SongCardResult> {
	const info = rt.getInfo.raw(String(opts.chart || "").trim());
	if (!info?.chart) return { error: "unknown_card", status: 404 };
	const id = apiSongId(info.id);
	const charts = LB_LEVELS.filter((lv) => info.chart[lv]?.difficulty);
	if (!charts.length) return { error: "unknown_card", status: 404 };
	// A song without the asked level (AT is the default): its hardest chart
	const level: LbLevel = charts.includes(opts.level)
		? opts.level
		: charts[charts.length - 1]!;
	const chart = info.chart[level]!;
	const records = new Map(
		charts.map((lv) => [lv, levelRecord(save, id, lv)] as const),
	);
	const record = records.get(level) ?? null;
	const playerRks = Number(save.saveInfo?.summary?.rankingScore) || 0;
	const band = rankBand(playerRks);
	const deps = extra.deps ?? {};
	const deadline = Date.now() + (extra.budgetMs ?? LB_CARD_BUDGET_MS);

	const queries: RankQuery[] = charts.flatMap((lv) => {
		const rec = records.get(lv);
		return rec ? [{ songId: id, rank: lv, acc: rec.acc }] : [];
	});
	const mine: RankQuery | null = record
		? { songId: id, rank: level, acc: record.acc }
		: null;
	// Lookups send phib19 only (song, level, acc); a user who turned API use off gets none
	const online = opts.notes.allowApiUsage !== false;
	const external = watchExternal(extra.onExternalWait);
	const ask = <T>(job: () => Promise<T>, label: string) =>
		online
			? external.track(settleBy(job(), deadline, label))
			: Promise.resolve<Settled<T>>({ state: "off" });
	// The user's ranks stay in memory (the image is cached for the day); the shared board and AP/FC counts go to KV
	const [ranks, banded, counts, board] = await Promise.all([
		queries.length ? ask(() => rankRows(queries, {}, deps), "rank") : null,
		mine ? ask(() => rankRows([mine], { band }, deps), "band") : null,
		ask(() => songApFc(id, { db }, deps), "apfc"),
		ask(() => songBoard(id, level, { db }, deps), "board"),
	]);
	const rankMap = ranks?.state === "ok" ? ranks.value.rows : null;
	const apfc = counts.state === "ok" ? counts.value : null;
	const levels: SongLevelRow[] = charts.map((lv) => {
		const rec = records.get(lv) ?? null;
		const row = rec
			? rankMap?.get(rankKey({ songId: id, rank: lv, acc: rec.acc }))
			: undefined;
		return {
			level: lv,
			constant: Number(info.chart[lv]?.difficulty) || 0,
			notes: info.chart[lv]?.combo || undefined,
			record: rec,
			place: rec ? placeUser(rec.acc, row) : null,
			apfc: apfcCell(apfc, lv),
		};
	});
	const current = levels.find((row) => row.level === level);
	const bandPlace =
		mine && banded?.state === "ok"
			? placeUser(mine.acc, banded.value.rows.get(rankKey(mine, band)))
			: null;
	const state = {
		rank: rowState(ranks, mine ? rankKey(mine) : undefined),
		band: rowState(banded, mine ? rankKey(mine, band) : undefined),
		apfc: counts.state,
		board: board.state,
	} satisfies SongCardData["state"];
	const data: SongCardData = {
		id,
		level,
		title: info.song || id,
		composer: info.composer || "",
		charter: chart.charter || "",
		illustrator: info.illustrator || "",
		constant: Number(chart.difficulty) || 0,
		notes: chart.combo || undefined,
		noteKinds: noteKinds(chart),
		jacket: rt.getInfo.getill(id, "common") || catalog.fallbackIll,
		player: {
			name: plainName(save.saveInfo?.PlayerId),
			rks: playerRks,
			avatar: save.gameuser?.avatar
				? rt.getInfo.idgetavatar(save.gameuser.avatar)
				: "",
		},
		record,
		overall: current?.place ?? null,
		band: bandPlace,
		rksBand: band,
		apfc: current?.apfc ?? null,
		board: board.state === "ok" ? board.value : null,
		levels,
		state,
		asOf: (extra.now ?? new Date()).toISOString().slice(0, 10),
	};
	// Also when another level's row is missing: the level table would lack it
	const late = Object.values(state).some((s) => PARTIAL_STATES.has(s));
	const rankRes = ranks?.state === "ok" ? ranks.value : undefined;
	const missing: CardMissing[] = [
		...(late || (rankRes?.partial && (rankRes.missing ?? 1) > 0)
			? (["song"] as const)
			: []),
		// Ranks past their 6 h, drawn because the new answers were late
		...((rankRes?.stale ?? 0) > 0 ? (["stale"] as const) : []),
	];
	const partial = missing.length > 0;
	return {
		templateId: SONG_TEMPLATE,
		data: {
			songCard: data,
			background: rt.getInfo.getill(id, "blur") || catalog.fallbackIll,
			// A lookup timed out or failed: served no-store and never cached
			renderPartial: partial,
			missing,
			externalMs: external.ms(),
		},
	};
}
