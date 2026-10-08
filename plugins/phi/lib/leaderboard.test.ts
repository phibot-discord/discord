import assert from "node:assert/strict";
import test from "node:test";
import {
	badQueryIndexes,
	clampAcc,
	fetchAccRanks,
	fmtCount,
	fmtTopPercent,
	LB_API_FRESH_MAX,
	LeaderboardError,
	leaderboardJson,
	namesUnknownSong,
	normalizeAccRank,
	parseApFc,
	parseLeaderboardQuery,
	parseSongAccList,
	peekRankRows,
	placeUser,
	rankKey,
	rankQueryAcc,
	rankRows,
	resetLeaderboardForTest,
	slotGate,
	songApFc,
	songBoard,
	summarizeBoard,
} from "./leaderboard.ts";

type Call = { path: string; body: Record<string, unknown> };

/** The queries one allAccRank call sent ([] when there was no such call) */
function queriesOf(call: Call | undefined) {
	return (call?.body.queries ?? []) as { songId: string; acc: number }[];
}

/** A fake phib19: answers allAccRank with betterCount = 100 − ⌊acc⌋, totalCount 1000 */
function fakePhib19(
	opts: {
		status?: number;
		body?: unknown;
		badIds?: string[];
		delayMs?: number;
		fail?: boolean;
	} = {},
) {
	const calls: Call[] = [];
	let active = 0;
	let peak = 0;
	const post = async (path: string, body: unknown) => {
		calls.push({ path, body: body as Record<string, unknown> });
		active++;
		peak = Math.max(peak, active);
		try {
			if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
			if (opts.fail) throw new Error("connect ETIMEDOUT");
			if (opts.status || opts.body !== undefined) {
				return { status: opts.status ?? 200, body: opts.body };
			}
			const b = body as {
				queries?: { songId: string; rank: string; acc: number }[];
				dimension?: string[];
			};
			if (path.endsWith("allAccRank")) {
				const bad = (b.queries ?? []).flatMap((q, i) =>
					opts.badIds?.includes(q.songId)
						? [{ path: ["queries", i, "songId"], message: "未找到对应 songId" }]
						: [],
				);
				if (bad.length) {
					return {
						status: 400,
						body: { error: "请求参数 不正确", details: bad },
					};
				}
				const rows = (b.queries ?? []).map((q) => ({
					songId: q.songId,
					rank: q.rank,
					acc: q.acc,
					topPercent: 1,
					betterCount: 100 - Math.floor(q.acc),
					totalCount: 1000,
				}));
				const dims = b.dimension ?? ["all"];
				return {
					status: 200,
					body: {
						data:
							dims.length === 1
								? rows
								: Object.fromEntries(dims.map((d) => [d, rows])),
					},
				};
			}
			return { status: 404, body: null };
		} finally {
			active--;
		}
	};
	return { post, calls, peak: () => peak };
}

function memKv() {
	const map = new Map<string, string>();
	const sets: string[] = [];
	let gets = 0;
	return {
		map,
		sets,
		gets: () => gets,
		db: {
			get: async (k: string) => {
				gets++;
				return map.get(k);
			},
			set: async (k: string, v: string) => {
				sets.push(k);
				map.set(k, v);
			},
		},
	};
}

const known = () => true;
const tick = () => new Promise((r) => setTimeout(r, 5));

test.beforeEach(() => resetLeaderboardForTest());

test("acc is clamped to [0, 100] and nudged by ε below 100", () => {
	assert.equal(clampAcc(102.57), 100);
	assert.equal(clampAcc(-1), 0);
	assert.equal(clampAcc("x"), 0);
	assert.equal(rankQueryAcc(102.57), 100);
	assert.equal(rankQueryAcc(100), 100);
	assert.equal(rankQueryAcc(99.5), 99.5 + 1e-6);
	assert.equal(rankQueryAcc(99.9999995), 100);
});

test("placeUser: strictly-better count + 1 below 100, AP is #1 tied with the AP group", () => {
	// Rrhar'il AT at 99.5 %: 3,610 records are better, of 70,387
	const p = placeUser(99.5, { better: 3610, total: 70387 });
	assert.deepEqual(
		{ rank: p?.rank, of: p?.of, tied: p?.tied, ap: p?.ap },
		{ rank: 3611, of: 70388, tied: 0, ap: false },
	);
	assert.ok(Math.abs((p?.percent ?? 0) - (3611 / 70388) * 100) < 1e-9);
	const ap = placeUser(100, { better: 2032, total: 70387 });
	assert.equal(ap?.rank, 1);
	assert.equal(ap?.tied, 2032);
	assert.ok(Math.abs((ap?.percent ?? 0) - (2033 / 70388) * 100) < 1e-9);
	assert.equal(placeUser(98, { better: 0, total: 0 }), null);
	assert.equal(placeUser(98, null), null);
	// More "better" than records (a race between counts) never ranks past the end
	assert.equal(placeUser(10, { better: 12, total: 10 })?.rank, 11);
});

test("percent and count formatting", () => {
	assert.equal(fmtCount(70388), "70,388");
	assert.equal(fmtTopPercent(5.1289), "5.1");
	assert.equal(fmtTopPercent(0.0014), "0.01");
	assert.equal(fmtTopPercent(0.456), "0.46");
	assert.equal(fmtTopPercent(100), "100.0");
});

test("normalizeAccRank reads the one-dimension array and the {all,b30} object", () => {
	const q = [
		{ songId: "a.0", rank: "AT", acc: 99 },
		{ songId: "b.0", rank: "IN", acc: 98 },
	];
	const row = (songId: string, rank: string, better: number) => ({
		songId,
		rank,
		betterCount: better,
		totalCount: 10,
	});
	assert.deepEqual(
		normalizeAccRank([row("a.0", "AT", 3), row("b.0", "IN", 5)], ["all"], q),
		{
			all: [
				{ better: 3, total: 10 },
				{ better: 5, total: 10 },
			],
		},
	);
	const two = normalizeAccRank(
		{ all: [row("a.0", "AT", 3)], b30: [row("a.0", "AT", 1)] },
		["all", "b30"],
		q.slice(0, 1),
	);
	assert.deepEqual(two?.b30, [{ better: 1, total: 10 }]);
	// A level phib19 has no records for: totalCount 0, a real "none". A shifted
	// row is not trusted (null: asked again soon)
	assert.deepEqual(
		normalizeAccRank(
			[
				{
					songId: "a.0",
					rank: "AT",
					topPercent: null,
					betterCount: 0,
					totalCount: 0,
				},
				row("x.0", "IN", 1),
			],
			["all"],
			q,
		),
		{ all: [{ better: 0, total: 0 }, null] },
	);
	assert.deepEqual(
		normalizeAccRank(
			[{ songId: "a.0", rank: "AT", betterCount: null, totalCount: 9 }],
			["all"],
			q.slice(0, 1),
		),
		{ all: [null] },
	);
	assert.equal(normalizeAccRank({ error: "缺少 token" }, ["all"], q), null);
	assert.equal(
		normalizeAccRank([row("a.0", "AT", 1)], ["all", "b30"], q),
		null,
	);
});

test("badQueryIndexes reads the unknown-songId paths of a 400", () => {
	const body = {
		details: [
			{ path: ["queries", 2, "songId"] },
			{ path: ["queries", 0, "acc"] },
			{ path: "nope" },
		],
	};
	assert.deepEqual([...badQueryIndexes(body)], [2]);
	assert.equal(badQueryIndexes(null).size, 0);
});

test("fetchAccRanks clamps acc, chunks by 10 with 2 in flight and keeps query order", async () => {
	const fake = fakePhib19({ delayMs: 5 });
	const queries = Array.from({ length: 45 }, (_, i) => ({
		songId: `s${i}`,
		rank: "IN",
		acc: i === 0 ? 102.57 : 50 + i / 2,
	}));
	const res = await fetchAccRanks(queries, {}, { post: fake.post, known });
	assert.equal(fake.calls.length, 5);
	assert.deepEqual(
		fake.calls.map((c) => (c.body.queries as unknown[]).length),
		[10, 10, 10, 10, 5],
	);
	assert.ok(fake.peak() <= 2);
	const first = queriesOf(fake.calls[0])[0];
	assert.equal(first?.songId, "s0.0");
	assert.equal(first?.acc, 100);
	assert.deepEqual(fake.calls[0]?.body.dimension, ["all"]);
	assert.equal(res.all.length, 45);
	assert.equal(res.all[44]?.better, 100 - Math.floor(50 + 44 / 2));
});

test("ids the catalog doesn't know are never sent (no records there), nor LEGACY rows", async () => {
	const fake = fakePhib19();
	const res = await fetchAccRanks(
		[
			{ songId: "new.0", rank: "IN", acc: 99 },
			{ songId: "old.0", rank: "LEGACY", acc: 99 },
			{ songId: "ok.0", rank: "AT", acc: 99 },
		],
		{},
		{ post: fake.post, known: (id) => id !== "new.0" },
	);
	assert.equal(fake.calls.length, 1);
	assert.deepEqual(
		queriesOf(fake.calls[0]).map((q) => q.songId),
		["ok.0"],
	);
	assert.deepEqual(res.all, [
		{ better: 0, total: 0 },
		null,
		{ better: 1, total: 1000 },
	]);
});

test("a 400 naming an unknown id drops it, retries once and remembers it", async () => {
	const fake = fakePhib19({ badIds: ["gone.0"] });
	const queries = [
		{ songId: "a.0", rank: "IN", acc: 97 },
		{ songId: "gone.0", rank: "IN", acc: 97 },
		{ songId: "b.0", rank: "AT", acc: 90 },
	];
	const res = await fetchAccRanks(queries, {}, { post: fake.post, known });
	assert.equal(fake.calls.length, 2);
	assert.deepEqual(res.all, [
		{ better: 3, total: 1000 },
		{ better: 0, total: 0 },
		{ better: 10, total: 1000 },
	]);
	await fetchAccRanks(queries, {}, { post: fake.post, known });
	assert.equal(fake.calls.length, 3);
	assert.equal(queriesOf(fake.calls[2]).length, 2);
});

test("an HTTP-200 {error} body is a failure, and failures open the breaker", async () => {
	const fake = fakePhib19({ body: { error: "缺少 token" } });
	await assert.rejects(
		fetchAccRanks(
			[{ songId: "a.0", rank: "IN", acc: 97 }],
			{},
			{ post: fake.post, known },
		),
		(err) => err instanceof LeaderboardError && err.code === "upstream",
	);
	await assert.rejects(
		fetchAccRanks(
			[{ songId: "a.0", rank: "IN", acc: 97 }],
			{},
			{ post: fake.post, known },
		),
		(err) => err instanceof LeaderboardError && err.code === "breaker",
	);
	assert.equal(fake.calls.length, 1);
});

test("a network failure opens the breaker for that endpoint only", async () => {
	const down = fakePhib19({ fail: true });
	await assert.rejects(
		fetchAccRanks(
			[{ songId: "a.0", rank: "IN", acc: 97 }],
			{},
			{ post: down.post, known },
		),
		(err) => err instanceof LeaderboardError && err.code === "network",
	);
	await assert.rejects(
		fetchAccRanks(
			[{ songId: "a.0", rank: "IN", acc: 97 }],
			{},
			{ post: down.post, known },
		),
		(err) => err instanceof LeaderboardError && err.code === "breaker",
	);
	assert.equal(down.calls.length, 1);
	const up = fakePhib19({
		body: { data: { AT: { total: 10, apCount: 1, fcCount: 2 } } },
	});
	assert.deepEqual(await songApFc("a", {}, { post: up.post }), {
		AT: { total: 10, ap: 1, fc: 2 },
	});
});

test("rankRows keeps one KV blob per row set (no owner) and answers repeats from memory", async () => {
	const fake = fakePhib19();
	const kv = memKv();
	const rows = [
		{ songId: "a", rank: "IN", acc: 97.25 },
		{ songId: "b.0", rank: "AT", acc: 100 },
		{ songId: "a.0", rank: "IN", acc: 97.25 },
	];
	const out = await rankRows(rows, { db: kv.db }, { post: fake.post, known });
	assert.equal(fake.calls.length, 1);
	assert.equal(queriesOf(fake.calls[0]).length, 2);
	assert.equal(out.partial, false);
	assert.equal(out.rows.get(rankKey(rows[0]!))?.better, 3);
	assert.equal(out.rows.get(rankKey(rows[1]!))?.better, 0);
	await tick();
	assert.equal(kv.sets.length, 1);
	assert.match(kv.sets[0]!, /^phi:lb:rank:v2:[0-9a-f]{32}$/);
	await rankRows(rows, { db: kv.db }, { post: fake.post, known });
	assert.equal(fake.calls.length, 1);
	// Another instance: memory is empty, the blob in KV answers
	resetLeaderboardForTest();
	const again = await rankRows(rows, { db: kv.db }, { post: fake.post, known });
	assert.equal(fake.calls.length, 1);
	assert.equal(again.rows.get(rankKey(rows[0]!))?.better, 3);
});

test("rankRows returns the rows of the chunks that answered when another chunk fails", async () => {
	const kv = memKv();
	const ok = fakePhib19();
	let n = 0;
	// The second chunk times out; the first answers
	const flaky = async (path: string, body: unknown) => {
		n++;
		if (n === 2) throw new Error("The operation was aborted due to timeout");
		return ok.post(path, body);
	};
	const rows = Array.from({ length: 15 }, (_, i) => ({
		songId: `s${i}`,
		rank: "IN",
		acc: 90 + i / 10,
	}));
	const first = await rankRows(rows, { db: kv.db }, { post: flaky, known });
	assert.equal(first.partial, true);
	assert.equal(first.error?.code, "network");
	assert.equal(first.rows.size, 10);
	await tick();
	const blob = JSON.parse(kv.map.get(kv.sets.at(-1)!)!) as {
		rows: Record<string, unknown>;
	};
	assert.equal(Object.keys(blob.rows).length, 10);
	// Moments later: the failure isn't retried, but the 10 rows are still drawn
	const again = await rankRows(rows, { db: kv.db }, { post: flaky, known });
	assert.equal(n, 2);
	assert.equal(again.partial, true);
	assert.equal(again.rows.size, 10);
	assert.equal(peekRankRows(rows).rows.size, 10);
	// Another instance later on: the blob answers 10 rows, only 5 are asked for
	resetLeaderboardForTest();
	const out = await rankRows(rows, { db: kv.db }, { post: ok.post, known });
	assert.equal(out.partial, false);
	assert.equal(out.rows.size, 15);
	assert.equal(queriesOf(ok.calls.at(-1)).length, 5);
});

test("an owner's rank rows merge across cards: rows from an earlier card are reused, not asked again", async () => {
	const kv = memKv();
	const fake = fakePhib19();
	const row = (id: string) => ({ songId: id, rank: "IN", acc: 98.5 });
	await rankRows(
		[row("a"), row("b")],
		{ db: kv.db, owner: "u1" },
		{ post: fake.post, known },
	);
	await tick();
	assert.deepEqual(kv.sets, ["phi:lb:rank:v2:u1:all"]);
	// Another instance, another row set (a new count, a new score): only "c" is asked
	resetLeaderboardForTest();
	const out = await rankRows(
		[row("b"), row("c")],
		{ db: kv.db, owner: "u1" },
		{ post: fake.post, known },
	);
	assert.equal(out.partial, false);
	assert.deepEqual(
		queriesOf(fake.calls.at(-1)).map((q) => q.songId),
		["c.0"],
	);
	await tick();
	const blob = JSON.parse(kv.map.get("phi:lb:rank:v2:u1:all")!) as {
		v: number;
		rows: Record<string, [number, number, number]>;
	};
	assert.equal(blob.v, 2);
	assert.deepEqual(
		Object.keys(blob.rows).sort(),
		[rankKey(row("a")), rankKey(row("b")), rankKey(row("c"))].sort(),
	);
	// A band has its own blob
	await rankRows(
		[row("a")],
		{ db: kv.db, owner: "u1", band: { minRks: 16.25, maxRks: 16.35 } },
		{ post: fake.post, known },
	);
	await tick();
	assert.ok(kv.map.has("phi:lb:rank:v2:u1:16.25-16.35"));
});

test("rows a card got stay on the next card when that card's lookup fails", async () => {
	const kv = memKv();
	const ok = fakePhib19();
	const rows = Array.from({ length: 12 }, (_, i) => ({
		songId: `s${i}`,
		rank: "IN",
		acc: 90 + i / 10,
	}));
	// The first card: every row answered
	const first = await rankRows(
		rows,
		{ db: kv.db, owner: "u1" },
		{ post: ok.post, known },
	);
	assert.equal(first.rows.size, 12);
	await tick();
	// The next card, on a fresh instance, adds a row and phib19 is down: the 12 still draw
	resetLeaderboardForTest();
	const down = fakePhib19({ fail: true });
	const extra = { songId: "new", rank: "AT", acc: 99 };
	const second = await rankRows(
		[...rows, extra],
		{ db: kv.db, owner: "u1" },
		{ post: down.post, known },
	);
	assert.equal(second.partial, true);
	assert.equal(second.rows.size, 12);
	assert.equal(second.rows.has(rankKey(extra)), false);
	assert.deepEqual(
		queriesOf(down.calls[0]).map((q) => q.songId),
		["new.0"],
	);
});

test("a row past its 6 h is asked again, but still drawn while the new answer is missing", async () => {
	const kv = memKv();
	const q = { songId: "old", rank: "IN", acc: 97 };
	const day = 24 * 60 * 60 * 1000;
	await kv.db.set(
		"phi:lb:rank:v2:u1:all",
		JSON.stringify({
			v: 2,
			rows: {
				[rankKey(q)]: [5, 500, Date.now() - day],
				// Past the 7-day fallback: dropped
				[rankKey({ ...q, songId: "gone" })]: [1, 9, Date.now() - 8 * day],
			},
		}),
	);
	const down = fakePhib19({ fail: true });
	const res = await rankRows(
		[q, { ...q, songId: "gone" }],
		{ db: kv.db, owner: "u1" },
		{ post: down.post, known },
	);
	assert.equal(down.calls.length, 1, "the day-old row is asked again");
	assert.equal(res.partial, true);
	assert.equal(res.stale, 1, "drawn, but out of date");
	assert.equal(res.missing, 1, "past 7 days: gone");
	assert.deepEqual(res.rows.get(rankKey(q)), { better: 5, total: 500 });
	assert.equal(res.rows.has(rankKey({ ...q, songId: "gone" })), false);
	assert.deepEqual(peekRankRows([q]).rows.get(rankKey(q)), {
		better: 5,
		total: 500,
	});
	// Once phib19 answers, the new row replaces it
	resetLeaderboardForTest();
	const ok = fakePhib19();
	const fresh = await rankRows(
		[q],
		{ db: kv.db, owner: "u1" },
		{ post: ok.post, known },
	);
	assert.equal(fresh.partial, false);
	assert.deepEqual(fresh.rows.get(rankKey(q)), { better: 3, total: 1000 });
	await tick();
	const blob = JSON.parse(kv.map.get("phi:lb:rank:v2:u1:all")!) as {
		rows: Record<string, [number, number, number]>;
	};
	assert.deepEqual(blob.rows[rankKey(q)]?.slice(0, 2), [3, 1000]);
	assert.equal(blob.rows[rankKey({ ...q, songId: "gone" })], undefined);
});

test("the rank blob is written as soon as a chunk lands, not only when the job ends", async () => {
	const kv = memKv();
	const ok = fakePhib19();
	let n = 0;
	let release: (() => void) | undefined;
	// The second chunk hangs (a function about to be frozen); the first answers
	const post = async (path: string, body: unknown) => {
		if (++n === 2) await new Promise<void>((r) => (release = r));
		return ok.post(path, body);
	};
	const rows = Array.from({ length: 15 }, (_, i) => ({
		songId: `s${i}`,
		rank: "IN",
		acc: 90 + i / 10,
	}));
	const job = rankRows(rows, { db: kv.db }, { post, known });
	await tick();
	assert.equal(kv.sets.length, 1);
	const blob = JSON.parse(kv.map.get(kv.sets[0]!)!) as {
		rows: Record<string, unknown>;
	};
	assert.equal(Object.keys(blob.rows).length, 10);
	release?.();
	assert.equal((await job).rows.size, 15);
	await tick();
	assert.equal(kv.sets.length, 2);
});

test("an unusable row is missing (partial) and not stored; totalCount 0 is an answer", async () => {
	const kv = memKv();
	const post = async (_path: string, body: unknown) => {
		const q = (body as { queries: { songId: string; rank: string }[] }).queries;
		return {
			status: 200,
			body: {
				data: [
					// Shifted: names another song
					{ songId: "zzz.0", rank: "IN", betterCount: 1, totalCount: 9 },
					{ ...q[1], betterCount: 0, totalCount: 0 },
				],
			},
		};
	};
	const rows = [
		{ songId: "a.0", rank: "IN", acc: 97 },
		{ songId: "b.0", rank: "EZ", acc: 97 },
	];
	const res = await rankRows(rows, { db: kv.db }, { post, known });
	assert.equal(res.partial, true);
	assert.equal(res.rows.has(rankKey(rows[0]!)), false);
	assert.deepEqual(res.rows.get(rankKey(rows[1]!)), { better: 0, total: 0 });
	await tick();
	const blob = JSON.parse(kv.map.get(kv.sets.at(-1)!)!) as {
		rows: Record<string, unknown>;
	};
	assert.deepEqual(Object.keys(blob.rows), [rankKey(rows[1]!)]);
	assert.equal(placeUser(97, res.rows.get(rankKey(rows[1]!))), null);
});

test("a slot gate runs at most `limit` jobs and refuses past its queue", async () => {
	const run = slotGate(2, 3);
	let active = 0;
	let peak = 0;
	const job = async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((r) => setTimeout(r, 5));
		active--;
		return 1;
	};
	const jobs = Array.from({ length: 5 }, () => run(job));
	await assert.rejects(
		run(job),
		(err) => err instanceof LeaderboardError && err.code === "breaker",
	);
	assert.deepEqual(await Promise.all(jobs), [1, 1, 1, 1, 1]);
	assert.equal(peak, 2);
	assert.equal(await run(job), 1);
});

test("phib19 requests wait for a slot (4 at once) before they are sent", async () => {
	let active = 0;
	let peak = 0;
	const post = async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((r) => setTimeout(r, 10));
		active--;
		return {
			status: 200,
			body: { data: { AT: { total: 1, apCount: 0, fcCount: 0 } } },
		};
	};
	await Promise.all(
		Array.from({ length: 9 }, (_, i) => songApFc(`s${i}`, {}, { post, known })),
	);
	assert.equal(peak, 4);
});

test("concurrent rankRows for the same rows share one request", async () => {
	const fake = fakePhib19({ delayMs: 10 });
	const rows = [{ songId: "a.0", rank: "IN", acc: 97 }];
	await Promise.all([
		rankRows(rows, {}, { post: fake.post, known }),
		rankRows(rows, {}, { post: fake.post, known }),
	]);
	assert.equal(fake.calls.length, 1);
});

test("parseSongAccList maps columns by the header row", () => {
	assert.deepEqual(
		parseSongAccList([
			["score", "acc", "fc"],
			[1000000, 100, 1],
			[990000, 99.1, 0],
			["x", "bad", 0],
		]),
		[
			{ acc: 100, score: 1000000, fc: true },
			{ acc: 99.1, score: 990000, fc: false },
		],
	);
	assert.equal(parseSongAccList({ error: "x" }), null);
});

test("summarizeBoard counts AP by score, FC including AP, and bins the non-AP records", () => {
	const rows = [
		{ acc: 100, score: 1000000, fc: true },
		{ acc: 100, score: 1000000, fc: false },
		// 4 dp rounding: a non-AP that reads 100
		{ acc: 100, score: 999990, fc: true },
		...Array.from({ length: 97 }, (_, i) => ({
			acc: 99.9 - i * 0.1,
			score: 990000 - i,
			fc: false,
		})),
	];
	const b = summarizeBoard(rows, 123);
	assert.equal(b.n, 100);
	assert.equal(b.ap, 2);
	assert.equal(b.fc, 3);
	assert.equal(b.at, 123);
	assert.equal(b.q.length, 201);
	assert.equal(b.q[0], 100);
	assert.equal(b.q[200], round4(99.9 - 96 * 0.1));
	// 95 % of non-AP records are ≥ ~90.7 %: 40 bins of 0.25 from 90 to 100
	assert.equal(b.hist.step, 0.25);
	assert.equal(b.hist.lo, 90);
	assert.equal(b.hist.bins.length, 40);
	assert.equal(b.hist.bins.reduce((s, n) => s + n, 0) + b.hist.below, 98);
	// [99.75, 100): the non-AP "100", 99.9 and 99.8
	assert.equal(b.hist.bins[39], 3);
});

function round4(n: number) {
	return Math.round(n * 1e4) / 1e4;
}

test("songBoard stores only the derived summary, then serves it from memory", async () => {
	const kv = memKv();
	const calls: Call[] = [];
	const list = [
		["acc", "score", "fc"],
		[100, 1000000, 1],
		[98.5, 985000, 0],
	];
	const post = async (path: string, body: unknown) => {
		calls.push({ path, body: body as Record<string, unknown> });
		return { status: 200, body: { data: list } };
	};
	const b = await songBoard("Song.X", "AT", { db: kv.db }, { post });
	assert.equal(b.n, 2);
	assert.deepEqual(calls[0]?.body, {
		songId: "Song.X.0",
		rank: "AT",
		requestField: ["acc", "score", "fc"],
		numPrecision: 4,
	});
	await tick();
	const stored = kv.map.get("phi:lb:board:v1:Song.X.0:AT");
	assert.ok(stored);
	assert.equal(JSON.parse(stored).n, 2);
	assert.ok(!stored.includes("985000"));
	await songBoard("Song.X.0", "AT", { db: kv.db }, { post });
	assert.equal(calls.length, 1);
});

test("a song phib19 doesn't know is an empty board and no counts, not a failure", async () => {
	const calls: string[] = [];
	const post = async (path: string) => {
		calls.push(path);
		return {
			status: 400,
			body: {
				error: "请求参数 不正确",
				details: [{ code: "invalid_value", path: ["songId"] }],
			},
		};
	};
	// Not in the catalog: nothing is sent
	const off = { post, known: () => false };
	assert.equal((await songBoard("New.Song", "IN", {}, off)).n, 0);
	assert.deepEqual(await songApFc("New.Song", {}, off), {});
	assert.equal(calls.length, 0);
	// In the catalog, but phib19 400s naming songId: remembered, not asked again
	assert.equal((await songBoard("Sp.Song", "IN", {}, { post, known })).n, 0);
	assert.deepEqual(await songApFc("Sp.Song", {}, { post, known }), {});
	assert.equal(calls.length, 1);
	assert.equal((await songBoard("Sp.Song", "AT", {}, { post, known })).n, 0);
	assert.equal(calls.length, 1);
	// A 400 about something else stays a failure
	const other = async () => ({
		status: 400,
		body: { details: [{ path: ["rank"] }] },
	});
	await assert.rejects(
		songBoard("X.Song", "IN", {}, { post: other, known }),
		(err) => err instanceof LeaderboardError && err.code === "bad_request",
	);
	assert.equal(namesUnknownSong({ details: [{ path: ["songId"] }] }), true);
	assert.equal(namesUnknownSong({ details: [{ path: ["rank"] }] }), false);
	assert.equal(namesUnknownSong(null), false);
});

test("parseApFc keeps known levels and caps AP ≤ FC ≤ total", () => {
	assert.deepEqual(
		parseApFc({
			AT: { total: 70416, apCount: 2036, fcCount: 3359 },
			IN: { total: 5, apCount: 9, fcCount: 1 },
			LEGACY: { total: 1 },
		}),
		{
			AT: { total: 70416, ap: 2036, fc: 3359 },
			IN: { total: 5, ap: 5, fc: 5 },
		},
	);
	assert.equal(parseApFc([]), null);
});

test("parseLeaderboardQuery validates chart, level, acc and an optional band", () => {
	const has = (id: string, level: string) =>
		id === "Song.X.0" && level === "AT";
	const q = (s: string) => parseLeaderboardQuery(new URLSearchParams(s), has);
	assert.deepEqual(q("chart=Song.X&level=at&acc=99.5"), {
		chart: "Song.X.0",
		level: "AT",
		acc: 99.5,
		band: undefined,
	});
	assert.deepEqual(
		q("chart=Song.X&level=AT&acc=100&minRks=16&maxRks=16.1")?.band,
		{
			minRks: 16,
			maxRks: 16.1,
		},
	);
	assert.equal(q("chart=Song.X&level=IN&acc=99"), null);
	assert.equal(q("chart=Song.X&level=AT&acc=101"), null);
	assert.equal(q("chart=Song.X&level=AT&acc="), null);
	assert.equal(q("chart=Song.X&level=AT&acc=99&minRks=16"), null);
	assert.equal(q("level=AT&acc=99"), null);
});

test("leaderboardJson answers rank, population and AP/FC; upstream trouble is a 503", async () => {
	const fake = fakePhib19();
	const post = async (path: string, body: unknown) =>
		path.endsWith("songApFcCount")
			? {
					status: 200,
					body: { data: { AT: { total: 1000, apCount: 7, fcCount: 30 } } },
				}
			: fake.post(path, body);
	const ok = await leaderboardJson(
		{
			chart: "Song.X.0",
			level: "AT",
			acc: 97.5,
			band: { minRks: 16, maxRks: 16.1 },
		},
		{},
		{ post, known },
	);
	assert.equal(ok.status, 200);
	assert.deepEqual(ok.body, {
		chart: "Song.X.0",
		level: "AT",
		acc: 97.5,
		// The fake counts 100 − ⌊97.5⌋ = 3 records better: rank 4 of 1,001
		rank: 4,
		of: 1001,
		percent: Math.round((4 / 1001) * 100 * 1e4) / 1e4,
		tied: 0,
		total: 1000,
		ap: 7,
		fc: 30,
		band: {
			rank: 4,
			of: 1001,
			percent: Math.round((4 / 1001) * 100 * 1e4) / 1e4,
			tied: 0,
			total: 1000,
			minRks: 16,
			maxRks: 16.1,
		},
		source: "phib19.top",
	});
	resetLeaderboardForTest();
	const down = await leaderboardJson(
		{ chart: "Song.X.0", level: "AT", acc: 97.5 },
		{},
		{ post: fakePhib19({ status: 502, body: null }).post, known },
	);
	assert.deepEqual(down, {
		status: 503,
		body: { error: "upstream_unavailable" },
	});
});

test("leaderboardJson leaves out a failed band instead of failing the answer", async () => {
	const fake = fakePhib19();
	const post = async (path: string, body: unknown) =>
		(body as { minRks?: number }).minRks != null
			? { status: 502, body: null }
			: fake.post(path, body);
	const res = await leaderboardJson(
		{
			chart: "Song.X.0",
			level: "AT",
			acc: 97.5,
			band: { minRks: 16, maxRks: 16.1 },
		},
		{},
		{ post, known },
	);
	assert.equal(res.status, 200);
	assert.equal((res.body as { rank: number }).rank, 4);
	assert.ok(!("band" in res.body));
	// No records on the chart: a 404, not a 503
	resetLeaderboardForTest();
	const none = await leaderboardJson(
		{ chart: "New.Song.0", level: "AT", acc: 97.5 },
		{},
		{ post: fake.post, known: () => false },
	);
	assert.deepEqual(none, { status: 404, body: { error: "no_data" } });
});

test("a late leaderboardJson hands its lookups to the background, and the retry is answered", async () => {
	const fake = fakePhib19({ delayMs: 60 });
	const background: Promise<unknown>[] = [];
	const q = { chart: "Song.X.0", level: "AT" as const, acc: 97.5 };
	const slow = await leaderboardJson(
		q,
		{ budgetMs: 10, background: (work) => background.push(work) },
		{ post: fake.post, known },
	);
	assert.deepEqual(slow, { status: 503, body: { error: "upstream_slow" } });
	assert.equal(background.length, 1);
	await background[0];
	const again = await leaderboardJson(
		q,
		{ budgetMs: 10, background: (work) => background.push(work) },
		{ post: fake.post, known },
	);
	assert.equal(again.status, 200);
	assert.equal(background.length, 1);
});

test("too many uncached leaderboardJson lookups at once are refused; cached ones are not", async () => {
	const fake = fakePhib19({ delayMs: 40 });
	const background: Promise<unknown>[] = [];
	const ask = (acc: number) =>
		leaderboardJson(
			{ chart: "Song.X.0", level: "AT", acc },
			{ budgetMs: 5, background: (work) => background.push(work) },
			{ post: fake.post, known },
		);
	for (let i = 0; i < LB_API_FRESH_MAX; i++) {
		assert.equal((await ask(90 + i)).status, 503);
	}
	assert.deepEqual(await ask(80), {
		status: 503,
		body: { error: "upstream_busy" },
	});
	await Promise.all(background);
	assert.equal((await ask(90)).status, 200);
	// Room again: 80 is looked up now (and is late like the others were)
	assert.deepEqual(await ask(80), {
		status: 503,
		body: { error: "upstream_slow" },
	});
});
