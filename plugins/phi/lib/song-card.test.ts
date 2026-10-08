import assert from "node:assert/strict";
import test from "node:test";
import type { PhiLocale } from "./card-i18n.ts";
import { resetLeaderboardForTest } from "./leaderboard.ts";
import type { UserNotes } from "./notes.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save } from "./save.ts";
import { buildSongCard, type SongCardData } from "./song-card.ts";

type Body = Record<string, unknown> & {
	queries?: { songId: string; rank: string; acc: number }[];
	minRks?: number;
};

/** Stand-in phib19: 1000 records per chart (250 in an RKS band), better = 100 − ⌊acc⌋ */
function fakePhib19(opts: { delayMs?: number } = {}) {
	const calls: { path: string; body: Body }[] = [];
	const post = async (path: string, raw: unknown) => {
		const body = raw as Body;
		calls.push({ path, body });
		if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
		if (path.endsWith("allAccRank")) {
			const total = body.minRks != null ? 250 : 1000;
			return {
				status: 200,
				body: {
					data: (body.queries ?? []).map((q) => ({
						...q,
						topPercent: 1,
						betterCount: q.acc >= 100 ? 40 : 100 - Math.floor(q.acc),
						totalCount: total,
					})),
				},
			};
		}
		if (path.endsWith("songApFcCount")) {
			return {
				status: 200,
				body: {
					data: {
						IN: { total: 1000, apCount: 40, fcCount: 120 },
						AT: { total: 800, apCount: 8, fcCount: 30 },
					},
				},
			};
		}
		if (path.endsWith("songAccList")) {
			const rows = Array.from({ length: 100 }, (_, i) =>
				i < 4 ? [100, 1000000, 1] : [99.9 - i * 0.05, 990000 - i * 100, 0],
			);
			return { status: 200, body: { data: [["acc", "score", "fc"], ...rows] } };
		}
		return { status: 404, body: null };
	};
	return { post, calls };
}

const SONG = {
	id: "Test.Song.0",
	song: "Test Song",
	composer: "Someone",
	illustrator: "Artist",
	chart: {
		HD: { difficulty: 9.5, charter: "A", combo: 600 },
		IN: {
			difficulty: 14.2,
			charter: "B",
			combo: 900,
			tap: 600,
			drag: 100,
			hold: 120,
			flick: 80,
		},
	},
};

function runtime() {
	return {
		getInfo: {
			raw: (id: string) =>
				id === "Test.Song" || id === "Test.Song.0" ? SONG : undefined,
			getill: (id: string, kind = "common") => `/ill/${kind}/${id}.png`,
			idgetavatar: (id: string) => id,
		},
	} as unknown as PhiRuntime;
}

function save(
	records: Record<string, { score: number; acc: number; fc: boolean }>,
) {
	return {
		getScore: (id: string, lv: string) =>
			id === "Test.Song.0" && records[lv]
				? { ...records[lv], rks: 13.5, Rating: "V" }
				: undefined,
		saveInfo: { PlayerId: "<b>Me</b>", summary: { rankingScore: 15.123 } },
		gameuser: { avatar: "Cipher1" },
	} as unknown as Save;
}

const notes = (over: Partial<UserNotes> = {}) =>
	({ allowApiUsage: true, ...over }) as UserNotes;
const catalog = { fallbackIll: "/ill/fallback.png" };
const opts = (
	level: "EZ" | "HD" | "IN" | "AT",
	over: Partial<UserNotes> = {},
) => ({
	chart: "Test.Song",
	level,
	locale: "en" as PhiLocale,
	notes: notes(over),
});

function cardOf(built: Awaited<ReturnType<typeof buildSongCard>>) {
	assert.ok(!("error" in built));
	return {
		card: built.data.songCard as SongCardData,
		partial: built.data.renderPartial,
		templateId: built.templateId,
	};
}

test.beforeEach(() => resetLeaderboardForTest());

test("an unknown chart is a 404", async () => {
	const built = await buildSongCard(runtime(), save({}), undefined, catalog, {
		...opts("IN"),
		chart: "Nope.Nobody",
	});
	assert.deepEqual(built, { error: "unknown_card", status: 404 });
});

test("the card places the record overall and in the player's RKS band, with AP/FC and the distribution", async () => {
	const fake = fakePhib19();
	const built = await buildSongCard(
		runtime(),
		save({ IN: { score: 991234, acc: 99.25, fc: true } }),
		undefined,
		catalog,
		opts("IN"),
		{
			deps: { post: fake.post, known: () => true },
			now: new Date("2026-10-06T12:00:00Z"),
		},
	);
	const { card, partial, templateId } = cardOf(built);
	assert.equal(templateId, "phi/song/song");
	assert.equal(partial, false);
	assert.deepEqual(card.state, {
		rank: "ok",
		band: "ok",
		apfc: "ok",
		board: "ok",
	});
	assert.equal(card.title, "Test Song");
	assert.equal(card.player.name, "Me");
	assert.equal(card.player.avatar, "Cipher1");
	assert.deepEqual(card.noteKinds, {
		tap: 600,
		drag: 100,
		hold: 120,
		flick: 80,
	});
	assert.equal(card.record?.acc, 99.25);
	// acc + ε is asked: 1 record strictly better → #2 of 1001
	assert.equal(card.overall?.rank, 2);
	assert.equal(card.overall?.of, 1001);
	assert.equal(card.band?.of, 251);
	assert.deepEqual(card.rksBand, { minRks: 15.05, maxRks: 15.15 });
	const banded = fake.calls.find(
		(c) => c.path.endsWith("allAccRank") && c.body.minRks != null,
	);
	assert.equal(banded?.body.minRks, 15.05);
	assert.equal(banded?.body.queries?.[0]?.songId, "Test.Song.0");
	assert.ok((banded?.body.queries?.[0]?.acc ?? 0) > 99.25);
	assert.deepEqual(card.apfc, { total: 1000, ap: 40, fc: 120 });
	assert.equal(card.board?.n, 100);
	assert.equal(card.board?.ap, 4);
	// Only acc / score / fc are requested from songAccList
	const list = fake.calls.find((c) => c.path.endsWith("songAccList"));
	assert.deepEqual(list?.body.requestField, ["acc", "score", "fc"]);
	assert.equal(card.asOf, "2026-10-06");
	assert.deepEqual(
		card.levels.map((l) => [l.level, Boolean(l.record), l.place?.rank ?? null]),
		[
			["HD", false, null],
			["IN", true, 2],
		],
	);
});

test("a level the song lacks falls back to its hardest chart", async () => {
	const fake = fakePhib19();
	const { card } = cardOf(
		await buildSongCard(runtime(), save({}), undefined, catalog, opts("AT"), {
			deps: { post: fake.post, known: () => true },
		}),
	);
	assert.equal(card.level, "IN");
	assert.equal(card.record, null);
	assert.equal(card.state.rank, "none");
	assert.equal(card.state.band, "none");
	// No record: nothing about the user is sent, the chart's totals still are
	assert.ok(!fake.calls.some((c) => c.path.endsWith("allAccRank")));
	assert.equal(card.state.board, "ok");
});

test("lookups past the budget draw what arrived and mark the card partial", async () => {
	const fake = fakePhib19({ delayMs: 200 });
	const started = Date.now();
	const built = await buildSongCard(
		runtime(),
		save({ IN: { score: 991234, acc: 99.25, fc: true } }),
		undefined,
		catalog,
		opts("IN"),
		{ budgetMs: 30, deps: { post: fake.post, known: () => true } },
	);
	const { card, partial } = cardOf(built);
	assert.ok(Date.now() - started < 150);
	assert.equal(partial, true);
	assert.deepEqual(card.state, {
		rank: "late",
		band: "late",
		apfc: "late",
		board: "late",
	});
	assert.equal(card.overall, null);
	assert.equal(card.board, null);
	// The late lookups still finish and fill the caches for the next render
	await new Promise((r) => setTimeout(r, 300));
	const again = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ budgetMs: 30, deps: { post: fake.post, known: () => true } },
		),
	);
	assert.equal(again.partial, false);
	assert.equal(again.card.overall?.rank, 2);
});

test("failures are partial; lookups turned off in settings send nothing and are not", async () => {
	const down = async () => {
		throw new Error("connect ECONNREFUSED");
	};
	const failed = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: down, known: () => true } },
		),
	);
	assert.equal(failed.partial, true);
	assert.equal(failed.card.state.board, "failed");
	resetLeaderboardForTest();
	const fake = fakePhib19();
	const off = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN", { allowApiUsage: false }),
			{ deps: { post: fake.post, known: () => true } },
		),
	);
	assert.equal(fake.calls.length, 0);
	assert.equal(off.partial, false);
	assert.deepEqual(off.card.state, {
		rank: "off",
		band: "off",
		apfc: "off",
		board: "off",
	});
});

test("a route that isn't served (401/403/404) is 'unavailable' and partial, not 'off'", async () => {
	const blocked = async () => ({ status: 403, body: null });
	const { card, partial } = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: blocked, known: () => true } },
		),
	);
	assert.equal(partial, true);
	assert.deepEqual(card.state, {
		rank: "unavailable",
		band: "unavailable",
		apfc: "unavailable",
		board: "unavailable",
	});
	// Moments later the breaker answers, still unavailable and still partial
	const again = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: blocked, known: () => true } },
		),
	);
	assert.equal(again.partial, true);
	assert.equal(again.card.state.board, "unavailable");
});

test("a song phib19 doesn't know is a complete card with no records, not a failure", async () => {
	const fake = fakePhib19();
	const unknown = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: fake.post, known: () => false } },
		),
	);
	assert.equal(fake.calls.length, 0);
	assert.equal(unknown.partial, false);
	assert.deepEqual(unknown.card.state, {
		rank: "ok",
		band: "ok",
		apfc: "ok",
		board: "ok",
	});
	assert.equal(unknown.card.overall, null);
	assert.equal(unknown.card.board?.n, 0);
	// In the catalog (an sp_info song) but phib19 400s naming the song id
	resetLeaderboardForTest();
	const calls: string[] = [];
	const refuse = async (path: string, raw: unknown) => {
		calls.push(path);
		const body = raw as Body;
		const details = body.queries
			? body.queries.map((_q, i) => ({ path: ["queries", i, "songId"] }))
			: [{ path: ["songId"] }];
		return { status: 400, body: { error: "请求参数 不正确", details } };
	};
	const sp = cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: refuse, known: () => true } },
		),
	);
	assert.equal(sp.partial, false);
	assert.equal(sp.card.board?.n, 0);
	assert.equal(sp.card.overall, null);
	const asked = calls.length;
	// Remembered: the next view asks nothing
	cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post: refuse, known: () => true } },
		),
	);
	assert.equal(calls.length, asked);
});

test("only the shared per-chart summaries go to KV, not the user's own rank rows", async () => {
	const fake = fakePhib19();
	const keys: string[] = [];
	const db = {
		get: async () => undefined,
		set: async (k: string) => {
			keys.push(k);
		},
	};
	cardOf(
		await buildSongCard(
			runtime(),
			save({ IN: { score: 991234, acc: 99.25, fc: true } }),
			db,
			catalog,
			opts("IN"),
			{ deps: { post: fake.post, known: () => true } },
		),
	);
	await new Promise((r) => setTimeout(r, 5));
	assert.deepEqual(keys.sort(), [
		"phi:lb:apfc:v1:Test.Song.0",
		"phi:lb:board:v1:Test.Song.0:IN",
	]);
});

test("another level's missing rank keeps the card partial; the shown level still answers", async () => {
	const fake = fakePhib19();
	// phib19 answers the HD row with a shifted (unusable) row
	const post = async (path: string, raw: unknown) => {
		const res = await fake.post(path, raw);
		const data = (res.body as { data?: unknown } | null)?.data;
		if (path.endsWith("allAccRank") && Array.isArray(data)) {
			return {
				status: 200,
				body: {
					data: data.map((row: { rank: string }) =>
						row.rank === "HD" ? { ...row, songId: "Other.0" } : row,
					),
				},
			};
		}
		return res;
	};
	const { card, partial } = cardOf(
		await buildSongCard(
			runtime(),
			save({
				HD: { score: 999000, acc: 99.9, fc: true },
				IN: { score: 991234, acc: 99.25, fc: true },
			}),
			undefined,
			catalog,
			opts("IN"),
			{ deps: { post, known: () => true } },
		),
	);
	assert.equal(card.state.rank, "ok");
	assert.equal(card.overall?.rank, 2);
	assert.equal(card.levels.find((l) => l.level === "HD")?.place, null);
	assert.equal(partial, true);
});
