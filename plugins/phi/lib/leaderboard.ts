import { createHash } from "node:crypto";
import { runInBackground } from "../../../src/background.ts";
import { logger } from "../../../src/logger.ts";
import {
	outgoingAgent,
	outgoingFetch,
	socketTimeouts,
} from "../../../src/outgoing.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import { chartTagHeaders, chartTagUrl } from "./chart-tags-api.ts";
import { kvKey } from "./const.ts";
import { getInfo } from "./get-info.ts";

/**
 * Anonymous per-chart standings from phib19.top; our users are placed by accuracy
 * Only aggregates and anonymous lists are read, never player names
 */

export const LB_LEVELS = ["EZ", "HD", "IN", "AT"] as const;
export type LbLevel = (typeof LB_LEVELS)[number];

/** The single attempt behind a lookup; renders stop waiting much sooner */
export const LB_FETCH_MS = 25_000;
/** songAccList sends every record of a chart (70k rows on popular ones); it only ever finishes in the background */
export const LB_LIST_FETCH_MS = 45_000;
/** b30 rank badges: past this the card is drawn without them and marked partial */
export const LB_ROW_BUDGET_MS = 2_500;
/** Song card: past this it is drawn with what arrived and marked partial */
export const LB_CARD_BUDGET_MS = 8_000;
/** After a timeout / 5xx / network error, skip that endpoint for this long */
export const LB_BREAKER_MS = 90_000;
/** A 401/403/404/405 (a proxy that doesn't route the path, or a bad key) isn't asked again for this long */
export const LB_OFF_MS = 15 * 60 * 1000;
const RANK_TTL_MS = 6 * 60 * 60 * 1000;
/** Past RANK_TTL_MS a row is asked again, but still drawn for this long when the new answer is late */
const RANK_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Rank rows kept per user (the newest), across every row set and band their cards asked for */
const RANK_BLOB_MAX = 600;
/** A row phib19 answered with something unusable (a shifted or partial row): asked again soon */
const NULL_ROW_TTL_MS = 5 * 60 * 1000;
/**
 * No new allAccRank chunk starts this long after a rank job began, so the job (at
 * most one more LB_FETCH_MS) ends inside the card route's maxDuration (90 s)
 */
const RANK_JOB_MS = 55_000;
/** The rank blob is rewritten as chunks land, at most this often (plus once at the end) */
const BLOB_WRITE_GAP_MS = 5_000;
/** Uncached lookups /api/leaderboard may have running at once on this instance */
export const LB_API_FRESH_MAX = 4;
const APFC_TTL_MS = 6 * 60 * 60 * 1000;
const BOARD_TTL_MS = 12 * 60 * 60 * 1000;
const BAD_ID_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Cold allAccRank costs phib19 roughly 0.5–1 s per query (40 took 22 s; one 20-query
 * chunk took 18 s, another passed 25 s). 10 keeps a chunk inside the Worker's 25 s
 */
const CHUNK = 10;
const IN_FLIGHT = 2;
/** Below the float32 step of an acc in [64, 128) (2⁻¹⁷ ≈ 7.6e-6): no record lies in (acc, acc + ε] */
const EPS = 1e-6;
const HIST_BINS = 40;
const HIST_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2.5];
const QUANTILES = 200;

const PATH_RANK = "/get/scoreList/allAccRank";
const PATH_LIST = "/get/scoreList/songAccList";
const PATH_APFC = "/get/scoreList/songApFcCount";

export type RankDim = "all" | "b30";
export type RankQuery = { songId: string; rank: string; acc: number };
export type RksBand = { minRks: number; maxRks: number };
/** One allAccRank answer: records with acc ≥ the query acc, out of `total` (0: phib19 has none) */
export type AccRankRow = { better: number; total: number };

/** phib19 has no records for the chart (a level it lacks, or a song it doesn't know) */
const NO_RECORDS: AccRankRow = Object.freeze({ better: 0, total: 0 });

/** Where the user would stand among `total` phib19 records (they are not one of them) */
export type Placement = {
	/** Competition rank: ties share it, so an AP is #1 */
	rank: number;
	/** total + 1: the population with the user inserted */
	of: number;
	/** Share of `of` at or above the user, the user included */
	percent: number;
	/** Records sharing the user's rank (AP only; 0 below 100 %) */
	tied: number;
	total: number;
	ap: boolean;
};

export type Board = {
	v: 1;
	at: number;
	n: number;
	ap: number;
	/** FC or better, as phib19's own fcCount */
	fc: number;
	/** q[k]: the acc reached by the best k·0.5 % of records (q[0] best, q[200] worst) */
	q: number[];
	/** Non-AP records in HIST_BINS bins of `step` from `lo` to 100; `below` are under `lo` */
	hist: { lo: number; step: number; bins: number[]; below: number };
};

export type ApFcCounts = Partial<
	Record<LbLevel, { total: number; ap: number; fc: number }>
>;

type Transport = (
	path: string,
	body: unknown,
) => Promise<{ status: number; body: unknown }>;

export type LbDeps = {
	post?: Transport;
	/** Song ids phib19 should know (catalog); others would 400 the whole batch */
	known?: (songId: string) => boolean;
};

type KvLike = Pick<Kv, "get" | "set">;

/** breaker: failed moments ago or too busy; unsupported: the route isn't served */
export type LeaderboardErrorCode =
	| "breaker"
	| "network"
	| "upstream"
	| "bad_request"
	| "unsupported";

export class LeaderboardError extends Error {
	constructor(
		readonly code: LeaderboardErrorCode,
		message: string,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "LeaderboardError";
	}
}

export function apiSongId(id: string) {
	return id.endsWith(".0") ? id : `${id}.0`;
}

export function isLbLevel(v: unknown): v is LbLevel {
	return (LB_LEVELS as readonly unknown[]).includes(v);
}

export function clampAcc(acc: unknown): number {
	const n = Number(acc);
	if (!Number.isFinite(n)) return 0;
	return Math.min(100, Math.max(0, n));
}

/** acc < 100 asks for acc + ε (strictly better count); an AP asks for 100 (the AP tie group) */
export function rankQueryAcc(acc: unknown): number {
	const a = clampAcc(acc);
	return a >= 100 ? 100 : Math.min(100, a + EPS);
}

export function placeUser(
	acc: unknown,
	row: AccRankRow | null | undefined,
): Placement | null {
	if (!row || !(row.total > 0)) return null;
	const total = Math.round(row.total);
	const better = Math.min(Math.max(0, Math.round(row.better)), total);
	const ap = clampAcc(acc) >= 100;
	const of = total + 1;
	const percent = ((better + 1) / of) * 100;
	return ap
		? { rank: 1, of, percent, tied: better, total, ap }
		: { rank: better + 1, of, percent, tied: 0, total, ap };
}

export function fmtCount(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

/** "0.05", "5.1", "37.2": two decimals under 1 %, one above */
export function fmtTopPercent(p: number): string {
	const v = Math.min(100, Math.max(0.01, Number.isFinite(p) ? p : 100));
	return v < 1 ? v.toFixed(2) : v.toFixed(1);
}

export function rksBandLabel(band: RksBand): string {
	return `${band.minRks.toFixed(2)}–${band.maxRks.toFixed(2)}`;
}

// ---------------------------------------------------------------- transport

/** phib19 requests in flight per pool; waiting happens here, so fetch timeouts start on send */
const RANK_SLOTS = 4;
const LIST_SLOTS = 2;
/** Past this many waiting, a lookup is refused at once (phib19 is clearly behind) */
const MAX_WAITING = 48;

function lbAgent(slots: number, ms: number) {
	return outgoingAgent({
		connections: slots,
		pipelining: 1,
		keepAliveTimeout: 10_000,
		keepAliveMaxTimeout: 30_000,
		headersTimeout: ms,
		bodyTimeout: ms,
		...socketTimeouts(ms),
	});
}

/** allAccRank and songApFcCount: small, frequent */
const rankAgent = lbAgent(RANK_SLOTS, LB_FETCH_MS);
/** songAccList: whole charts (MBs, up to 45 s), kept off the rank sockets */
const listAgent = lbAgent(LIST_SLOTS, LB_LIST_FETCH_MS);

/** At most `limit` jobs at once; the slot passes straight to the next waiter */
export function slotGate(limit: number, maxWaiting = MAX_WAITING) {
	let active = 0;
	const waiting: Array<() => void> = [];
	return async <T>(job: () => Promise<T>): Promise<T> => {
		if (active < limit) active++;
		else if (waiting.length >= maxWaiting) {
			throw new LeaderboardError("breaker", "leaderboard queue full");
		} else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await job();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

const rankGate = slotGate(RANK_SLOTS);
const listGate = slotGate(LIST_SLOTS);

/** The default transport: one attempt; a 400 body is still parsed (it names the unknown song ids) */
export const phib19Post: Transport = async (path, body) => {
	const url = chartTagUrl(path);
	const list = path === PATH_LIST;
	const started = performance.now();
	const res = await outgoingFetch(url, {
		method: "POST",
		body: JSON.stringify(body),
		headers: chartTagHeaders(url),
		signal: AbortSignal.timeout(list ? LB_LIST_FETCH_MS : LB_FETCH_MS),
		dispatcher: list ? listAgent : rankAgent,
	});
	const text = await res.text();
	logger.info(
		`leaderboard POST ${path} ${res.status} ${Math.round(performance.now() - started)}ms`,
	);
	let parsed: unknown = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	return { status: res.status, body: parsed };
};

const breaker = new Map<
	string,
	{ until: number; code: LeaderboardErrorCode }
>();
const badIds = new Map<string, number>();

function breakerOpen(path: string): LeaderboardErrorCode | undefined {
	const hit = breaker.get(path);
	if (!hit) return;
	if (Date.now() < hit.until) return hit.code;
	breaker.delete(path);
}

function trip(path: string, why: string, off = false) {
	const ms = off ? LB_OFF_MS : LB_BREAKER_MS;
	breaker.set(path, {
		until: Date.now() + ms,
		code: off ? "unsupported" : "breaker",
	});
	logger.warn(`leaderboard ${path} off for ${ms / 1000}s: ${why}`);
}

/** The error a skipped call reports: "unsupported" stays itself, anything else is "breaker" */
function skipped(code: LeaderboardErrorCode, message: string) {
	return new LeaderboardError(
		code === "unsupported" ? "unsupported" : "breaker",
		message,
	);
}

function isBadId(id: string) {
	const until = badIds.get(id);
	if (until == null) return false;
	if (Date.now() < until) return true;
	badIds.delete(id);
	return false;
}

function catalogKnows(songId: string) {
	// Before the catalog loads nothing is filtered; drop-and-retry still covers it
	if (!getInfo.idList.length) return true;
	return Boolean(getInfo.ori_info[songId]);
}

/** Worth asking phib19 about: in the catalog it was built from, and not refused lately */
function songKnown(id: string, deps: LbDeps) {
	return (deps.known ?? catalogKnows)(id) && !isBadId(id);
}

/** A single-song 400 that names `songId` (`path: ["songId"]`): phib19 doesn't know the song */
export function namesUnknownSong(body: unknown): boolean {
	const details = (body as { details?: unknown } | null)?.details;
	if (!Array.isArray(details)) return false;
	return details.some((d) => {
		const path = (d as { path?: unknown } | null)?.path;
		return Array.isArray(path) && path[0] === "songId";
	});
}

/** True (and remembered for BAD_ID_TTL_MS) when `err` says phib19 doesn't know `id` */
function forgetSong(id: string, err: unknown) {
	if (
		!(err instanceof LeaderboardError) ||
		err.code !== "bad_request" ||
		!namesUnknownSong(err.body)
	) {
		return false;
	}
	badIds.set(id, Date.now() + BAD_ID_TTL_MS);
	logger.warn(`leaderboard unknown to phib19: ${id}`);
	return true;
}

/** POST and unwrap `data`. A 200 `{error}` body, 5xx, timeout or bad shape is a failure */
async function lbPost(path: string, body: unknown, deps: LbDeps) {
	const open = breakerOpen(path);
	if (open) throw skipped(open, `leaderboard ${path} recently failed`);
	return (path === PATH_LIST ? listGate : rankGate)(() =>
		lbPostNow(path, body, deps),
	);
}

async function lbPostNow(path: string, body: unknown, deps: LbDeps) {
	// The endpoint may have failed while this request waited for a slot
	const open = breakerOpen(path);
	if (open) throw skipped(open, `leaderboard ${path} recently failed`);
	let res: { status: number; body: unknown };
	try {
		res = await (deps.post ?? phib19Post)(path, body);
	} catch (err) {
		const why =
			err instanceof Error ? `${err.name} ${err.message}` : String(err);
		trip(path, why);
		throw new LeaderboardError("network", `leaderboard ${path}: ${why}`);
	}
	if (res.status === 400) {
		throw new LeaderboardError(
			"bad_request",
			`leaderboard ${path} 400`,
			res.body,
		);
	}
	if ([401, 403, 404, 405].includes(res.status)) {
		trip(path, `HTTP ${res.status}`, true);
		throw new LeaderboardError(
			"unsupported",
			`leaderboard ${path} ${res.status}`,
		);
	}
	if (res.status < 200 || res.status >= 300) {
		trip(path, `HTTP ${res.status}`);
		throw new LeaderboardError("upstream", `leaderboard ${path} ${res.status}`);
	}
	const raw = res.body;
	if (!raw || typeof raw !== "object" || "error" in raw || !("data" in raw)) {
		trip(path, "no data");
		throw new LeaderboardError("upstream", `leaderboard ${path}: no data`);
	}
	breaker.delete(path);
	return (raw as { data: unknown }).data;
}

// ---------------------------------------------------------------- allAccRank

/** One allAccRank row; null if unusable, NO_RECORDS when phib19 has none */
function asRankRow(raw: unknown, want?: RankQuery): AccRankRow | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	// Rows come back in query order; a mismatch means the order assumption broke
	if (want && typeof r.songId === "string" && r.songId !== want.songId) {
		return null;
	}
	if (want && typeof r.rank === "string" && r.rank !== want.rank) return null;
	const total = Number(r.totalCount);
	if (r.totalCount == null || !Number.isFinite(total) || total < 0) return null;
	if (total === 0) return NO_RECORDS;
	const better = Number(r.betterCount);
	if (r.betterCount == null || !Number.isFinite(better) || better < 0) {
		return null;
	}
	return { better: Math.min(better, total), total };
}

/**
 * allAccRank answers `{all:[…], b30:[…]}` for several dimensions but a bare array
 * for one. Rows align with `queries` (see asRankRow for null and NO_RECORDS)
 */
export function normalizeAccRank(
	data: unknown,
	dims: readonly RankDim[],
	queries: readonly RankQuery[],
): Partial<Record<RankDim, Array<AccRankRow | null>>> | null {
	const rows = (list: unknown[]) =>
		queries.map((q, i) => asRankRow(list[i], q));
	if (Array.isArray(data)) {
		if (dims.length !== 1) return null;
		return { [dims[0]!]: rows(data) };
	}
	if (!data || typeof data !== "object" || "error" in data) return null;
	const out: Partial<Record<RankDim, Array<AccRankRow | null>>> = {};
	let any = false;
	for (const dim of dims) {
		const list = (data as Record<string, unknown>)[dim];
		if (!Array.isArray(list)) continue;
		out[dim] = rows(list);
		any = true;
	}
	return any ? out : null;
}

/** Query indexes a 400 names as unknown song ids (`path: ["queries", i, "songId"]`) */
export function badQueryIndexes(body: unknown): Set<number> {
	const out = new Set<number>();
	const details = (body as { details?: unknown } | null)?.details;
	if (!Array.isArray(details)) return out;
	for (const d of details) {
		const path = (d as { path?: unknown } | null)?.path;
		if (!Array.isArray(path) || path[0] !== "queries" || path[2] !== "songId")
			continue;
		const i = Number(path[1]);
		if (Number.isInteger(i) && i >= 0) out.add(i);
	}
	return out;
}

async function rankChunk(
	queries: RankQuery[],
	dims: readonly RankDim[],
	band: RksBand | undefined,
	deps: LbDeps,
	retried = false,
): Promise<Partial<Record<RankDim, Array<AccRankRow | null>>>> {
	try {
		const data = await lbPost(
			PATH_RANK,
			{ queries, dimension: dims, ...(band ?? {}) },
			deps,
		);
		const out = normalizeAccRank(data, dims, queries);
		if (!out) throw new LeaderboardError("upstream", "allAccRank: bad shape");
		return out;
	} catch (err) {
		if (
			retried ||
			!(err instanceof LeaderboardError) ||
			err.code !== "bad_request"
		) {
			throw err;
		}
		const bad = badQueryIndexes(err.body);
		if (!bad.size) throw err;
		// An id the catalog has but phib19 doesn't (a brand-new song): it has no
		// records there. Drop it and retry the rest once
		for (const i of bad) {
			const id = queries[i]?.songId;
			if (id) badIds.set(id, Date.now() + BAD_ID_TTL_MS);
		}
		logger.warn(
			`leaderboard unknown to phib19: ${[...bad].map((i) => queries[i]?.songId).join(", ")}`,
		);
		const keep = queries.flatMap((_q, i) => (bad.has(i) ? [] : [i]));
		const empty = (): Array<AccRankRow | null> => queries.map(() => NO_RECORDS);
		if (!keep.length) {
			return Object.fromEntries(dims.map((d) => [d, empty()]));
		}
		const sub = await rankChunk(
			keep.map((i) => queries[i]!),
			dims,
			band,
			deps,
			true,
		);
		const out: Partial<Record<RankDim, Array<AccRankRow | null>>> = {};
		for (const d of dims) {
			const rows = empty();
			keep.forEach((i, j) => {
				rows[i] = sub[d]?.[j] ?? null;
			});
			out[d] = rows;
		}
		return out;
	}
}

/** Runs `items` `limit` at a time; stops starting new ones after a failure or past `startBy` */
async function inPool<T>(
	items: T[],
	limit: number,
	run: (item: T) => Promise<void>,
	startBy = Number.POSITIVE_INFINITY,
) {
	let next = 0;
	let failed: unknown;
	const worker = async () => {
		while (
			next < items.length &&
			failed === undefined &&
			Date.now() < startBy
		) {
			const item = items[next++]!;
			try {
				await run(item);
			} catch (err) {
				failed ??= err;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	if (failed !== undefined) throw failed;
}

/** Batched allAccRank (clamped acc, catalog-filtered ids, chunked); rows align with `queries` */
export async function fetchAccRanks(
	queries: readonly RankQuery[],
	opts: {
		dims?: readonly RankDim[];
		band?: RksBand;
		/** Each answered query (also the ones known up front), so one failed chunk doesn't waste the rest */
		onRow?: (index: number, dim: RankDim, row: AccRankRow | null) => void;
		/** After each chunk's rows went through onRow */
		onChunk?: () => void;
		/** No chunk starts after this time (ms since epoch); its queries stay null */
		startBy?: number;
	} = {},
	deps: LbDeps = {},
): Promise<Record<RankDim, Array<AccRankRow | null>>> {
	const dims = opts.dims?.length ? opts.dims : (["all"] as const);
	const out = Object.fromEntries(
		dims.map((d) => [d, queries.map(() => null)]),
	) as Record<RankDim, Array<AccRankRow | null>>;
	const sendable: Array<{ i: number; q: RankQuery }> = [];
	queries.forEach((q, i) => {
		if (!isLbLevel(q.rank)) return;
		const songId = apiSongId(String(q.songId || ""));
		if (!songKnown(songId, deps)) {
			for (const d of dims) {
				out[d][i] = NO_RECORDS;
				opts.onRow?.(i, d, NO_RECORDS);
			}
			return;
		}
		sendable.push({ i, q: { songId, rank: q.rank, acc: clampAcc(q.acc) } });
	});
	const chunks: Array<typeof sendable> = [];
	for (let i = 0; i < sendable.length; i += CHUNK) {
		chunks.push(sendable.slice(i, i + CHUNK));
	}
	await inPool(
		chunks,
		IN_FLIGHT,
		async (part) => {
			const res = await rankChunk(
				part.map((p) => p.q),
				dims,
				opts.band,
				deps,
			);
			for (const d of dims) {
				part.forEach((p, j) => {
					out[d][p.i] = res[d]?.[j] ?? null;
					opts.onRow?.(p.i, d, out[d][p.i] ?? null);
				});
			}
			opts.onChunk?.();
		},
		opts.startBy,
	);
	return out;
}

// ---------------------------------------------------------------- caches

class TtlLru<V> {
	private map = new Map<string, { until: number; value: V }>();
	constructor(private max: number) {}

	has(key: string) {
		const hit = this.map.get(key);
		if (!hit) return false;
		if (Date.now() < hit.until) return true;
		this.map.delete(key);
		return false;
	}

	get(key: string): V | undefined {
		return this.has(key) ? this.map.get(key)?.value : undefined;
	}

	set(key: string, value: V, ttlMs: number) {
		this.map.delete(key);
		this.map.set(key, { until: Date.now() + ttlMs, value });
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	clear() {
		this.map.clear();
	}
}

/** A rank row and when phib19 answered it; row null = an unusable answer */
type RankCell = { row: AccRankRow | null; at: number };
/** Fresh rank rows; a null row is kept briefly so it isn't asked on every render */
const rowMem = new TtlLru<RankCell>(4096);
/** Every usable row until RANK_STALE_MS: drawn when its fresh copy expired and the new answer is late */
const staleMem = new TtlLru<RankCell>(4096);
const boardMem = new TtlLru<Board>(64);
const apfcMem = new TtlLru<ApFcCounts>(256);
/** Loads that just failed: not retried on every render (the breaker covers whole endpoints) */
const failMem = new TtlLru<{ code: LeaderboardErrorCode; message: string }>(
	512,
);
const inflight = new Map<string, Promise<unknown>>();

/** Single-flight per key, with a short negative cache after a failure */
function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
	const hot = inflight.get(key);
	if (hot) return hot as Promise<T>;
	const failed = failMem.get(key);
	if (failed) return Promise.reject(skipped(failed.code, failed.message));
	const job = run();
	inflight.set(key, job);
	const done = () => {
		if (inflight.get(key) === job) inflight.delete(key);
	};
	job.then(done, (err) => {
		const code = err instanceof LeaderboardError ? err.code : "upstream";
		failMem.set(
			key,
			{ code, message: err instanceof Error ? err.message : String(err) },
			code === "unsupported" ? LB_OFF_MS : LB_BREAKER_MS,
		);
		done();
	});
	return job;
}

function asLbError(err: unknown) {
	return err instanceof LeaderboardError
		? err
		: new LeaderboardError(
				"upstream",
				err instanceof Error ? err.message : String(err),
			);
}

function writeKv(
	db: KvLike | undefined,
	key: string,
	value: unknown,
	ttlMs: number,
) {
	if (!db) return;
	runInBackground(db.set(key, JSON.stringify(value), ttlMs), (err) =>
		logger.warn(
			`leaderboard cache write skipped: ${err instanceof Error ? err.message : err}`,
		),
	);
}

async function readKv<T>(
	db: KvLike | undefined,
	key: string,
): Promise<T | undefined> {
	if (!db) return;
	try {
		const raw = await db.get(key);
		return raw ? (JSON.parse(raw) as T) : undefined;
	} catch {
		return;
	}
}

function bandKey(band?: RksBand) {
	return band ? `${band.minRks.toFixed(2)}-${band.maxRks.toFixed(2)}` : "all";
}

/** Cache key of one rank query, from the user's acc (the ε is applied inside) */
export function rankKey(q: RankQuery, band?: RksBand) {
	return `${apiSongId(q.songId)}|${q.rank}|${rankQueryAcc(q.acc).toFixed(6)}|${bandKey(band)}`;
}

function hashKeys(keys: string[]) {
	return createHash("sha256")
		.update([...keys].sort().join(","))
		.digest("hex")
		.slice(0, 32);
}

/**
 * One KV blob per user (or per row set without an owner): rankKey → [better, total, answered at].
 * Merged on every write, so rows from earlier cards (another count, an older job) stay
 */
type RankBlob = { v: 2; rows: Record<string, [number, number, number]> };

export type RankRowsResult = {
	/** rankKey → phib19's answer (total 0: no records there), stale ones included. Unanswered keys are absent */
	rows: Map<string, AccRankRow>;
	/** Some rows have no fresh answer: a chunk failed or ran out of time, or failed moments ago */
	partial: boolean;
	/** Rows with no answer at all (absent from `rows`) */
	missing?: number;
	/** Rows answered only past RANK_TTL_MS: drawn, but maybe out of date */
	stale?: number;
	/** Why, when it is known */
	error?: LeaderboardError;
};

/** What memory holds for `keys`: every row (stale ones too), and how many are missing or stale */
function rowsResult(keys: string[]): RankRowsResult {
	const rows = rowsInMemory(keys);
	const fresh = rowsInMemory(keys, false).size;
	const missing = keys.length - rows.size;
	const stale = rows.size - fresh;
	return { rows, partial: missing + stale > 0, missing, stale };
}

function wantedRows(queries: readonly RankQuery[], band?: RksBand) {
	const wanted = new Map<string, RankQuery>();
	for (const q of queries) {
		if (!isLbLevel(q.rank)) continue;
		wanted.set(rankKey(q, band), {
			songId: apiSongId(q.songId),
			rank: q.rank,
			acc: rankQueryAcc(q.acc),
		});
	}
	return wanted;
}

/** Answers in memory; `stale` also falls back to rows past RANK_TTL_MS */
function rowsInMemory(keys: Iterable<string>, stale = true) {
	const out = new Map<string, AccRankRow>();
	for (const key of keys) {
		const row =
			rowMem.get(key)?.row ?? (stale ? staleMem.get(key)?.row : undefined);
		if (row) out.set(key, row);
	}
	return out;
}

function rememberRow(key: string, row: AccRankRow | null, at = Date.now()) {
	const age = Date.now() - at;
	if (!row) {
		rowMem.set(key, { row, at }, NULL_ROW_TTL_MS);
		return;
	}
	if (age < RANK_TTL_MS) rowMem.set(key, { row, at }, RANK_TTL_MS - age);
	if (age < RANK_STALE_MS) staleMem.set(key, { row, at }, RANK_STALE_MS - age);
}

/** The rows of `queries` already in memory, without asking anyone (a render out of time) */
export function peekRankRows(
	queries: readonly RankQuery[],
	band?: RksBand,
): RankRowsResult {
	return rowsResult([...wantedRows(queries, band).keys()]);
}

function rankBlobKey(keys: string[], opts: { band?: RksBand; owner?: string }) {
	return opts.owner
		? kvKey("lb", "rank", "v2", opts.owner, bandKey(opts.band))
		: kvKey("lb", "rank", "v2", hashKeys(keys));
}

/** A v2 blob's rows; anything else (an old v1 blob, a bad value) reads as empty */
function blobRows(blob: unknown): RankBlob["rows"] {
	const rows = (blob as Partial<RankBlob> | undefined)?.rows;
	if ((blob as Partial<RankBlob> | undefined)?.v !== 2 || !rows) return {};
	if (typeof rows !== "object") return {};
	const out: RankBlob["rows"] = {};
	for (const [key, v] of Object.entries(rows)) {
		if (
			Array.isArray(v) &&
			v.length === 3 &&
			v.every((n) => typeof n === "number" && Number.isFinite(n))
		) {
			out[key] = v as [number, number, number];
		}
	}
	return out;
}

/** Newer answers win; rows past RANK_STALE_MS go, then the oldest past RANK_BLOB_MAX */
function mergeBlobRows(
	base: RankBlob["rows"],
	add: RankBlob["rows"],
): RankBlob["rows"] {
	const merged = { ...base };
	for (const [key, v] of Object.entries(add)) {
		const had = merged[key];
		if (!had || had[2] <= v[2]) merged[key] = v;
	}
	const cutoff = Date.now() - RANK_STALE_MS;
	const kept = Object.entries(merged)
		.filter(([, v]) => v[2] > cutoff)
		.sort((a, b) => b[1][2] - a[1][2])
		.slice(0, RANK_BLOB_MAX);
	return Object.fromEntries(kept);
}

/**
 * Ranks for many rows (b30 badges); never rejects, `partial` marks gaps. With `db`
 * the answers also go to KV (one blob per `owner`), so a later card on any
 * instance draws them even when its own lookup runs out of time
 */
export async function rankRows(
	queries: readonly RankQuery[],
	opts: { band?: RksBand; db?: KvLike; owner?: string } = {},
	deps: LbDeps = {},
): Promise<RankRowsResult> {
	const wanted = wantedRows(queries, opts.band);
	const keys = [...wanted.keys()];
	let error: LeaderboardError | undefined;
	if (keys.some((key) => !rowMem.has(key))) {
		// One job per row set; the blob may be shared by several (another count)
		const jobKey = `rank:${hashKeys(keys)}:${bandKey(opts.band)}:${opts.owner ?? ""}`;
		try {
			await shared(jobKey, () =>
				fillRows(wanted, rankBlobKey(keys, opts), opts, deps),
			);
		} catch (err) {
			error = asLbError(err);
			logger.warn(`leaderboard ranks: ${error.message}`);
		}
	}
	const out = rowsResult(keys);
	return out.partial && error ? { ...out, error } : out;
}

/** Read, merge and write the blob (after the response): rows written meanwhile by another instance stay */
function writeRankBlob(
	db: KvLike,
	blobKey: string,
	add: RankBlob["rows"],
	base: RankBlob["rows"],
) {
	runInBackground(
		(async () => {
			const current = blobRows(await readKv<RankBlob>(db, blobKey));
			const rows = mergeBlobRows(mergeBlobRows(base, current), add);
			await db.set(blobKey, JSON.stringify({ v: 2, rows }), RANK_STALE_MS);
		})(),
		(err) =>
			logger.warn(
				`leaderboard cache write skipped: ${err instanceof Error ? err.message : err}`,
			),
	);
}

async function fillRows(
	wanted: Map<string, RankQuery>,
	blobKey: string,
	opts: { band?: RksBand; db?: KvLike },
	deps: LbDeps,
) {
	const stored = opts.db
		? blobRows(await readKv<RankBlob>(opts.db, blobKey))
		: {};
	for (const [key, v] of Object.entries(stored)) {
		if (wanted.has(key) && !rowMem.has(key)) {
			rememberRow(key, { better: v[0], total: v[1] }, v[2]);
		}
	}
	const todo = [...wanted].filter(([key]) => !rowMem.has(key));
	if (!todo.length) return;
	/** Rows this job got from phib19, not yet in the blob */
	let fresh: RankBlob["rows"] = {};
	let lastSave = 0;
	const save = (final: boolean) => {
		if (!opts.db || !Object.keys(fresh).length) return;
		if (!final && Date.now() - lastSave < BLOB_WRITE_GAP_MS) return;
		writeRankBlob(opts.db, blobKey, fresh, { ...stored });
		Object.assign(stored, fresh);
		fresh = {};
		lastSave = Date.now();
	};
	try {
		await fetchAccRanks(
			todo.map(([, q]) => q),
			{
				dims: ["all"],
				band: opts.band,
				startBy: Date.now() + RANK_JOB_MS,
				onRow: (i, _dim, row) => {
					const key = todo[i]?.[0];
					if (!key) return;
					const at = Date.now();
					rememberRow(key, row, at);
					if (row) fresh[key] = [row.better, row.total, at];
				},
				onChunk: () => save(false),
			},
			deps,
		);
	} finally {
		// Also after a failed chunk: keep what arrived, so the next try asks for the rest
		save(true);
	}
}

// ---------------------------------------------------------------- songAccList

type AccListRow = { acc: number; score: number; fc: boolean };

/** `[["acc","score","fc"], [99.1, 990000, 0], …]` → rows; null for any other shape */
export function parseSongAccList(data: unknown): AccListRow[] | null {
	if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
	const head = (data[0] as unknown[]).map(String);
	const ia = head.indexOf("acc");
	const is = head.indexOf("score");
	const ifc = head.indexOf("fc");
	if (ia < 0) return null;
	const out: AccListRow[] = [];
	for (let i = 1; i < data.length; i++) {
		const row = data[i];
		if (!Array.isArray(row)) continue;
		const acc = Number(row[ia]);
		if (!Number.isFinite(acc)) continue;
		const score = is >= 0 ? Number(row[is]) || 0 : acc >= 100 ? 1e6 : 0;
		out.push({
			acc: clampAcc(acc),
			score,
			fc: ifc >= 0 ? Number(row[ifc]) === 1 : false,
		});
	}
	return out;
}

function round4(n: number) {
	return Math.round(n * 1e4) / 1e4;
}

/** Derived view kept in KV (counts, quantiles, histogram); the raw list is never stored */
export function summarizeBoard(
	rows: readonly AccListRow[],
	at = Date.now(),
): Board {
	const n = rows.length;
	let ap = 0;
	let fc = 0;
	const nonAp: number[] = [];
	const accs: number[] = new Array(n);
	rows.forEach((r, i) => {
		accs[i] = r.acc;
		const isAp = r.score >= 1_000_000;
		if (isAp) ap++;
		else nonAp.push(r.acc);
		if (isAp || r.fc) fc++;
	});
	accs.sort((a, b) => b - a);
	nonAp.sort((a, b) => b - a);
	const q: number[] = [];
	for (let k = 0; k <= QUANTILES; k++) {
		if (!n) break;
		const idx =
			k === 0 ? 0 : Math.min(n - 1, Math.ceil((k / QUANTILES) * n) - 1);
		q.push(round4(accs[idx]!));
	}
	// Bins cover the best 95 % of non-AP records; the long tail is one "below" count
	const p95 = nonAp.length
		? nonAp[Math.min(nonAp.length - 1, Math.floor(0.95 * (nonAp.length - 1)))]!
		: 100;
	const step =
		HIST_STEPS.find((s) => 100 - HIST_BINS * s <= p95) ??
		HIST_STEPS[HIST_STEPS.length - 1]!;
	const lo = Math.max(0, round4(100 - HIST_BINS * step));
	const bins: number[] = new Array(HIST_BINS).fill(0);
	let below = 0;
	for (const acc of nonAp) {
		if (acc < lo) {
			below++;
			continue;
		}
		const i = Math.min(HIST_BINS - 1, Math.floor((acc - lo) / step + 1e-9));
		bins[i] = (bins[i] ?? 0) + 1;
	}
	return { v: 1, at, n, ap, fc, q, hist: { lo, step, bins, below } };
}

function isBoard(v: unknown): v is Board {
	const b = v as Board | null;
	return (
		b?.v === 1 &&
		typeof b.at === "number" &&
		typeof b.n === "number" &&
		Array.isArray(b.q) &&
		Array.isArray(b.hist?.bins)
	);
}

/**
 * The anonymous acc distribution of one chart: memory, then KV (12 h), then phib19
 * A song phib19 doesn't know is an empty board (n 0), not a failure
 */
export async function songBoard(
	songId: string,
	level: LbLevel,
	opts: { db?: KvLike } = {},
	deps: LbDeps = {},
): Promise<Board> {
	const id = apiSongId(songId);
	if (!songKnown(id, deps)) return summarizeBoard([]);
	const key = kvKey("lb", "board", "v1", id, level);
	const hot = boardMem.get(key);
	if (hot) return hot;
	return shared(key, async () => {
		const stored = await readKv<Board>(opts.db, key);
		if (isBoard(stored) && Date.now() - stored.at < BOARD_TTL_MS) {
			boardMem.set(key, stored, BOARD_TTL_MS - (Date.now() - stored.at));
			return stored;
		}
		let data: unknown;
		try {
			data = await lbPost(
				PATH_LIST,
				{
					songId: id,
					rank: level,
					requestField: ["acc", "score", "fc"],
					numPrecision: 4,
				},
				deps,
			);
		} catch (err) {
			if (forgetSong(id, err)) return summarizeBoard([]);
			throw err;
		}
		const rows = parseSongAccList(data);
		if (!rows) throw new LeaderboardError("upstream", "songAccList: bad shape");
		const board = summarizeBoard(rows);
		boardMem.set(key, board, BOARD_TTL_MS);
		writeKv(opts.db, key, board, BOARD_TTL_MS);
		return board;
	});
}

// ---------------------------------------------------------------- songApFcCount

export function parseApFc(data: unknown): ApFcCounts | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const out: ApFcCounts = {};
	let any = false;
	for (const level of LB_LEVELS) {
		const cell = (data as Record<string, unknown>)[level] as
			| { total?: unknown; apCount?: unknown; fcCount?: unknown }
			| undefined;
		if (!cell || typeof cell !== "object") continue;
		const total = Number(cell.total);
		if (!Number.isFinite(total) || total < 0) continue;
		const ap = Math.max(0, Number(cell.apCount) || 0);
		const fc = Math.max(ap, Number(cell.fcCount) || 0);
		out[level] = { total, ap: Math.min(ap, total), fc: Math.min(fc, total) };
		any = true;
	}
	return any ? out : null;
}

function apfcKey(id: string) {
	return kvKey("lb", "apfc", "v1", id);
}

/**
 * Records, APs and FCs per level of one song: memory, then KV (6 h), then phib19
 * A song phib19 doesn't know has no levels ({}), not a failure
 */
export async function songApFc(
	songId: string,
	opts: { db?: KvLike } = {},
	deps: LbDeps = {},
): Promise<ApFcCounts> {
	const id = apiSongId(songId);
	if (!songKnown(id, deps)) return {};
	const key = apfcKey(id);
	const hot = apfcMem.get(key);
	if (hot) return hot;
	return shared(key, async () => {
		const stored = await readKv<{ at: number; counts: ApFcCounts }>(
			opts.db,
			key,
		);
		if (stored?.counts && Date.now() - stored.at < APFC_TTL_MS) {
			apfcMem.set(key, stored.counts, APFC_TTL_MS - (Date.now() - stored.at));
			return stored.counts;
		}
		let data: unknown;
		try {
			data = await lbPost(
				PATH_APFC,
				{ songId: id, rank: [...LB_LEVELS] },
				deps,
			);
		} catch (err) {
			if (forgetSong(id, err)) return {};
			throw err;
		}
		const counts = parseApFc(data);
		if (!counts)
			throw new LeaderboardError("upstream", "songApFcCount: bad shape");
		apfcMem.set(key, counts, APFC_TTL_MS);
		writeKv(opts.db, key, { at: Date.now(), counts }, APFC_TTL_MS);
		return counts;
	});
}

/**
 * One chart, one acc: where the user stands overall and, with a band, among similar
 * RKS. null: phib19 has no records there. Rejects when phib19 didn't answer
 */
export async function placeOnChart(
	songId: string,
	level: LbLevel,
	acc: number,
	band?: RksBand,
	deps: LbDeps = {},
): Promise<Placement | null> {
	const q = { songId, rank: level, acc };
	const key = rankKey(q, band);
	const res = await rankRows([q], { band }, deps);
	const row = res.rows.get(key);
	if (!row) {
		throw (
			res.error ?? new LeaderboardError("upstream", "allAccRank: no usable row")
		);
	}
	return placeUser(acc, row);
}

// ---------------------------------------------------------------- /api/leaderboard

export type LeaderboardQuery = {
	chart: string;
	level: LbLevel;
	acc: number;
	band?: RksBand;
};

/** `?chart=<id>&level=<EZ|HD|IN|AT>&acc=<0..100>[&minRks=&maxRks=]`; null when invalid */
export function parseLeaderboardQuery(
	params: URLSearchParams,
	hasChart: (songId: string, level: LbLevel) => boolean,
): LeaderboardQuery | null {
	const chart = apiSongId((params.get("chart") || "").trim());
	const level = (params.get("level") || "").toUpperCase();
	const accRaw = params.get("acc");
	const acc = Number(accRaw);
	if (chart === ".0" || chart.length > 128 || !isLbLevel(level)) return null;
	if (accRaw == null || accRaw === "" || !Number.isFinite(acc)) return null;
	if (acc < 0 || acc > 100) return null;
	if (!hasChart(chart, level)) return null;
	const minRaw = params.get("minRks");
	const maxRaw = params.get("maxRks");
	let band: RksBand | undefined;
	if (minRaw != null || maxRaw != null) {
		const minRks = Number(minRaw);
		const maxRks = Number(maxRaw);
		if (
			!Number.isFinite(minRks) ||
			!Number.isFinite(maxRks) ||
			minRks < 0 ||
			maxRks > 20 ||
			maxRks <= minRks
		) {
			return null;
		}
		band = { minRks, maxRks };
	}
	return { chart, level, acc, band };
}

type PlacementJson = {
	rank: number;
	of: number;
	percent: number;
	tied: number;
};

export type LeaderboardBody = PlacementJson & {
	chart: string;
	level: LbLevel;
	acc: number;
	/** phib19 records on the chart (the user not included) */
	total: number;
	ap: number | null;
	fc: number | null;
	band?: PlacementJson & RksBand & { total: number };
	source: "phib19.top";
};

function placementJson(p: Placement): PlacementJson {
	return {
		rank: p.rank,
		of: p.of,
		percent: Math.round(p.percent * 1e4) / 1e4,
		tied: p.tied,
	};
}

async function within<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"late">((resolve) => {
		timer = setTimeout(() => resolve("late"), ms);
	});
	try {
		return await Promise.race([work, late]);
	} finally {
		clearTimeout(timer);
	}
}

/** Uncached /api/leaderboard lookups running now (late ones included, until they settle) */
let apiFresh = 0;

/** Answerable from memory: no phib19 request needed */
function cachedQuery(q: LeaderboardQuery) {
	const row = { songId: q.chart, rank: q.level, acc: q.acc };
	const id = apiSongId(q.chart);
	return (
		rowMem.has(rankKey(row)) &&
		(!q.band || rowMem.has(rankKey(row, q.band))) &&
		apfcMem.has(apfcKey(id))
	);
}

/**
 * JSON for /api/leaderboard: never throws, upstream trouble is a 503
 * Late lookups finish in the background to fill the cache
 */
export async function leaderboardJson(
	q: LeaderboardQuery,
	opts: {
		budgetMs?: number;
		background?: (work: Promise<unknown>) => void;
	} = {},
	deps: LbDeps = {},
): Promise<{ status: number; body: LeaderboardBody | { error: string } }> {
	const budget = opts.budgetMs ?? LB_CARD_BUDGET_MS;
	const fresh = !cachedQuery(q);
	if (fresh && apiFresh >= LB_API_FRESH_MAX) {
		return { status: 503, body: { error: "upstream_busy" } };
	}
	const overall = placeOnChart(q.chart, q.level, q.acc, undefined, deps);
	const banded = q.band
		? placeOnChart(q.chart, q.level, q.acc, q.band, deps).catch(() => null)
		: Promise.resolve(null);
	const counts = songApFc(q.chart, {}, deps).catch(() => null);
	overall.catch(() => undefined);
	const settled = Promise.allSettled([overall, banded, counts]);
	if (fresh) {
		apiFresh++;
		void settled.then(() => {
			apiFresh = Math.max(0, apiFresh - 1);
		});
	}
	try {
		const all = await within(Promise.all([overall, banded, counts]), budget);
		if (all === "late") {
			(
				opts.background ??
				((work) =>
					runInBackground(work, (err) =>
						logger.warn(
							`leaderboard api background miss: ${err instanceof Error ? err.message : err}`,
						),
					))
			)(settled);
			return { status: 503, body: { error: "upstream_slow" } };
		}
		const [place, band, apfc] = all;
		if (!place) return { status: 404, body: { error: "no_data" } };
		const level = apfc?.[q.level];
		return {
			status: 200,
			body: {
				chart: q.chart,
				level: q.level,
				acc: clampAcc(q.acc),
				...placementJson(place),
				total: place.total,
				ap: level ? level.ap : null,
				fc: level ? level.fc : null,
				...(band && q.band
					? {
							band: {
								...placementJson(band),
								total: band.total,
								minRks: q.band.minRks,
								maxRks: q.band.maxRks,
							},
						}
					: {}),
				source: "phib19.top",
			},
		};
	} catch (err) {
		logger.warn(`leaderboard api: ${err instanceof Error ? err.message : err}`);
		return { status: 503, body: { error: "upstream_unavailable" } };
	}
}

export function resetLeaderboardForTest() {
	apiFresh = 0;
	breaker.clear();
	badIds.clear();
	rowMem.clear();
	staleMem.clear();
	boardMem.clear();
	apfcMem.clear();
	failMem.clear();
	inflight.clear();
}
