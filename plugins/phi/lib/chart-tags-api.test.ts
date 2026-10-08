import assert from "node:assert/strict";
import test from "node:test";
import {
	CHART_TAG_ANALYSIS_TTL_MS,
	CHART_TAG_BACKGROUND_MS,
	CHART_TAG_RENDER_BUDGET_MS,
	CHART_TAG_TIMEOUT_MS,
	chartTagAgent,
	chartTagAnalysisKvKey,
	chartTagCacheId,
	chartTagHeaders,
	chartTagRemainMs,
	chartTagTreeR2Key,
	chartTagUrl,
	gameRecordPayload,
	isChartTagTimeout,
	isRetryableChartTagNet,
	loadChartTagTree,
	parseB30TagAnalysis,
	parseChartTagTree,
	resetChartTagTreeMemForTest,
	resetChartTagVoteMemForTest,
	tagAnalysisFor,
	withChartTagBudget,
} from "./chart-tags-api.ts";
import { kvKey, PHI_CHART_TAG_API } from "./const.ts";

function memoryKv() {
	const store = new Map<string, string>();
	const ttls = new Map<string, number | undefined>();
	const db = {
		async get(key: string) {
			return store.get(key);
		},
		async set(key: string, value: string, ttlMs?: number) {
			store.set(key, value);
			ttls.set(key, ttlMs);
		},
	};
	return { db, store, ttls };
}

/** Trimmed phib19 b30Analysis answer (probe A, threshold pool) */
function poolResponse(totalVotes = 499) {
	const category = {
		name: "读谱",
		rks: 16.168729868216914,
		votes: 3.4562175139185793,
		hasVotes: true,
	};
	const tag = {
		name: "长纵连",
		rks: 16.217126419179657,
		rawRks: 16.322845041834015,
		votes: 46,
		sampleCount: 8,
		effectiveSampleSize: 0.815688642133655,
		confidence: 0.9626288213010668,
		contributions: [
			{ songId: "Stasis.Maozon.0", rank: "AT", slot: "R2", rks: 16.7 },
		],
	};
	return {
		data: {
			analysisMode: "threshold_pool",
			threshold: 15.9,
			minimumChartVoters: 3,
			minimumTagSamples: 3,
			recordCount: 20,
			totalVotes,
			minimumVotes: 30,
			averageRks: 16.18838192592593,
			tags: [tag],
			tagGroups: [{ name: "读谱", tags: [tag] }],
			categories: [category],
			radar: {
				grids: ["100.0,78.3 113.1,87.8 108.1,103.1 91.9,103.1 86.9,87.8"],
				axes: [{ x: 100, y: 37 }],
				points: "100.0,65.0",
				categories: [
					{
						...category,
						pointX: 100,
						pointY: 65.04043158699797,
						labelX: 100,
						labelY: 14,
						anchor: "middle",
						displayRks: "16.17",
					},
				],
			},
			strong: [tag],
			weak: [tag],
			insufficient: false,
		},
	};
}

const oneSave = {
	gameRecord: {
		"a.0": [null, null, { acc: 100, score: 1_000_000, fc: true }],
	},
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test("proxy key goes to the Worker, never to phib19 itself", () => {
	const key = "shared-secret";
	assert.equal(
		chartTagHeaders("https://phi-ill-sync.example.workers.dev", key)[
			"x-phi-proxy-key"
		],
		key,
	);
	assert.equal(
		"x-phi-proxy-key" in chartTagHeaders("https://phib19.top:8080", key),
		false,
	);
	assert.equal(
		"x-phi-proxy-key" in
			chartTagHeaders("https://phi-ill-sync.example.workers.dev", ""),
		false,
	);
	assert.equal(
		chartTagHeaders("https://phib19.top:8080", key).Accept,
		"application/json",
	);
});

test("phib19 timeout is 60s including TCP connect, not AbortSignal alone", () => {
	assert.equal(CHART_TAG_TIMEOUT_MS, 60_000);
	assert.equal(chartTagAgent.connectTimeout, 60_000);
	assert.equal(chartTagAgent.connect.timeout, 60_000);
});

test("AbortSignal.timeout rejects fractional leftover ms from performance.now", () => {
	const remain = chartTagRemainMs(0, 0.00488699999);
	assert.equal(remain, 59_999);
	assert.doesNotThrow(() => AbortSignal.timeout(remain));
});

test("no-auth chart-tag routes keep GET vs POST", () => {
	assert.equal(PHI_CHART_TAG_API, "https://phi-ill-sync.ymyk.workers.dev");
	assert.equal(
		chartTagUrl("/chartsTag/get/tagTree"),
		"https://phi-ill-sync.ymyk.workers.dev/chartsTag/get/tagTree",
	);
	assert.equal(
		chartTagUrl("/chartsTag/get/b30Analysis"),
		"https://phi-ill-sync.ymyk.workers.dev/chartsTag/get/b30Analysis",
	);
	assert.equal(
		chartTagUrl("/get/scoreList/allAccAvg"),
		"https://phi-ill-sync.ymyk.workers.dev/get/scoreList/allAccAvg",
	);
	assert.equal(
		new URL(chartTagUrl("/x")).host,
		"phi-ill-sync.ymyk.workers.dev",
	);
	assert.notEqual(new URL(chartTagUrl("/x")).port, "8080");
});

test("isChartTagTimeout detects undici connect timeouts", () => {
	const err = new Error("Connect Timeout Error");
	err.name = "ConnectTimeoutError";
	(err as { code?: string }).code = "UND_ERR_CONNECT_TIMEOUT";
	assert.equal(isChartTagTimeout(err), true);
	assert.equal(isChartTagTimeout(new Error("nope")), false);
});

test("isRetryableChartTagNet retries kernel SYN deaths, not HTTP errors", () => {
	const timed = new TypeError("fetch failed");
	(timed as { cause?: unknown }).cause = Object.assign(new Error("connect"), {
		code: "ETIMEDOUT",
	});
	assert.equal(isRetryableChartTagNet(timed), true);
	assert.equal(isRetryableChartTagNet(new Error("chart-tag 502")), false);
});

test("isChartTagTimeout unwraps TypeError fetch failed causes", () => {
	const cause = new Error("This operation was aborted");
	cause.name = "TimeoutError";
	const err = new TypeError("fetch failed", { cause });
	assert.equal(isChartTagTimeout(err), true);
});

test("tag analysis POSTs b30Analysis with gameRecord arrays, not GET chartsTags", async () => {
	resetChartTagVoteMemForTest();
	const calls: { path: string; method?: string; body?: string }[] = [];
	await assert.rejects(
		() =>
			tagAnalysisFor(
				{
					gameRecord: {
						"Stasis.Maozon": [
							null,
							null,
							{ acc: 99, score: 980000, fc: false },
						],
					},
				},
				{
					saveRevision: "rev1",
					fetchJson: async (path, init) => {
						calls.push({
							path,
							method: init?.method,
							body: typeof init?.body === "string" ? init.body : undefined,
						});
						throw new TypeError("fetch failed");
					},
				},
			),
		TypeError,
	);
	assert.deepEqual(
		calls.map((c) => `${c.method ?? "GET"} ${c.path}`),
		["POST /chartsTag/get/b30Analysis"],
	);
	const sent = JSON.parse(calls[0]!.body!) as {
		gameRecord: Record<string, unknown>;
	};
	assert.deepEqual(sent.gameRecord["Stasis.Maozon.0"], [
		null,
		null,
		{ acc: 99, score: 980000, fc: false },
	]);
});

test("chart tag cache id follows save revision", () => {
	const a = chartTagCacheId("save-a");
	assert.equal(a, chartTagCacheId("save-a"));
	assert.notEqual(a, chartTagCacheId("save-b"));
	assert.equal(a.length, 24);
});

test("tag analysis is reused until the save revision changes", async () => {
	resetChartTagVoteMemForTest();
	const save = {
		gameRecord: {
			"a.0": [null, null, { acc: 100, score: 1_000_000, fc: true }],
		},
	};
	const analysis = parseB30TagAnalysis({
		data: {
			totalVotes: 40,
			minimumVotes: 30,
			averageRks: 15,
			insufficient: false,
			categories: [{ name: "读谱", rks: 15, votes: 4, hasVotes: true }],
			radar: {
				grids: ["1,2"],
				axes: [{ x: 100, y: 37 }],
				points: "100,37",
				categories: [
					{
						name: "读谱",
						rks: 15,
						votes: 4,
						hasVotes: true,
						displayRks: "15.00",
						pointX: 100,
						pointY: 64,
						labelX: 100,
						labelY: 14,
						anchor: "middle",
					},
				],
			},
			strong: [{ name: "差速", rks: 16, votes: 3, sampleCount: 2 }],
			weak: [],
		},
	});
	assert.ok(analysis);
	const { db, store, ttls } = memoryKv();
	let fetches = 0;
	const fetchJson = async (path: string, init?: RequestInit) => {
		fetches += 1;
		assert.equal(path, "/chartsTag/get/b30Analysis");
		assert.equal(init?.method, "POST");
		return { data: analysis };
	};
	const first = await tagAnalysisFor(save, {
		fetchJson,
		saveRevision: "rev1",
		db,
	});
	const second = await tagAnalysisFor(save, {
		fetchJson,
		saveRevision: "rev1",
		db,
	});
	assert.equal(fetches, 1);
	assert.equal(first.totalVotes, 40);
	assert.deepEqual(first, second);
	const key = chartTagAnalysisKvKey(chartTagCacheId("rev1"));
	assert.equal(key, kvKey("b30Analysis", "v2", chartTagCacheId("rev1")));
	assert.equal(store.has(kvKey("b30Analysis", chartTagCacheId("rev1"))), false);
	assert.equal(ttls.get(key), CHART_TAG_ANALYSIS_TTL_MS);
	assert.equal(CHART_TAG_ANALYSIS_TTL_MS, 6 * 60 * 60 * 1000);
	const stored = JSON.parse(store.get(key)!) as {
		at: number;
		analysis: unknown;
	};
	assert.ok(Math.abs(Date.now() - stored.at) < 5_000);
	assert.deepEqual(stored.analysis, first);
	await tagAnalysisFor(save, {
		fetchJson,
		saveRevision: "rev2",
		db,
	});
	assert.equal(fetches, 2);
});

test("chart tag tree r2 key sits with the other info files", () => {
	assert.equal(chartTagTreeR2Key("info"), "info/tagTree.json");
});

test("parseChartTagTree keeps descriptions from phib19", () => {
	const tree = parseChartTagTree({
		data: [
			{
				name: "读谱",
				description: "读谱相关难点",
				children: [
					{
						name: "差速",
						description: "同一时刻的Note的下落速度不同",
						children: [],
					},
				],
			},
		],
	});
	assert.deepEqual(tree, [
		{
			name: "读谱",
			description: "读谱相关难点",
			voteCount: undefined,
			children: [
				{
					name: "差速",
					description: "同一时刻的Note的下落速度不同",
					voteCount: undefined,
					children: [],
				},
			],
		},
	]);
});

test("loadChartTagTree prefers the R2 snapshot and skips phib19", async () => {
	resetChartTagTreeMemForTest();
	let live = 0;
	const tree = await loadChartTagTree({
		getCached: async () => [{ name: "读谱", description: "读谱相关难点" }],
		fetchJson: async () => {
			live += 1;
			throw new TypeError("fetch failed");
		},
	});
	assert.equal(live, 0);
	assert.deepEqual(tree, [
		{
			name: "读谱",
			description: "读谱相关难点",
			voteCount: undefined,
			children: [],
		},
	]);
});

test("loadChartTagTree uses phib19 only when R2 is empty", async () => {
	resetChartTagTreeMemForTest();
	const tree = await loadChartTagTree({
		getCached: async () => undefined,
		fetchJson: async () => ({
			data: [{ name: "硬抗", description: "硬抗相关难点" }],
		}),
	});
	assert.equal(tree[0]?.name, "硬抗");
	assert.equal(tree[0]?.description, "硬抗相关难点");
});

test("failed chart tag analysis is not stored as a save cache hit", async () => {
	resetChartTagVoteMemForTest();
	const db = {
		async get() {
			return undefined;
		},
		async set() {
			throw new Error("cache should not write");
		},
	};
	await assert.rejects(
		() =>
			tagAnalysisFor(
				{
					gameRecord: {
						"a.0": [null, null, { acc: 100, score: 1e6, fc: true }],
					},
				},
				{
					saveRevision: "rev1",
					db,
					fetchJson: async () => {
						throw new TypeError("fetch failed");
					},
				},
			),
		TypeError,
	);
});

test("parser keeps the threshold pool size and drops per-chart detail", () => {
	const parsed = parseB30TagAnalysis(poolResponse());
	assert.ok(parsed);
	assert.equal(parsed.threshold, 15.9);
	assert.equal(parsed.recordCount, 20);
	assert.equal(parsed.totalVotes, 499);
	assert.equal(parsed.minimumVotes, 30);
	assert.deepEqual(parsed.strong, [
		{ name: "长纵连", rks: 16.217126419179657, votes: 46, charts: 8 },
	]);
	assert.equal(parsed.radar.categories[0]?.displayRks, "16.17");
	assert.equal("tags" in parsed, false);
	assert.equal("tagGroups" in parsed, false);
	// A cached analysis parses back to itself
	assert.deepEqual(
		parseB30TagAnalysis(JSON.parse(JSON.stringify(parsed))),
		parsed,
	);
});

test("parser tolerates servers without the threshold pool, and empty saves", () => {
	const legacy = poolResponse();
	const { threshold: _t, recordCount: _r, ...older } = legacy.data;
	const parsed = parseB30TagAnalysis({ data: older });
	assert.ok(parsed);
	assert.equal(parsed.threshold, undefined);
	assert.equal(parsed.recordCount, 0);
	// Probe D: `{"gameRecord":{}}`
	const empty = parseB30TagAnalysis({
		data: {
			analysisMode: "threshold_pool",
			threshold: -0.2,
			recordCount: 0,
			totalVotes: 0,
			minimumVotes: 30,
			averageRks: 0,
			tags: [],
			tagGroups: [],
			categories: [],
			radar: { grids: [], axes: [], points: "", categories: [] },
			strong: [],
			weak: [],
			insufficient: true,
		},
	});
	assert.ok(empty);
	assert.equal(empty.insufficient, true);
	assert.equal(empty.threshold, -0.2);
	assert.equal(empty.radar.categories.length, 0);
});

test("gameRecord payload drops LEGACY like upstream (slice 0..4) and keeps .0 ids", () => {
	const row = { acc: 99, score: 990000, fc: false };
	assert.deepEqual(
		gameRecordPayload({ "Song.A": [row, null, row, row, row] }),
		{ "Song.A.0": [row, null, row, row] },
	);
	assert.deepEqual(gameRecordPayload({ "Song.B.0": [null, row] }), {
		"Song.B.0": [null, row],
	});
});

test("a cached analysis expires after 6 h in memory and in KV", async (t) => {
	resetChartTagVoteMemForTest();
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const { db, store } = memoryKv();
	let fetches = 0;
	const fetchJson = async () => {
		fetches += 1;
		return poolResponse(400 + fetches);
	};
	const first = await tagAnalysisFor(oneSave, {
		fetchJson,
		saveRevision: "rev-ttl",
		db,
	});
	assert.equal(first.totalVotes, 401);
	t.mock.timers.tick(CHART_TAG_ANALYSIS_TTL_MS - 1);
	await tagAnalysisFor(oneSave, { fetchJson, saveRevision: "rev-ttl", db });
	assert.equal(fetches, 1);

	// Another instance: memory is cold and the KV copy carries its fetch time
	resetChartTagVoteMemForTest();
	const fromKv = await tagAnalysisFor(oneSave, {
		fetchJson,
		saveRevision: "rev-ttl",
		db,
	});
	assert.equal(fetches, 1);
	assert.equal(fromKv.totalVotes, 401);

	t.mock.timers.tick(1);
	const fresh = await tagAnalysisFor(oneSave, {
		fetchJson,
		saveRevision: "rev-ttl",
		db,
	});
	assert.equal(fetches, 2);
	assert.equal(fresh.totalVotes, 402);
	const key = chartTagAnalysisKvKey(chartTagCacheId("rev-ttl"));
	assert.equal(
		(JSON.parse(store.get(key)!) as { at: number }).at,
		1_000_000 + CHART_TAG_ANALYSIS_TTL_MS,
	);
});

test("v1 KV entries (no fetch time) are not served", async () => {
	resetChartTagVoteMemForTest();
	const { db, store } = memoryKv();
	const id = chartTagCacheId("rev-old");
	store.set(
		kvKey("b30Analysis", id),
		JSON.stringify(parseB30TagAnalysis(poolResponse(1))),
	);
	store.set(
		chartTagAnalysisKvKey(id),
		JSON.stringify(parseB30TagAnalysis(poolResponse(2))),
	);
	let fetches = 0;
	const got = await tagAnalysisFor(oneSave, {
		saveRevision: "rev-old",
		db,
		fetchJson: async () => {
			fetches += 1;
			return poolResponse(3);
		},
	});
	assert.equal(fetches, 1);
	assert.equal(got.totalVotes, 3);
});

test("concurrent lookups for one save share a single POST", async () => {
	resetChartTagVoteMemForTest();
	const { db } = memoryKv();
	const answer = deferred<unknown>();
	let fetches = 0;
	const fetchJson = () => {
		fetches += 1;
		return answer.promise;
	};
	const a = tagAnalysisFor(oneSave, { fetchJson, saveRevision: "rev-d", db });
	const b = tagAnalysisFor(oneSave, { fetchJson, saveRevision: "rev-d", db });
	const other = tagAnalysisFor(oneSave, {
		fetchJson: async () => poolResponse(7),
		saveRevision: "rev-other",
		db,
	});
	answer.resolve(poolResponse());
	const [ra, rb, ro] = await Promise.all([a, b, other]);
	assert.equal(fetches, 1);
	assert.deepEqual(ra, rb);
	assert.equal(ro.totalVotes, 7);

	// A failed shared lookup is not remembered: the next render asks again
	resetChartTagVoteMemForTest();
	const fail = deferred<unknown>();
	let tries = 0;
	const failing = () => {
		tries += 1;
		return tries === 1 ? fail.promise : Promise.resolve(poolResponse(9));
	};
	const x = tagAnalysisFor(oneSave, {
		fetchJson: failing,
		saveRevision: "rev-f",
	});
	const y = tagAnalysisFor(oneSave, {
		fetchJson: failing,
		saveRevision: "rev-f",
	});
	fail.reject(new TypeError("fetch failed"));
	await assert.rejects(x, TypeError);
	await assert.rejects(y, TypeError);
	assert.equal(tries, 1);
	const retry = await tagAnalysisFor(oneSave, {
		fetchJson: failing,
		saveRevision: "rev-f",
	});
	assert.equal(tries, 2);
	assert.equal(retry.totalVotes, 9);
});

test("render budget gives up early; the lookup still fills the cache", async () => {
	resetChartTagVoteMemForTest();
	const { db, store } = memoryKv();
	const answer = deferred<unknown>();
	let fetches = 0;
	const fetchJson = () => {
		fetches += 1;
		return answer.promise;
	};
	const started = performance.now();
	await assert.rejects(
		tagAnalysisFor(oneSave, {
			fetchJson,
			saveRevision: "rev-b",
			db,
			budgetMs: 20,
		}),
		(err) => isChartTagTimeout(err),
	);
	assert.ok(performance.now() - started < 1_000);
	answer.resolve(poolResponse(321));
	await new Promise((r) => setTimeout(r, 0));
	const later = await tagAnalysisFor(oneSave, {
		fetchJson,
		saveRevision: "rev-b",
		db,
		budgetMs: 20,
	});
	assert.equal(fetches, 1);
	assert.equal(later.totalVotes, 321);
	assert.ok(store.has(chartTagAnalysisKvKey(chartTagCacheId("rev-b"))));
});

test("budget passes answers and errors through untouched", async () => {
	assert.equal(await withChartTagBudget(Promise.resolve(5), 50, "x"), 5);
	await assert.rejects(
		withChartTagBudget(Promise.reject(new Error("chart-tag 502")), 50, "x"),
		/chart-tag 502/,
	);
	assert.equal(CHART_TAG_RENDER_BUDGET_MS, 8_000);
	assert.ok(CHART_TAG_BACKGROUND_MS > CHART_TAG_RENDER_BUDGET_MS);
	assert.ok(CHART_TAG_BACKGROUND_MS >= 25_000);
});

test("loadChartTagTree stops waiting at the budget but keeps the live fetch", async () => {
	resetChartTagTreeMemForTest();
	const live = deferred<unknown>();
	let calls = 0;
	const opts = {
		getCached: async () => undefined,
		fetchJson: () => {
			calls += 1;
			return live.promise;
		},
		budgetMs: 20,
	};
	await assert.rejects(loadChartTagTree(opts), (err) => isChartTagTimeout(err));
	live.resolve({ data: [{ name: "多指", description: "多指相关难点" }] });
	await new Promise((r) => setTimeout(r, 0));
	const tree = await loadChartTagTree(opts);
	assert.equal(calls, 1);
	assert.equal(tree[0]?.name, "多指");
	resetChartTagTreeMemForTest();
});

test("gameRecord payload is EZ/HD/IN arrays, not rank maps", () => {
	assert.deepEqual(
		gameRecordPayload({
			Credits: [
				null,
				{ acc: 98, score: 990000, fc: 1 },
				{ acc: 100, score: 1e6, fc: true },
			],
		}),
		{
			"Credits.0": [
				null,
				{ acc: 98, score: 990000, fc: true },
				{ acc: 100, score: 1e6, fc: true },
			],
		},
	);
});
