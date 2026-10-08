import { logger } from "../../../src/logger.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import {
	type ChartTagJsonFetch,
	chartTagJsonFetchOnce,
	withChartTagBudget,
} from "./chart-tags-api.ts";
import {
	apiSongId,
	clampAcc,
	fetchAccRanks,
	fmtCount,
	fmtTopPercent,
	LB_ROW_BUDGET_MS,
	type AccRankRow as LbRankRow,
	peekRankRows,
	placeUser,
	type RankDim,
	type RankQuery,
	type RankRowsResult,
	type RksBand,
	rankKey,
	rankRows,
} from "./leaderboard.ts";
import type { RankBandShow, RankScope } from "./notes.ts";

export { apiSongId };

type AccAvgCell = { accAvg: number | null; count?: number };
type AccAvgMap = Record<
	string,
	Record<string, AccAvgCell | undefined> | undefined
>;

type AccRankRow = {
	songId?: string;
	rank?: string;
	acc?: number;
	topPercent?: number | null;
	better?: number;
	total?: number;
};
type AccRankMap = {
	all?: AccRankRow[];
	b30?: AccRankRow[];
};

/** Rank badge pieces ("rank" mode), next to the one-line `accAvg` text */
export type AccRankBadge = {
	/** Among all of the chart's records, or only those of players near the user's RKS */
	scope: "all" | "band";
	/** Population label before a band badge ("±0.05") */
	tag?: string;
	/** Only the place ("#12 / 400") or only the share ("Top 3.0%"); both when absent */
	show?: RankBandShow;
	pos: string;
	of: string;
	pct: string;
	rank: number;
	total: number;
	percent: number;
	/** Other records tied at #1 (AP only) */
	tied: number;
	ap: boolean;
};

export type ScoreAvgSong = {
	id: string;
	rank: string;
	acc: number;
	accAvg?: string | number;
	accKind?: string;
	/** The first rank badge (accRanks[0]) */
	accRank?: AccRankBadge;
	/** Every rank badge of the row, one line each: all records, then the RKS band */
	accRanks?: AccRankBadge[];
};

type B19AvgOption = {
	avgType?: string;
	color?: string;
	avgValue?: boolean;
	/** "rank" mode keeps the user's answered rows here (one KV blob per `owner`) */
	db?: Pick<Kv, "get" | "set">;
	/** The user the rank rows are cached for */
	owner?: string;
	/** "rank" mode: among all records, players near the user's RKS, or both */
	rankScope?: RankScope;
	/** "rank" mode: what the ±0.05 badge shows (default the place) */
	rankBandShow?: RankBandShow;
	/** How long the card waits for phib19 (default LB_ROW_BUDGET_MS) */
	budgetMs?: number;
};

export function rksAvgBand(comRks: number) {
	const rks = Number.isFinite(comRks) ? comRks : 0;
	return {
		minRks: Math.max(0, Math.floor((rks - 0.05) / 0.05) * 0.05),
		maxRks: Math.max(0, Math.floor((rks + 0.05) / 0.05) * 0.05),
	};
}

/** The RKS band of "±0.05" ranks (song card, B30 badges): rksAvgBand at 2 decimals */
export function rankBand(comRks: number): RksBand {
	const band = rksAvgBand(comRks);
	return {
		minRks: Math.round(band.minRks * 100) / 100,
		maxRks: Math.round(band.maxRks * 100) / 100,
	};
}

export function rksAvgBandUp(comRks: number) {
	const rks = Number.isFinite(comRks) ? comRks : 0;
	return {
		minRks: Math.max(0, (Math.floor((rks - 0.05) / 0.05) + 2) * 0.05),
		maxRks: Math.max(0, (Math.ceil((rks + 0.05) / 0.05) + 2) * 0.05),
	};
}

/** `{data}` → data. phib19 reports some failures as HTTP 200 `{error}`: null */
function unwrapData<T>(raw: unknown): T | null {
	if (!raw || typeof raw !== "object" || "error" in raw) return null;
	const nested = "data" in raw ? (raw as { data: unknown }).data : raw;
	if (!nested || typeof nested !== "object") return null;
	return nested as T;
}

export async function fetchAllSongAccAvg(
	params: { songIds: string[]; minRks: number; maxRks: number },
	fetchJson: ChartTagJsonFetch = chartTagJsonFetchOnce,
) {
	return unwrapData<AccAvgMap>(
		await fetchJson("/get/scoreList/allAccAvg", {
			method: "POST",
			body: JSON.stringify(params),
		}),
	);
}

/** "top" mode: phib19's banded share of records at or above each row's acc */
async function fetchAllSongAccRank(params: {
	queries: RankQuery[];
	dimension: RankDim[];
	minRks: number;
	maxRks: number;
}): Promise<AccRankMap | null> {
	const { queries, dimension, ...band } = params;
	const res = await fetchAccRanks(queries, { dims: dimension, band });
	const top = (rows: Array<LbRankRow | null> | undefined) =>
		rows?.map((row) =>
			row && row.total > 0
				? { ...row, topPercent: (row.better / row.total) * 100 }
				: {},
		);
	return { all: top(res.all), b30: top(res.b30) };
}

function lookupAccAvg(map: AccAvgMap, id: string, rank: string) {
	const cell =
		map[id]?.[rank] ||
		map[apiSongId(id)]?.[rank] ||
		(id.endsWith(".0") ? map[id.slice(0, -2)]?.[rank] : undefined);
	const n = cell?.accAvg;
	if (n == null || Number.isNaN(Number(n))) return;
	return Number(n);
}

function formatAvg(accAvg: number, prefix: string, avgValue?: boolean) {
	return avgValue ? accAvg : `${prefix} ${accAvg.toFixed(4)}%`;
}

export function applyAccAvgMap(
	rows: Array<ScoreAvgSong | undefined | null>,
	map: AccAvgMap,
	opts: {
		low: string;
		high: string;
		prefix: string;
		avgValue?: boolean;
		stopAfter?: number;
	},
) {
	let allHigher = true;
	for (let i = 0; i < rows.length; i++) {
		if (opts.stopAfter != null && i >= opts.stopAfter && allHigher) break;
		const x = rows[i];
		if (!x || x.rank === "LEGACY") continue;
		const accAvg = lookupAccAvg(map, x.id, x.rank);
		if (accAvg == null) continue;
		x.accAvg = formatAvg(accAvg, opts.prefix, opts.avgValue);
		if (x.acc < accAvg) {
			allHigher = false;
			x.accKind = opts.low;
		} else {
			x.accKind = opts.high;
		}
	}
	return allHigher;
}

export function applyAccRank(
	rows: ScoreAvgSong[],
	res: AccRankMap,
	kind: string,
) {
	for (let i = 0; i < rows.length; i++) {
		const x = rows[i];
		if (!x || x.rank === "LEGACY") continue;
		const topAll = res.all?.[i]?.topPercent;
		const topB30 = res.b30?.[i]?.topPercent;
		if (
			topAll != null &&
			!Number.isNaN(topAll) &&
			topB30 != null &&
			!Number.isNaN(topB30)
		) {
			x.accKind = kind;
			x.accAvg = `Top ${topAll.toFixed(2)}% / ${topB30.toFixed(2)}%`;
		}
	}
}

/** Before every band badge: without it the two populations' badges look alike */
export const RANK_BAND_TAG = "±0.05";

function rankBadge(
	acc: number,
	row: LbRankRow | undefined,
	scope: AccRankBadge["scope"],
	opts: { tag?: string; show?: RankBandShow } = {},
): AccRankBadge | undefined {
	const place = placeUser(acc, row);
	if (!place) return;
	return {
		scope,
		...(opts.tag ? { tag: opts.tag } : {}),
		...(opts.show ? { show: opts.show } : {}),
		pos: `#${fmtCount(place.rank)}`,
		of: `/ ${fmtCount(place.of)}`,
		pct: `${place.ap ? "AP" : "Top"} ${fmtTopPercent(place.percent)}%`,
		rank: place.rank,
		total: place.of,
		percent: place.percent,
		tied: place.tied,
		ap: place.ap,
	};
}

/** One badge as text: "±0.05 #12 / 400", "±0.05 Top 3.0%" or "#3,611 / 70,388 · Top 5.1%" */
function badgeText(b: AccRankBadge) {
	const parts = [
		b.show === "percent" ? "" : `${b.pos} ${b.of}`,
		b.show === "place" ? "" : b.pct,
	].filter(Boolean);
	return `${b.tag ? `${b.tag} ` : ""}${parts.join(" · ")}`;
}

/**
 * "rank" mode: the row's place among phib19 records, e.g. "#3,611 / 70,388 · Top 5.1%",
 * from `ranks` (all records) and / or `band.ranks` (players near the user's RKS)
 */
export function applyRowRanks(
	rows: Array<ScoreAvgSong | undefined | null>,
	ranks: Map<string, LbRankRow> | undefined,
	band?: { ranks: Map<string, LbRankRow>; range: RksBand; show?: RankBandShow },
) {
	for (const x of rows) {
		if (!x || x.rank === "LEGACY") continue;
		const q = { songId: x.id, rank: x.rank, acc: x.acc };
		const badges = [
			ranks && rankBadge(x.acc, ranks.get(rankKey(q)), "all"),
			band &&
				rankBadge(x.acc, band.ranks.get(rankKey(q, band.range)), "band", {
					tag: RANK_BAND_TAG,
					show: band.show ?? "place",
				}),
		].filter((b): b is AccRankBadge => Boolean(b));
		if (!badges.length) continue;
		x.accKind = "Rank";
		x.accRank = badges[0];
		x.accRanks = badges;
		x.accAvg = badges.map(badgeText).join(" | ");
	}
}

function uniqueSongIds(lists: Array<Array<ScoreAvgSong | undefined | null>>) {
	const ids = new Set<string>();
	for (const list of lists) {
		for (const row of list) {
			if (row?.id) ids.add(apiSongId(row.id));
		}
	}
	return [...ids];
}

function topKind(color?: string) {
	switch (color) {
		case "red":
			return "Lower";
		case "gold":
			return "Higher";
		case "blue":
			return "Hyper";
		case "green":
			return "Finished";
		default:
			return "Finished";
	}
}

type ScoreAvgFetchers = {
	allAccAvg?: typeof fetchAllSongAccAvg;
	allAccRank?: typeof fetchAllSongAccRank;
	rankRows?: (
		queries: RankQuery[],
		opts: { db?: Pick<Kv, "get" | "set">; owner?: string; band?: RksBand },
	) => Promise<RankRowsResult>;
	/** Rows already in memory, for a "rank" lookup past its budget */
	peekRankRows?: (queries: RankQuery[], band?: RksBand) => RankRowsResult;
};

/**
 * phib19 peer averages move slowly, while the same B30 is re-rendered for every
 * count / quality / language variant. Remember answers for a while, and a failure
 * briefly, so a dead upstream is not asked again on every render
 */
const AVG_TTL_MS = 10 * 60 * 1000;
const AVG_FAIL_TTL_MS = 90 * 1000;
const AVG_MAX = 128;
const avgMem = new Map<string, { until: number; value: Promise<unknown> }>();

function avgKey(name: string, params: object) {
	return `${name}|${JSON.stringify(params, (_k, v) =>
		Array.isArray(v) && v.every((x) => typeof x === "string")
			? [...v].sort()
			: v,
	)}`;
}

function remember(key: string, value: Promise<unknown>, ttlMs: number) {
	avgMem.delete(key);
	avgMem.set(key, { until: Date.now() + ttlMs, value });
	while (avgMem.size > AVG_MAX) {
		const oldest = avgMem.keys().next().value;
		if (oldest === undefined) break;
		avgMem.delete(oldest);
	}
}

/** Shared, cached lookups that resolve to null on any failure (never reject) */
function memo<P extends object, R>(
	name: string,
	fn: (params: P) => Promise<R | null>,
): (params: P) => Promise<R | null> {
	return (params) => {
		const key = avgKey(name, params);
		const hit = avgMem.get(key);
		if (hit && Date.now() < hit.until) return hit.value as Promise<R | null>;
		const value: Promise<R | null> = fn(params)
			.catch((err) => {
				logger.warn(
					`${name} failed: ${err instanceof Error ? err.message : err}`,
				);
				return null;
			})
			.then((res) => {
				if (res == null && avgMem.get(key)?.value === value) {
					remember(key, Promise.resolve(null), AVG_FAIL_TTL_MS);
				}
				return res;
			});
		remember(key, value, AVG_TTL_MS);
		return value;
	};
}

export function resetScoreAvgMemForTest() {
	avgMem.clear();
}

const cachedAllAccAvg = memo("allAccAvg", fetchAllSongAccAvg);
const cachedAllAccRank = memo("allAccRank", fetchAllSongAccRank);

type AvgPayload = {
	phi: Array<ScoreAvgSong | undefined>;
	b19_list: ScoreAvgSong[];
	com_rks: number;
};

/**
 * Whether the badges are complete. `partial` (never cached) when some row has no
 * badge (`missing`), when phib19 answered with nothing for any row (`empty`), or,
 * in rank mode, when a rank is past its 6 h (`stale`)
 */
export type AvgOutcome = {
	partial: boolean;
	missing?: boolean;
	empty?: boolean;
	stale?: boolean;
};

const COMPLETE: AvgOutcome = { partial: false };

/** phib19 answered, but with no figure for any row */
const EMPTY: AvgOutcome = { partial: true, empty: true };

function anyAverage(payload: AvgPayload, map: AccAvgMap) {
	return rankModeRows(payload).some(
		(row) => lookupAccAvg(map, row.id, row.rank) != null,
	);
}

function outcome(missing: boolean, stale: boolean): AvgOutcome {
	if (!missing && !stale) return COMPLETE;
	return {
		partial: true,
		...(missing ? { missing } : {}),
		...(stale ? { stale } : {}),
	};
}

/** Rank rows' gaps; a result without counts that is partial counts as missing */
function rankGaps(res: RankRowsResult | undefined) {
	return {
		missing: Boolean(res?.partial) && (res?.missing ?? 1) > 0,
		stale: (res?.stale ?? 0) > 0,
	};
}

/** How to label the rows, and whether some rows had to go without */
type AvgLookup = { apply: () => void } & AvgOutcome;

/** The rows that can carry a badge: phi and b19, LEGACY left out */
function rankModeRows(payload: AvgPayload) {
	return [...payload.phi, ...payload.b19_list].filter(
		(row): row is ScoreAvgSong => Boolean(row) && row?.rank !== "LEGACY",
	);
}

function rankQueries(rows: ScoreAvgSong[]): RankQuery[] {
	return rows.map((row) => ({ songId: row.id, rank: row.rank, acc: row.acc }));
}

/** Fetches what one mode needs; writes nothing to rows, so a late answer can't touch a card being drawn */
async function lookupAvg(
	avgType: string,
	payload: AvgPayload,
	option: B19AvgOption,
	fetchers: ScoreAvgFetchers,
	songIds: string[],
): Promise<AvgLookup> {
	if (avgType === "all") {
		const allAccAvg = fetchers.allAccAvg ?? cachedAllAccAvg;
		const band = rksAvgBand(payload.com_rks);
		const res = await allAccAvg({ songIds, ...band });
		if (!res) throw new Error("avg-getAllSongAccAvg failed");
		const fmt = { prefix: "Avg:", avgValue: option.avgValue };
		const probe = payload.b19_list.map((row) => ({ ...row }));
		const allHigher = applyAccAvgMap(probe, res, {
			low: "Lower",
			high: "Higher",
			stopAfter: 27,
			...fmt,
		});
		let next: AccAvgMap | null = null;
		if (allHigher) {
			next = await allAccAvg({ songIds, ...rksAvgBandUp(payload.com_rks) });
			if (!next) throw new Error("avg-getAllSongAccAvg-up failed");
		}
		const apply = () => {
			applyAccAvgMap(payload.b19_list, res, {
				low: "Lower",
				high: "Higher",
				stopAfter: 27,
				...fmt,
			});
			applyAccAvgMap(payload.phi, res, {
				low: "Lower",
				high: "Higher",
				...fmt,
			});
			if (!next) return;
			applyAccAvgMap(payload.b19_list, next, {
				low: "Hyper",
				high: "Finished",
				...fmt,
			});
			applyAccAvgMap(payload.phi, next, {
				low: "Hyper",
				high: "Finished",
				...fmt,
			});
		};
		return { apply, ...(anyAverage(payload, res) ? COMPLETE : EMPTY) };
	}
	if (avgType === "top") {
		const allAccRank = fetchers.allAccRank ?? cachedAllAccRank;
		const band: RksBand = rksAvgBand(payload.com_rks);
		const queries = payload.b19_list.map((row) => ({
			songId: apiSongId(row.id),
			rank: row.rank,
			acc: clampAcc(row.acc),
		}));
		const res = await allAccRank({
			queries,
			dimension: ["all", "b30"],
			...band,
		});
		if (!res) throw new Error("avg-getAllSongAccRank failed");
		const answered = queries.some(
			(_q, i) =>
				res.all?.[i]?.topPercent != null && res.b30?.[i]?.topPercent != null,
		);
		return {
			apply: () => applyAccRank(payload.b19_list, res, topKind(option.color)),
			...(answered || !queries.length ? COMPLETE : EMPTY),
		};
	}
	if (avgType === "rank") {
		const rows = rankModeRows(payload);
		const scope = option.rankScope ?? "all";
		const range = rankBand(payload.com_rks);
		const lookup = fetchers.rankRows ?? rankRows;
		const queries = rankQueries(rows);
		const cache = { db: option.db, owner: option.owner };
		// Never reject: a failed chunk still returns the rows that arrived
		const [all, near] = await Promise.all([
			scope === "band" ? undefined : lookup(queries, cache),
			scope === "all" ? undefined : lookup(queries, { ...cache, band: range }),
		]);
		const a = rankGaps(all);
		const b = rankGaps(near);
		return {
			apply: () =>
				applyRowRanks(
					rows,
					all?.rows,
					near && { ranks: near.rows, range, show: option.rankBandShow },
				),
			...outcome(a.missing || b.missing, a.stale || b.stale),
		};
	}
	// A mode the webui doesn't know (the Discord bot may store others): no badges
	return { apply: () => undefined, ...COMPLETE };
}

/**
 * Peer averages / ranks for the B30 rows within `budgetMs`; past it rows keep what
 * memory has (rank mode) and the outcome says what is missing or stale
 */
export async function attachB19AccAvg(
	payload: AvgPayload,
	option: B19AvgOption = {},
	fetchers: ScoreAvgFetchers = {},
): Promise<AvgOutcome> {
	const avgType = option.avgType || "all";
	if (avgType === "none") return COMPLETE;
	const songIds = uniqueSongIds([payload.phi, payload.b19_list]);
	if (!songIds.length) return COMPLETE;
	try {
		const { apply, ...result } = await withChartTagBudget(
			lookupAvg(avgType, payload, option, fetchers, songIds),
			option.budgetMs ?? LB_ROW_BUDGET_MS,
			`avg-${avgType}`,
		);
		apply();
		return result;
	} catch (err) {
		logger.warn(`b30 avg skip: ${err instanceof Error ? err.message : err}`);
		if (avgType === "rank") {
			const rows = rankModeRows(payload);
			const scope = option.rankScope ?? "all";
			const range = rankBand(payload.com_rks);
			const peek = fetchers.peekRankRows ?? peekRankRows;
			const queries = rankQueries(rows);
			const all = scope === "band" ? undefined : peek(queries);
			const near = scope === "all" ? undefined : peek(queries, range);
			applyRowRanks(
				rows,
				all?.rows,
				near && { ranks: near.rows, range, show: option.rankBandShow },
			);
			// Often every row is there, from ranks past their 6 h: then nothing is missing
			const a = rankGaps(all);
			const b = rankGaps(near);
			return outcome(a.missing || b.missing, a.stale || b.stale);
		}
		return outcome(true, false);
	}
}
