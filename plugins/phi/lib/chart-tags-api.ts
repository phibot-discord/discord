import { createHash } from "node:crypto";
import { runInBackground } from "../../../src/background.ts";
import { logger } from "../../../src/logger.ts";
import {
	outgoingAgent,
	outgoingFetch,
	socketTimeouts,
} from "../../../src/outgoing.ts";
import type { Kv } from "../../../src/sdk/index.ts";
import type { ChartTagTreeNode, TagAnalysis } from "./b30-analysis.ts";
import {
	isProxyHost,
	kvKey,
	PHI_CHART_TAG_API,
	PHI_PROXY_KEY,
	PROXY_KEY_HEADER,
} from "./const.ts";

type TreeBody = { data?: unknown };
type OriRecord = { score: number; acc: number; fc: boolean };

export const CHART_TAG_TIMEOUT_MS = 60_000;
const CHART_TAG_MAX_ATTEMPTS = 4;
/** How long a render waits for phib19 before drawing without tag data (marked partial) */
export const CHART_TAG_RENDER_BUDGET_MS = 8_000;
/** The attempt keeps running this long after the render gives up, to fill the cache */
export const CHART_TAG_BACKGROUND_MS = 30_000;

type FetchPlan = { timeoutMs: number; attempts: number };
const PATIENT: FetchPlan = {
	timeoutMs: CHART_TAG_TIMEOUT_MS,
	attempts: CHART_TAG_MAX_ATTEMPTS,
};
const ONE_SHOT: FetchPlan = { timeoutMs: CHART_TAG_BACKGROUND_MS, attempts: 1 };

export const chartTagAgent = {
	...socketTimeouts(CHART_TAG_TIMEOUT_MS),
	headersTimeout: CHART_TAG_TIMEOUT_MS,
	bodyTimeout: CHART_TAG_TIMEOUT_MS,
};

const agent = outgoingAgent({
	connections: 8,
	pipelining: 1,
	keepAliveTimeout: 10_000,
	keepAliveMaxTimeout: 30_000,
	...chartTagAgent,
});

const TREE_TTL_MS = 6 * 60 * 60 * 1000;
let treeCache: { at: number; value: Promise<ChartTagTreeNode[]> } | null = null;

export function chartTagTreeR2Key(
	prefix = process.env.CLOUDFLARE_R2_INFO_PREFIX ?? "info",
) {
	return `${prefix.replace(/\/+$/, "")}/tagTree.json`;
}

class ChartTagTimeoutError extends Error {
	constructor(message = "chart-tag timed out") {
		super(message);
		this.name = "ChartTagTimeoutError";
	}
}

function errCode(err: unknown): string | undefined {
	return err && typeof err === "object" && "code" in err
		? String((err as { code?: unknown }).code || "")
		: undefined;
}

function errChain(err: unknown): string {
	const bits: string[] = [];
	let cur: unknown = err;
	for (let i = 0; i < 5 && cur; i++) {
		if (cur instanceof Error) {
			const code = errCode(cur);
			bits.push(
				[cur.name, cur.message, code]
					.filter((p) => p && p !== "undefined")
					.join(" "),
			);
			cur = cur.cause;
			continue;
		}
		bits.push(String(cur));
		break;
	}
	return bits.join(" <- ") || String(err);
}

export function isChartTagTimeout(err: unknown): boolean {
	let cur: unknown = err;
	for (let i = 0; i < 4 && cur; i++) {
		if (cur instanceof ChartTagTimeoutError) return true;
		if (!(cur instanceof Error)) return false;
		if (
			cur.name === "TimeoutError" ||
			cur.name === "AbortError" ||
			cur.name === "ConnectTimeoutError" ||
			cur.name === "HeadersTimeoutError" ||
			cur.name === "BodyTimeoutError"
		) {
			return true;
		}
		const code = errCode(cur);
		if (code && /TIMEOUT/i.test(code)) return true;
		if (/timeout|timed out|aborted/i.test(cur.message)) return true;
		cur = cur.cause;
	}
	return false;
}

export function isRetryableChartTagNet(err: unknown): boolean {
	if (err instanceof ChartTagTimeoutError) return true;
	let cur: unknown = err;
	for (let i = 0; i < 4 && cur; i++) {
		if (!(cur instanceof Error)) return false;
		const code = errCode(cur) || "";
		if (
			/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/i.test(
				code,
			)
		) {
			return true;
		}
		if (cur.name === "TypeError" && /fetch failed/i.test(cur.message)) {
			return true;
		}
		if (isChartTagTimeout(cur)) return true;
		cur = cur.cause;
	}
	return false;
}

export function chartTagUrl(path: string) {
	return `${PHI_CHART_TAG_API}${path}`;
}

export function chartTagRemainMs(
	started: number,
	now = performance.now(),
	total = CHART_TAG_TIMEOUT_MS,
) {
	return Math.max(1_000, Math.floor(total - (now - started)));
}

export type ChartTagJsonFetch = (
	path: string,
	init?: RequestInit,
) => Promise<unknown>;

export function chartTagHeaders(
	url = PHI_CHART_TAG_API,
	proxyKey = PHI_PROXY_KEY,
): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json",
	};
	if (proxyKey && isProxyHost(url)) headers[PROXY_KEY_HEADER] = proxyKey;
	return headers;
}

async function jsonFetch(
	path: string,
	init: RequestInit = {},
	plan: FetchPlan = PATIENT,
) {
	const method = (init.method ?? "GET").toUpperCase();
	const url = chartTagUrl(path);
	const started = performance.now();
	let last: unknown;
	for (let attempt = 1; attempt <= plan.attempts; attempt++) {
		const remain = chartTagRemainMs(started, performance.now(), plan.timeoutMs);
		try {
			const res = await outgoingFetch(url, {
				method,
				body:
					method === "GET" || method === "HEAD"
						? undefined
						: typeof init.body === "string"
							? init.body
							: undefined,
				signal: init.signal ?? AbortSignal.timeout(remain),
				headers: chartTagHeaders(url),
				dispatcher: agent,
			});
			const ms = `${Math.round(performance.now() - started)}ms`;
			if (!res.ok) {
				const detail = await res.text().catch(() => "");
				logger.warn(`chart-tag ${method} ${url} ${res.status} ${ms}`);
				throw new Error(
					`chart-tag ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
				);
			}
			logger.info(`chart-tag ${method} ${url} ${res.status} ${ms}`);
			// Awaited here so a body cut off mid-stream is retried and classified too
			return await res.json();
		} catch (err) {
			last = err;
			if (err instanceof Error && err.message.startsWith("chart-tag ")) {
				throw err;
			}
			const elapsed = Math.round(performance.now() - started);
			const left = plan.timeoutMs - elapsed;
			const retry =
				attempt < plan.attempts && left > 2_000 && isRetryableChartTagNet(err);
			logger.warn(
				`chart-tag ${method} ${url} fail ${elapsed}ms try ${attempt}${retry ? " retry" : ""} ${errChain(err)}`,
			);
			if (!retry) break;
		}
	}
	if (isChartTagTimeout(last)) throw new ChartTagTimeoutError();
	throw last instanceof Error ? last : new Error(errChain(last));
}

export async function chartTagJsonFetch(path: string, init: RequestInit = {}) {
	return jsonFetch(path, init);
}

/** One attempt, up to CHART_TAG_BACKGROUND_MS; pair it with withChartTagBudget */
export async function chartTagJsonFetchOnce(
	path: string,
	init: RequestInit = {},
) {
	return jsonFetch(path, init, ONE_SHOT);
}

/** Waits at most `budgetMs` for `work`; `work` keeps running to fill the cache */
export async function withChartTagBudget<T>(
	work: Promise<T>,
	budgetMs: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const over = new Promise<"over">((resolve) => {
		timer = setTimeout(() => resolve("over"), budgetMs);
	});
	try {
		const first = await Promise.race([work.then((value) => ({ value })), over]);
		if (first !== "over") return first.value;
	} finally {
		clearTimeout(timer);
	}
	logger.warn(`chart-tag ${label} over ${budgetMs}ms; finishing in background`);
	runInBackground(work, (err) =>
		logger.warn(
			`chart-tag ${label} background miss: ${err instanceof Error ? err.message : err}`,
		),
	);
	throw new ChartTagTimeoutError(
		`chart-tag ${label} over ${budgetMs}ms budget`,
	);
}

function apiSongId(id: string) {
	return id.endsWith(".0") ? id : `${id}.0`;
}

export function chartTagCacheId(saveRevision: string): string {
	return createHash("sha256").update(saveRevision).digest("hex").slice(0, 24);
}

/** Votes keep moving on phib19, so an analysis lives as long as a cached card */
export const CHART_TAG_ANALYSIS_TTL_MS = 6 * 60 * 60 * 1000;

/** v2: entries carry threshold/recordCount and their fetch time */
export function chartTagAnalysisKvKey(id: string) {
	return kvKey("b30Analysis", "v2", id);
}

type StoredAnalysis = { at: number; analysis: TagAnalysis };

/** One entry per save revision; keep the hot set small (KV holds the rest) */
const analysisMem = new Map<string, StoredAnalysis>();
const ANALYSIS_MEM_MAX = 64;
/** Concurrent cold renders of one save (b30/x30/fc30, several styles) share a POST */
const analysisInflight = new Map<string, Promise<TagAnalysis>>();

function rememberAnalysis(id: string, entry: StoredAnalysis) {
	analysisMem.delete(id);
	analysisMem.set(id, entry);
	while (analysisMem.size > ANALYSIS_MEM_MAX) {
		const oldest = analysisMem.keys().next().value;
		if (oldest === undefined) break;
		analysisMem.delete(oldest);
	}
}

export function resetChartTagVoteMemForTest() {
	analysisMem.clear();
	analysisInflight.clear();
}

function isFresh(at: unknown): at is number {
	return typeof at === "number" && Date.now() - at < CHART_TAG_ANALYSIS_TTL_MS;
}

function readMemAnalysis(id: string): TagAnalysis | undefined {
	const hot = analysisMem.get(id);
	if (!hot) return;
	if (isFresh(hot.at)) return hot.analysis;
	analysisMem.delete(id);
}

async function readStoredAnalysis(
	id: string,
	db?: Pick<Kv, "get">,
): Promise<TagAnalysis | undefined> {
	try {
		const raw = await db?.get(chartTagAnalysisKvKey(id));
		if (!raw) return;
		const stored = JSON.parse(raw) as { at?: unknown; analysis?: unknown };
		if (!isFresh(stored.at)) return;
		const analysis = parseB30TagAnalysis(stored.analysis);
		if (!analysis) return;
		rememberAnalysis(id, { at: stored.at, analysis });
		return analysis;
	} catch {
		return;
	}
}

/** The render does not wait for the KV copy; the in-memory entry serves this request */
function writeAnalysisCache(
	id: string,
	analysis: TagAnalysis,
	db?: Pick<Kv, "set">,
) {
	const entry = { at: Date.now(), analysis };
	rememberAnalysis(id, entry);
	if (!db) return;
	runInBackground(
		db.set(
			chartTagAnalysisKvKey(id),
			JSON.stringify(entry),
			CHART_TAG_ANALYSIS_TTL_MS,
		),
		(err) =>
			logger.warn(
				`chart-tag analysis cache write skipped: ${err instanceof Error ? err.message : err}`,
			),
	);
}

function asTree(raw: unknown): ChartTagTreeNode[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const node = item as {
			name?: unknown;
			description?: unknown;
			voteCount?: unknown;
			children?: unknown;
		};
		if (typeof node.name !== "string" || !node.name) return [];
		return [
			{
				name: node.name,
				description:
					typeof node.description === "string" && node.description
						? node.description
						: undefined,
				voteCount:
					typeof node.voteCount === "number" ? node.voteCount : undefined,
				children: asTree(node.children),
			},
		];
	});
}

export function parseChartTagTree(raw: unknown): ChartTagTreeNode[] {
	const body = raw as TreeBody | unknown[] | undefined;
	if (Array.isArray(body)) return asTree(body);
	if (body && typeof body === "object") return asTree((body as TreeBody).data);
	return [];
}

export function resetChartTagTreeMemForTest() {
	treeCache = null;
}

async function readR2TreeRaw(): Promise<unknown> {
	try {
		const { fetchR2Object } = await import("../../../src/r2.ts");
		const buf = await fetchR2Object(chartTagTreeR2Key());
		if (!buf?.byteLength) return;
		return JSON.parse(buf.toString("utf8")) as unknown;
	} catch {
		return;
	}
}

export async function loadChartTagTree(
	opts: {
		getCached?: () => Promise<unknown>;
		fetchJson?: ChartTagJsonFetch;
		/** Past this the caller gets a timeout; a live fetch still fills the cache */
		budgetMs?: number;
	} = {},
): Promise<ChartTagTreeNode[]> {
	const budgetMs = opts.budgetMs ?? CHART_TAG_RENDER_BUDGET_MS;
	const now = Date.now();
	if (treeCache && now - treeCache.at < TREE_TTL_MS) {
		return withChartTagBudget(treeCache.value, budgetMs, "tagTree");
	}
	const getCached = opts.getCached ?? readR2TreeRaw;
	const fetchJson = opts.fetchJson ?? chartTagJsonFetchOnce;
	const value = (async () => {
		let cached: ChartTagTreeNode[] = [];
		try {
			cached = parseChartTagTree(await getCached());
		} catch {
			cached = [];
		}
		if (cached.length) {
			logger.info("chart-tag tree r2");
			return cached;
		}
		const tree = parseChartTagTree(
			await fetchJson("/chartsTag/get/tagTree", { method: "GET" }),
		);
		if (!tree.length) throw new Error("empty chart-tag tree");
		return tree;
	})().catch((err) => {
		if (treeCache?.value === value) treeCache = null;
		throw err;
	});
	treeCache = { at: now, value };
	return withChartTagBudget(value, budgetMs, "tagTree");
}

export function gameRecordPayload(
	gameRecord: Record<
		string,
		Array<
			{ score?: number; acc?: number; fc?: boolean | number } | null | undefined
		>
	>,
): Record<string, Array<OriRecord | null>> {
	const out: Record<string, Array<OriRecord | null>> = {};
	for (const [id, rows] of Object.entries(gameRecord)) {
		// EZ..AT only, as upstream; the server ignores LEGACY (index 4)
		out[apiSongId(id)] = rows.slice(0, 4).map((row) =>
			row
				? {
						score: Number(row.score) || 0,
						acc: Number(row.acc) || 0,
						fc: Boolean(row.fc),
					}
				: null,
		);
	}
	return out;
}

function num(value: unknown, fallback = 0) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function asAnchor(value: unknown): "start" | "middle" | "end" {
	return value === "start" || value === "end" ? value : "middle";
}

export function parseB30TagAnalysis(raw: unknown): TagAnalysis | undefined {
	const body =
		raw && typeof raw === "object" && raw !== null && "data" in raw
			? (raw as { data: unknown }).data
			: raw;
	if (!body || typeof body !== "object" || Array.isArray(body)) return;
	const b = body as Record<string, unknown>;
	if (!Array.isArray(b.categories) || !b.radar || typeof b.radar !== "object") {
		return;
	}
	const radarIn = b.radar as Record<string, unknown>;
	if (
		!Array.isArray(radarIn.grids) ||
		!Array.isArray(radarIn.axes) ||
		!Array.isArray(radarIn.categories)
	) {
		return;
	}
	const categories = b.categories.flatMap((row) => {
		if (!row || typeof row !== "object") return [];
		const r = row as Record<string, unknown>;
		if (typeof r.name !== "string" || !r.name) return [];
		return [
			{
				name: r.name,
				rks: num(r.rks),
				votes: num(r.votes),
				hasVotes: Boolean(r.hasVotes),
			},
		];
	});
	const tags = (rows: unknown): TagAnalysis["strong"] =>
		Array.isArray(rows)
			? rows.flatMap((row) => {
					if (!row || typeof row !== "object") return [];
					const r = row as Record<string, unknown>;
					if (typeof r.name !== "string" || !r.name) return [];
					return [
						{
							name: r.name,
							rks: num(r.rks),
							votes: num(r.votes),
							charts: num(r.charts, num(r.sampleCount, 1)),
						},
					];
				})
			: [];
	return {
		...(typeof b.threshold === "number" && Number.isFinite(b.threshold)
			? { threshold: b.threshold }
			: {}),
		recordCount: num(b.recordCount),
		totalVotes: num(b.totalVotes),
		minimumVotes: num(b.minimumVotes, 30),
		averageRks: num(b.averageRks),
		categories,
		radar: {
			grids: radarIn.grids.filter((g): g is string => typeof g === "string"),
			axes: radarIn.axes.flatMap((axis) => {
				if (!axis || typeof axis !== "object") return [];
				const a = axis as { x?: unknown; y?: unknown };
				return [{ x: num(a.x), y: num(a.y) }];
			}),
			points: typeof radarIn.points === "string" ? radarIn.points : "",
			categories: radarIn.categories.flatMap((row) => {
				if (!row || typeof row !== "object") return [];
				const r = row as Record<string, unknown>;
				if (typeof r.name !== "string" || !r.name) return [];
				return [
					{
						name: r.name,
						rks: num(r.rks),
						votes: num(r.votes),
						hasVotes: Boolean(r.hasVotes),
						displayRks:
							typeof r.displayRks === "string"
								? r.displayRks
								: num(r.rks).toFixed(2),
						pointX: num(r.pointX),
						pointY: num(r.pointY),
						labelX: num(r.labelX),
						labelY: num(r.labelY),
						anchor: asAnchor(r.anchor),
					},
				];
			}),
		},
		strong: tags(b.strong),
		weak: tags(b.weak),
		insufficient: Boolean(b.insufficient),
	};
}

type TagAnalysisSave = {
	gameRecord?: Record<
		string,
		Array<
			{ score?: number; acc?: number; fc?: boolean | number } | null | undefined
		>
	>;
};

type TagAnalysisOpts = {
	fetchJson?: ChartTagJsonFetch;
	saveRevision?: string;
	db?: Pick<Kv, "get" | "set">;
	/** Render path: stop waiting after this long (the lookup still fills the cache) */
	budgetMs?: number;
};

async function loadAnalysis(
	save: TagAnalysisSave,
	cacheId: string | undefined,
	opts: TagAnalysisOpts,
): Promise<TagAnalysis> {
	if (cacheId) {
		const stored = await readStoredAnalysis(cacheId, opts.db);
		if (stored) {
			logger.info(`chart-tag analysis cache hit ${cacheId}`);
			return stored;
		}
	}
	const fetchJson = opts.fetchJson ?? chartTagJsonFetchOnce;
	const gameRecord = gameRecordPayload(save.gameRecord || {});
	try {
		const parsed = parseB30TagAnalysis(
			await fetchJson("/chartsTag/get/b30Analysis", {
				method: "POST",
				body: JSON.stringify({ gameRecord }),
			}),
		);
		if (!parsed) throw new Error("empty chart-tag analysis");
		if (cacheId) writeAnalysisCache(cacheId, parsed, opts.db);
		logger.info(
			`chart-tag analysis RKS≥${parsed.threshold} records ${parsed.recordCount} votes ${parsed.totalVotes} insufficient ${parsed.insufficient}`,
		);
		return parsed;
	} catch (err) {
		logger.warn(
			`chart-tag analysis miss: ${err instanceof Error ? err.message : err}`,
		);
		throw err;
	}
}

export async function tagAnalysisFor(
	save: TagAnalysisSave,
	opts: TagAnalysisOpts = {},
): Promise<TagAnalysis> {
	const cacheId = opts.saveRevision
		? chartTagCacheId(opts.saveRevision)
		: undefined;
	const hot = cacheId ? readMemAnalysis(cacheId) : undefined;
	if (hot) {
		logger.info(`chart-tag analysis cache hit ${cacheId}`);
		return hot;
	}
	let work = cacheId ? analysisInflight.get(cacheId) : undefined;
	if (!work) {
		const job = loadAnalysis(save, cacheId, opts);
		if (cacheId) {
			const id = cacheId;
			analysisInflight.set(id, job);
			const done = () => {
				if (analysisInflight.get(id) === job) analysisInflight.delete(id);
			};
			job.then(done, done);
		}
		work = job;
	}
	return opts.budgetMs != null
		? withChartTagBudget(work, opts.budgetMs, "b30Analysis")
		: work;
}
