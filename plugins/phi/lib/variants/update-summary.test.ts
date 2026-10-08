import assert from "node:assert/strict";
import test from "node:test";
import type { Catalog } from "../catalog.ts";
import { fCompute } from "../fcompute.ts";
import type { UpdateBox, UpdateTile } from "../history.ts";
import type { PhiRuntime } from "../runtime.ts";
import { textEm } from "../text-fit.ts";
import {
	b30Movement,
	breakRichHtml,
	CARD_WIDTH,
	chartChanges,
	difficultyChip,
	fitPlayerName,
	fitTitle,
	fmtDelta,
	fmtScore,
	gainHeadline,
	groupByDay,
	linePoints,
	movementView,
	parseStamp,
	phiTitles,
	pickTopGains,
	regroup,
	rksBefore,
	sparkline,
	splitName,
	splitTitle,
	summaryView,
	syncBars,
	tileLevel,
	variant,
} from "./update-summary.ts";

function tile(
	song: string,
	opts: {
		rank?: string;
		level?: number;
		acc: number;
		accOld?: number;
		score: number;
		scoreOld?: number;
	},
): UpdateTile {
	const level = opts.level ?? 15;
	return {
		song,
		rank: opts.rank ?? "IN",
		illustration: `/ill/${song}.png`,
		Rating: fCompute.rate(opts.score, false),
		acc_new: opts.acc,
		acc_old: opts.accOld,
		score_new: opts.score,
		score_old: opts.scoreOld,
		date_new: new Date("2026-09-21T01:00:00Z"),
		rks_new: fCompute.rks(opts.acc, level),
		rks_old: opts.accOld == null ? 0 : fCompute.rks(opts.accOld, level),
	};
}

function box(
	song: UpdateTile[],
	date?: string,
	update_num?: number,
): UpdateBox {
	return { date, color: "#fff", song, width: 0, update_num };
}

const lookup = {
	idgetsong: (id: string) => ({ "a.0": "Song A", "b.0": "Song B" })[id],
	getill: (id: string) => `/ill/${id}.png`,
	raw: (id: string) =>
		id === "a.0"
			? { song: "Song A", chart: { IN: { difficulty: 15.8 } } }
			: undefined,
};

test("titles shrink, then wrap to two lines, then ellipsize", () => {
	const short = fitTitle("Stasis", 206, { max: 17, min: 13, wrap: 15 });
	assert.deepEqual(short, { px: 17, lines: ["Stasis"] });

	const two = fitTitle(
		"A Very Long Song Title That Definitely Needs Two Lines",
		206,
		{ max: 17, min: 13, wrap: 15 },
	);
	assert.equal(two.lines.length, 2);
	assert.ok(two.px >= 13 && two.px <= 15);
	for (const line of two.lines) assert.ok(textEm(line) * two.px <= 206);

	const cut = fitTitle("Word ".repeat(40), 206, { max: 17, min: 13, wrap: 15 });
	assert.equal(cut.px, 13);
	assert.equal(cut.lines.length, 2);
	assert.ok(cut.lines[1]!.endsWith("…"));
	for (const line of cut.lines) assert.ok(textEm(line) * 13 <= 206);

	// Below the wrap size a second line wins over shrinking further: CJK titles
	// split between characters, not at a lone space near the start
	assert.deepEqual(
		fitTitle("祈 -我ら神祖と共に歩む者なり-", 206, {
			max: 17,
			min: 13,
			wrap: 15,
		}),
		{ px: 15, lines: ["祈 -我ら神祖と", "共に歩む者なり-"] },
	);
	// At or above the wrap size the title stays on one line
	const stays = fitTitle("Retribution ~ Cycle of Redemption ~", 244, {
		max: 15,
		min: 12,
		wrap: 13,
	});
	assert.equal(stays.lines.length, 1);
	assert.ok(stays.px >= 13);

	const one = fitTitle("DESTRUCTION 3,2,1 (very extended remix)", 100, {
		max: 13,
		min: 11,
		wrap: 11,
		lines: 1,
	});
	assert.equal(one.lines.length, 1);
	assert.ok(one.lines[0]!.endsWith("…"));
});

test("player names keep rich text and fit the header box", () => {
	const rich = fitPlayerName('<span style="color:#f00">Red</span><b>Bold</b>');
	assert.equal(rich.html, '<span style="color:#f00">Red</span><b>Bold</b>');
	assert.equal(rich.px, 38);

	const long = fitPlayerName(
		"Extraordinarily Long Player Name Number Two 2026",
	);
	assert.ok(long.html.includes("<br>"));
	assert.ok(long.px >= 16 && long.px <= 26);

	assert.equal(fitPlayerName("a&lt;b").html, "a&lt;b");
	assert.equal(fitPlayerName("").html, "—");

	// A long rich name wraps too, keeping its tags on both lines
	const richLong = fitPlayerName(
		'<span style="color:#ffb3d9">MMMMMMMMMMMM</span><b>WWWWWWWWWWWWWWWWWW</b>',
	);
	assert.ok(richLong.px >= 22, `px ${richLong.px}`);
	const [l1, l2] = richLong.html.split("<br>");
	assert.ok(l1 && l2);
	assert.match(l1!, /^<span style="color:#ffb3d9">M{12}<\/span><b>W+<\/b>$/);
	assert.match(l2!, /^<b>W+<\/b>$/);
	assert.equal(
		richLong.html.replace(/<[^>]*>/g, ""),
		`${"M".repeat(12)}${"W".repeat(18)}`,
	);
});

test("titles split at spaces, or between CJK characters when that balances better", () => {
	assert.deepEqual(splitTitle("PRAGMATISM -RESURRECTION-"), [
		"PRAGMATISM",
		"-RESURRECTION-",
	]);
	assert.deepEqual(splitTitle("祈 -我ら神祖と共に歩む者なり-"), [
		"祈 -我ら神祖と",
		"共に歩む者なり-",
	]);
	// No cut right before closing punctuation or next to a dash
	const [head, tail] = splitTitle("雪降り、メリクリ雪降り、メリクリ");
	assert.ok(
		!/^[、ー]/.test(tail) && head + tail === "雪降り、メリクリ雪降り、メリクリ",
	);
	assert.equal(splitTitle("Stasis").join(""), "Stasis");
});

test("names without spaces wrap at separators and case or script changes", () => {
	assert.deepEqual(splitName("さくらExtraordinarily_Long_Player_Name2026"), [
		"さくらExtraordinarily_",
		"Long_Player_Name2026",
	]);
	assert.deepEqual(splitName("VeryLongPlayerNameWithCamelCaseParts"), [
		"VeryLongPlayerName",
		"WithCamelCaseParts",
	]);
	assert.deepEqual(splitName("ExtraordinarilyLongPlayerNameHere"), [
		"ExtraordinarilyLong",
		"PlayerNameHere",
	]);
	assert.deepEqual(splitName("漢字のなまえですsuperlongplayername"), [
		"漢字のなまえです",
		"superlongplayername",
	]);
	assert.equal(
		fitPlayerName("ExtraordinarilyLongPlayerNameHereAndMore").html,
		"ExtraordinarilyLong<br>PlayerNameHereAndMore",
	);
	assert.deepEqual(splitName("Two Words"), ["Two", "Words"]);
	// No natural break near the middle: the balanced plain cut wins
	const [head, tail] = splitName("abcdefghijklmnopqrstuvwxyzA");
	assert.equal(head + tail, "abcdefghijklmnopqrstuvwxyzA");
	assert.ok(Math.abs(head.length - tail.length) <= 2);

	const rich = fitPlayerName(
		'<span style="color:#ffb3d9">さくら</span><b>Extraordinarily_Long_Player_Name</b><i>2026</i>',
	);
	assert.equal(
		rich.html,
		'<span style="color:#ffb3d9">さくら</span><b>Extraordinarily_</b><br><b>Long_Player_Name</b><i>2026</i>',
	);
});

test("rich text breaks close and reopen the tags around the cut", () => {
	assert.equal(
		breakRichHtml('<span style="color:red">ab cd</span>', 2, 3),
		'<span style="color:red">ab</span><br><span style="color:red">cd</span>',
	);
	// Entities count as one character; tags closed before the cut stay closed
	assert.equal(breakRichHtml("<i>x</i>a&amp;b", 2), "<i>x</i>a<br>&amp;b");
	assert.equal(breakRichHtml("abc<br/>d", 1), "a<br>bc<br/>d");
});

test("chart constants are recovered from rks and acc", () => {
	for (const acc of [100, 99.4321, 97.25, 70.5]) {
		const t = tile("x", { acc, score: 990000, level: 16.4 });
		assert.equal(tileLevel(t), 16.4);
	}
	assert.equal(tileLevel(tile("x", { acc: 60, score: 500000 })), undefined);
	assert.deepEqual(difficultyChip("IN", 16.4), {
		rank: "IN",
		cls: "IN",
		level: "16.4",
	});
	assert.equal(difficultyChip("LEGACY").cls, "LEGACY");
	assert.equal(difficultyChip("??").cls, "AT");
});

test("number formatting", () => {
	assert.equal(fmtDelta(0.12345), "+0.1235");
	assert.equal(fmtDelta(-0.004), "-0.0040");
	assert.equal(fmtDelta(0.00001), "±0.0000");
	assert.equal(fmtScore(999468), "0999468");
	assert.equal(fmtScore(1_000_000), "1000000");
	assert.equal(fmtScore(undefined), "—");
});

test("box_line rows regroup by sync and merge by day", () => {
	const a = tile("A", { acc: 99, accOld: 98, score: 990000, scoreOld: 980000 });
	const b = tile("B", { acc: 98, accOld: 97, score: 980000, scoreOld: 970000 });
	const c = tile("C", { acc: 97, score: 970000 });
	const d = tile("D", { acc: 96, accOld: 95, score: 960000, scoreOld: 950000 });
	// Group 1 continues on the next row (no date on the second box), then two
	// syncs on the same day
	const lines = [
		[box([a, b], "2026/09/21 10:00:00")],
		[box([c], undefined, 12), box([d], "2026/09/20 22:00:00", 1)],
		[box([tile("E", { acc: 99, score: 990000 })], "2026/09/20 08:00:00", 1)],
	];
	const syncs = regroup(lines);
	assert.deepEqual(
		syncs.map((g) => [g.date, g.total, g.tiles.length]),
		[
			["2026/09/21 10:00:00", 12, 3],
			["2026/09/20 22:00:00", 1, 1],
			["2026/09/20 08:00:00", 1, 1],
		],
	);
	const days = groupByDay(syncs);
	assert.deepEqual(
		days.map((g) => [g.day, g.total, g.tiles.map((t) => t.song)]),
		[
			["2026/09/21", 12, ["A", "B", "C"]],
			["2026/09/20", 2, ["E", "D"]],
		],
	);
	assert.deepEqual(regroup(null), []);
	assert.deepEqual(regroup([[null, { song: null }]]), [
		{ date: "", total: 0, tiles: [] },
	]);
});

test("one change per chart over the period, ranked by rks gain", () => {
	const newer = tile("A", {
		acc: 99.5,
		accOld: 99,
		score: 995000,
		scoreOld: 990000,
	});
	const older = tile("A", {
		acc: 99,
		accOld: 97,
		score: 990000,
		scoreOld: 970000,
	});
	const phi = tile("P", {
		acc: 100,
		accOld: 99.8,
		score: 1_000_000,
		scoreOld: 998000,
	});
	const first = tile("F", { acc: 98, score: 980000, level: 16 });
	const changes = chartChanges([
		{ date: "d2", total: 2, tiles: [newer, phi] },
		{ date: "d1", total: 2, tiles: [older, first] },
	]);
	const a = changes.find((c) => c.newest.song === "A")!;
	assert.equal(a.oldest, older);
	assert.ok(Math.abs(a.rksDelta - (newer.rks_new - older.rks_old)) < 1e-12);
	assert.equal(a.scoreDelta, 25000);
	assert.equal(changes.find((c) => c.newest.song === "P")!.newPhi, true);
	assert.equal(changes.find((c) => c.newest.song === "F")!.hasPrev, false);

	// Two improvements: a first record fills the third slot
	const few = pickTopGains(changes);
	// A: 97% → 99.5% (+1.60 rks) beats P: 99.8% → φ (+0.13 rks)
	assert.deepEqual(
		few.top.map((c) => c.newest.song),
		["A", "P", "F"],
	);
	assert.equal(few.best?.newest.song, "A");

	// Four or five candidates show three; six or more show six
	const many = (n: number) =>
		chartChanges([
			{
				date: "d",
				total: n,
				tiles: Array.from({ length: n }, (_, i) =>
					tile(`S${i}`, {
						acc: 99 - i * 0.1,
						accOld: 97,
						score: 990000,
						scoreOld: 970000,
					}),
				),
			},
		]);
	assert.equal(pickTopGains(many(5)).top.length, 3);
	assert.equal(pickTopGains(many(9)).top.length, 6);
	assert.equal(pickTopGains(many(9)).top[0]!.newest.song, "S0");
	assert.equal(pickTopGains([]).best, undefined);
});

test("B30 movement compares the last two snapshots", () => {
	assert.equal(b30Movement([], lookup).state, "single");
	const base = { t: Date.UTC(2026, 8, 20), rks: 16, phi: [], b27: [] };
	const same = b30Movement(
		[
			{ ...base, b27: [{ id: "a.0", rank: "IN" }] },
			{ ...base, t: base.t + 1, b27: [{ id: "a.0", rank: "IN" }] },
		],
		lookup,
	);
	assert.equal(same.state, "same");
	const moved = b30Movement(
		[
			{ t: 1, b27: [{ id: "b.0", rank: "HD" }] },
			{
				...base,
				b27: [
					{ id: "a.0", rank: "IN" },
					{ id: "c.0", rank: "LEGACY" },
				],
			},
			{
				...base,
				t: base.t + 86_400_000,
				b27: [
					{ id: "b.0", rank: "HD" },
					{ id: "a.0", rank: "IN" },
				],
			},
		],
		lookup,
	);
	assert.equal(moved.state, "changed");
	if (moved.state !== "changed") return;
	assert.deepEqual(
		moved.entered.map((m) => [
			m.title.lines[0],
			m.chip.rank,
			m.chip.level,
			m.ill,
		]),
		[["Song B", "HD", "", "/ill/b.0.png"]],
	);
	assert.deepEqual(
		moved.left.map((m) => [m.title.lines[0], m.chip.cls]),
		[["c", "LEGACY"]],
	);
	assert.equal(moved.from, "2026/09/20 08:00");
	assert.equal(moved.to, "2026/09/21 08:00");

	const en = summaryView(cardData(), "en", lookup).vt;
	const split = movementView(moved, en);
	assert.equal(split.layout, "split");
	assert.deepEqual(
		split.sides.map((s) => [s.dir, s.count, s.rows.length, s.aside]),
		[
			["in", "1", 1, ""],
			["out", "1", 1, ""],
		],
	);
	// Nothing left the B30: one full-width side, the other as a muted note
	const solo = movementView(
		b30Movement(
			[
				{ ...base, b27: [] },
				{ ...base, t: base.t + 1, b27: [{ id: "a.0", rank: "IN" }] },
			],
			lookup,
		),
		en,
	);
	assert.equal(solo.layout, "solo");
	assert.deepEqual(
		solo.sides.map((s) => [s.dir, s.count, s.aside]),
		[["in", "1", "Left B30 · None"]],
	);
	const single = movementView(b30Movement([], lookup), en);
	assert.deepEqual(
		[single.state, single.sides, single.note],
		["single", [], en.movementSingle],
	);
});

test("rks line vertices and sparkline come from the percent segments", () => {
	const segs = [
		[0, 0, 50, 40],
		[50, 40, 100, 100],
	];
	const pts = linePoints(segs);
	assert.deepEqual(pts, [
		{ x: 0, y: 0 },
		{ x: 50, y: 40 },
		{ x: 100, y: 100 },
	]);
	// Whole line in the period: it spans the box, no lead-in
	const svg = sparkline(pts);
	assert.match(svg, /^<svg [^>]*width="143" height="30"/);
	assert.match(
		svg,
		/d="M5\.00 25\.00 L71\.50 17\.00 L138\.00 5\.00" fill="none"/,
	);
	assert.doesNotMatch(svg, /stroke-dasharray/);
	// Period from vertex 1: vertex 0 becomes a dimmed lead-in on the first 20%,
	// the period fills the rest, y spans only the plotted values
	const from = sparkline(pts, 1);
	assert.match(
		from,
		/d="M5\.00 25\.00 L31\.60 17\.00" fill="none"[^>]*stroke-opacity/,
	);
	assert.match(from, /d="M31\.60 0 L31\.60 30"[^>]*stroke-dasharray/);
	assert.match(from, /d="M31\.60 17\.00 L138\.00 5\.00" fill="none"/);
	// Nothing recorded after the period began: flat to the end
	assert.match(
		sparkline(pts, 2),
		/d="M31\.60 5\.00 L138\.00 5\.00" fill="none"/,
	);
	// A flat line sits in the middle
	assert.match(
		sparkline(linePoints([[0, 50, 100, 50]])),
		/d="M5\.00 15\.00 L138\.00 15\.00" fill="none"/,
	);
	assert.equal(sparkline([]), "");
	assert.equal(sparkline(linePoints([[1, 2]])), "");
	assert.deepEqual(linePoints("x"), []);
});

test("records per sync become bars, oldest first, latest highlighted", () => {
	const svg = syncBars([16, 15, 15, 15, 8]);
	const bars = [
		...svg.matchAll(
			/<path d="M([\d.]+) ([\d.]+) [^"]*" fill="#62d2ff" fill-opacity="([\d.]+)"/g,
		),
	];
	assert.equal(bars.length, 5);
	// Oldest (8) on the left, newest (16, full height) on the right at full strength
	assert.deepEqual(
		bars.map((b) => b[3]),
		["0.45", "0.45", "0.45", "0.45", "1"],
	);
	assert.ok(Number(bars[0]![2]) > Number(bars[4]![2]));
	assert.equal(bars[4]![2], "2.00");
	// Bars stay thin with few syncs
	assert.equal(bars[1]![1], "19.50");
	assert.equal(syncBars([3]), "");
	assert.equal(syncBars([]), "");
	assert.equal(
		[...syncBars(Array.from({ length: 50 }, () => 1)).matchAll(/fill-opacity/g)]
			.length,
		30,
	);
});

test("RKS at the start of the period is the last record before it", () => {
	assert.equal(
		parseStamp("2026/09/09 00:00:30"),
		Date.UTC(2026, 8, 9, 0, 0, 30),
	);
	assert.equal(parseStamp("2026/09/09"), Date.UTC(2026, 8, 9));
	assert.equal(parseStamp(""), undefined);
	// Records on 09/01, 09/06, 09/09 and 09/11 at 16.0, 16.4, 16.6 and 17.0
	const pts = linePoints([
		[0, 0, 50, 40],
		[50, 40, 80, 60],
		[80, 60, 100, 100],
	]);
	const range = [16, 17];
	const dates = ["2026/09/01 00:00:00", "2026/09/11 00:00:00"];
	const at = (stamp?: string) =>
		rksBefore(pts, range, dates, stamp ? parseStamp(stamp) : undefined);
	assert.deepEqual(at("2026/09/10 00:00:00"), { value: 16.6, idx: 2 });
	// The record written by the period's own first sync is not "before" it
	assert.equal(at("2026/09/09 00:00:30")?.idx, 1);
	assert.ok(Math.abs(at("2026/09/09 00:00:30")!.value - 16.4) < 1e-9);
	// Period older than the line, or no period: the first record
	assert.deepEqual(at("2026/08/01 00:00:00"), { value: 16, idx: 0 });
	assert.deepEqual(at(), { value: 16, idx: 0 });
	assert.equal(rksBefore([], range, dates, 0), undefined);
	assert.equal(rksBefore(pts, [], dates, 0), undefined);
});

function cardData(overrides: Record<string, unknown> = {}) {
	const today = [
		tile("Big", {
			acc: 99.9,
			accOld: 98,
			score: 999000,
			scoreOld: 980000,
			level: 16,
		}),
		tile("Phi", {
			acc: 100,
			accOld: 99.5,
			score: 1_000_000,
			scoreOld: 995000,
			level: 15,
		}),
		tile("Mid", {
			acc: 99,
			accOld: 98.9,
			score: 990000,
			scoreOld: 989000,
			level: 14,
		}),
		tile("Small", {
			acc: 98,
			accOld: 97.9,
			score: 980000,
			scoreOld: 979000,
			level: 13,
		}),
	];
	return {
		PlayerId: "Tester",
		Rks: "16.5614",
		Date: "2026/09/21 09:54:58",
		ChallengeMode: 3,
		ChallengeModeRank: 51,
		added_rks_notes: ["+0.0123", ""],
		rks_history: [[0, 0, 100, 100]],
		rks_range: [16.3414, 16.5614],
		rks_date: ["2026/08/19 09:52:47", "2026/09/21 09:52:47"],
		box_line: [[box(today, "2026/09/21 09:52:47", 7)]],
		task_data: null,
		hisb30Snaps: [],
		...overrides,
	};
}

test("summary view: header, KPIs, gains and the remaining list", () => {
	const v = summaryView(cardData(), "en", lookup);
	assert.equal(v.empty, false);
	assert.equal(v.rks, "16.5614");
	assert.equal(v.delta, "+0.0123");
	assert.equal(v.deltaCls, "up");
	assert.deepEqual(v.challenge, { mode: 3, rank: "51" });
	// The only sync is the period; the line's first record precedes it
	assert.deepEqual(v.period, {
		range: "2026/09/21",
		meta: "1 day with updates",
	});
	assert.equal(v.kpi.rks, "+0.2200");
	assert.equal(v.kpi.rksCls, "accent");
	assert.equal(v.kpi.rksSub, "16.3414 → 16.5614");
	assert.ok(v.kpi.spark.startsWith("<svg"));
	// update_num 7: 4 listed + 3 hidden by the per-sync cap
	assert.equal(v.kpi.records, "7");
	assert.equal(v.kpi.recordsSub, "in 1 sync");
	assert.equal(v.kpi.phi, "1");
	assert.equal(v.kpi.phiSub, "Among listed updates");
	assert.deepEqual(
		v.kpi.phiList.map((p) => [p.title.lines[0], p.more]),
		[["Phi", ""]],
	);
	// One sync: no bars to compare
	assert.equal(v.kpi.bars, "");
	// update_num 7 > 4 listed: top gains only rank what is listed
	assert.equal(v.gainsMeta, "Ranked by RKS gain · listed updates");
	assert.equal(v.kpi.best, v.gains[0]!.gain);
	assert.equal(v.kpi.bestCls, "accent");
	assert.equal(v.kpi.bestLabel, "BEST GAIN");
	assert.equal(v.gainsLayout, "grid");
	// 4 improvements → 3 feature tiles, the 4th stays in the list
	assert.equal(v.gains.length, 3);
	assert.deepEqual(
		v.gains.map((g) => g.title.lines[0]),
		["Big", "Phi", "Mid"],
	);
	assert.equal(v.gains[1]!.phi, true);
	assert.equal(v.gains[0]!.scoreOld, "0980000");
	assert.equal(v.gains[0]!.chip.level, "16.0");
	assert.equal(v.listTitle, "OTHER UPDATES");
	assert.equal(v.groups.length, 1);
	assert.equal(v.groups[0]!.day, "2026/09/21");
	assert.equal(v.groups[0]!.count, "7 updates");
	assert.deepEqual(
		v.groups[0]!.rows.map((r) => [r.title.lines[0], r.deltaCls, r.phi]),
		[["Small", "up", false]],
	);
	assert.equal(v.groups[0]!.more, "+3 lower updates not shown");
	assert.equal(v.listCols, true);
	assert.equal(v.movement.state, "single");
	assert.ok(v.showMovement);
	assert.equal(v.lc, "en");
});

test("summary view: the KPI RKS change agrees with the header RKS", () => {
	// Line ends at 16.6 (e.g. an A→B→A history collapsed upstream) but the save says 16.5
	const v = summaryView(
		cardData({
			Rks: "16.5000",
			rks_history: [[0, 0, 100, 100]],
			rks_range: [16.4, 16.6],
		}),
		"en",
		lookup,
	);
	assert.equal(v.kpi.rks, "+0.1000");
	assert.equal(v.kpi.rksSub, "16.4000 → 16.5000");
});

test("summary view: fewer than 3 gains, first records and score-only gains", () => {
	const first = tile("New", { acc: 99, score: 990000, level: 16 });
	const scoreUp = tile("Combo", {
		acc: 98,
		accOld: 98,
		score: 985000,
		scoreOld: 980000,
	});
	const v = summaryView(
		cardData({ box_line: [[box([scoreUp, first], "2026/09/21 09:52:47", 2)]] }),
		"en",
		lookup,
	);
	assert.equal(v.gainsLayout, "wide");
	assert.deepEqual(
		v.gains.map((g) => [g.title.lines[0], g.gain, g.gainLabel, g.first]),
		[
			["Combo", "+5000", "SCORE", false],
			["New", fCompute.rks(99, 16).toFixed(4), "First record", true],
		],
	);
	// First records have no "before" values to point from
	assert.deepEqual(
		[v.gains[1]!.rksOld, v.gains[1]!.accOld, v.gains[1]!.scoreOld],
		["", "", ""],
	);
	assert.equal(v.gains[0]!.rksOld, v.gains[0]!.rksNew);
	assert.equal(v.kpi.best, "+5000");
	assert.equal(v.kpi.bestLabel, "BEST SCORE GAIN");
	assert.equal(v.kpi.phi, "0");
	assert.equal(v.kpi.phiSub, "None this period");
	assert.deepEqual(v.kpi.phiList, []);
	// Nothing is hidden: no "listed updates" caveat on the gains heading
	assert.equal(v.gainsMeta, "Ranked by RKS gain");
	// Both charts are feature tiles: no list rows, so no column headings
	assert.equal(v.groups.length, 0);
	assert.equal(v.listCols, false);

	const firstsOnly = summaryView(
		cardData({ box_line: [[box([first], "2026/09/21 09:52:47", 3)]] }),
		"zh",
		lookup,
	);
	assert.equal(firstsOnly.kpi.best, "—");
	assert.equal(firstsOnly.kpi.bestCls, "flat");
	assert.equal(firstsOnly.vt.cmpAcc, firstsOnly.vt.colAcc);
	assert.equal(firstsOnly.lc, "zh");
	assert.equal(firstsOnly.groups.length, 1);
	assert.equal(firstsOnly.groups[0]!.rows.length, 0);
	assert.equal(firstsOnly.listCols, false);

	const vt = summaryView(cardData(), "en", lookup).vt;
	const flatRks = chartChanges([
		{
			date: "d",
			total: 1,
			tiles: [
				tile("Low", { acc: 69, accOld: 60, score: 700000, scoreOld: 600000 }),
			],
		},
	])[0]!;
	assert.deepEqual(gainHeadline(flatRks, vt), {
		gain: "+100000",
		label: "SCORE",
	});
});

test("summary view: sparse, negative and empty states", () => {
	// No rks line: the last snapshot before the period's first sync (09/21 09:52
	// Shanghai time) is the starting point; the one after it is not
	const neg = summaryView(
		cardData({
			Rks: "16.5000",
			added_rks_notes: ["-0.0042", ""],
			ChallengeModeRank: 0,
			rks_history: [],
			hisb30Snaps: [
				{ t: Date.UTC(2026, 8, 1), rks: 16.6, phi: [], b27: [] },
				{ t: Date.UTC(2026, 8, 21, 2), rks: 16.5, phi: [], b27: [] },
			],
		}),
		"zh",
		lookup,
	);
	assert.equal(neg.deltaCls, "down");
	assert.equal(neg.challenge, null);
	assert.equal(neg.kpi.rks, "-0.1000");
	assert.equal(neg.kpi.rksCls, "down");
	assert.equal(neg.kpi.spark, "");
	assert.equal(neg.kpi.rksSub, "16.6000 → 16.5000");
	assert.equal(neg.movement.state, "same");
	assert.equal(neg.vt.gains, "提升最多");
	assert.equal(neg.kpi.recordsSub, "共 1 次同步");

	const empty = summaryView(
		cardData({ box_line: [], added_rks_notes: ["", ""], rks_history: [] }),
		"en",
		lookup,
	);
	assert.equal(empty.empty, true);
	assert.equal(empty.delta, "");
	assert.equal(empty.gains.length, 0);
	assert.equal(empty.groups.length, 0);
	assert.equal(empty.showMovement, false);
	assert.equal(empty.emptyMoved, false);
	assert.equal(empty.kpi.rks, "—");
	assert.equal(empty.period.range, "");
	assert.deepEqual(empty.emptyLines, [
		"Play a few charts and sync your save —",
		"your new records will show up here.",
	]);

	// Garbage in: no throw, sensible fallbacks
	const junk = summaryView(
		{ box_line: "x", Rks: undefined, hisb30Snaps: [{ t: 1e20 }, { t: "x" }] },
		"en",
		lookup,
	);
	assert.equal(junk.rks, "—");
	assert.equal(junk.empty, true);
});

test("summary view: new φ titles, list φ rows and per-sync bars", () => {
	const phi = (song: string, level: number) =>
		tile(song, {
			acc: 100,
			accOld: 99.5,
			score: 1_000_000,
			scoreOld: 995000,
			level,
		});
	const firstPhi = tile("FirstPhi", { acc: 100, score: 1_000_000, level: 12 });
	const plain = tile("Plain", {
		acc: 98,
		accOld: 97,
		score: 980000,
		scoreOld: 970000,
	});
	const v = summaryView(
		cardData({
			box_line: [
				[
					box(
						[phi("P15", 15), phi("P16", 16), plain],
						"2026/09/21 09:52:47",
						3,
					),
				],
				[box([phi("P14", 14), firstPhi], "2026/09/20 09:52:47", 2)],
			],
		}),
		"en",
		lookup,
	);
	// Four charts reached φ: the two with the highest RKS, then "+2"
	assert.equal(v.kpi.phi, "4");
	assert.deepEqual(
		v.kpi.phiList.map((p) => [p.title.lines[0], p.more]),
		[
			["P16", ""],
			["P15", "+2"],
		],
	);
	assert.equal(v.kpi.phiSub, "Score 1000000 reached");
	assert.ok(v.kpi.bars.startsWith("<svg"));
	// Plain, P16 and P15 are feature tiles; the list marks its φ rows, a first
	// record at 1000000 included
	assert.deepEqual(
		v.gains.map((g) => g.title.lines[0]),
		["Plain", "P16", "P15"],
	);
	const rows = v.groups.flatMap((g) => g.rows);
	assert.deepEqual(
		rows.map((r) => [r.title.lines[0], r.phi, r.deltaCls]),
		[
			["P14", true, "up"],
			["FirstPhi", true, "new"],
		],
	);

	// A long title next to "+N" still fits its column
	const many = phiTitles(
		chartChanges([
			{
				date: "d",
				total: 3,
				tiles: [
					phi("An Extraordinarily Long Song Title For The Tile", 16),
					phi("Another Extraordinarily Long Song Title", 15),
					phi("C", 14),
				],
			},
		]),
	);
	assert.equal(many[1]!.more, "+1");
	assert.ok(many[1]!.title.lines[0]!.endsWith("…"));
	assert.ok(textEm(many[1]!.title.lines[0]!) * many[1]!.title.px <= 131);
});

test("summary view: empty history whose B30 still moved", () => {
	const v = summaryView(
		cardData({
			box_line: [],
			hisb30Snaps: [
				{ t: 1, phi: [], b27: [{ id: "b.0", rank: "HD" }] },
				{ t: 2, phi: [], b27: [{ id: "a.0", rank: "IN" }] },
			],
		}),
		"zh",
		lookup,
	);
	assert.equal(v.empty, true);
	assert.equal(v.showMovement, true);
	assert.equal(v.emptyMoved, true);
	assert.deepEqual(v.emptyLines, [v.vt.emptyMoved]);
	assert.equal(v.movement.layout, "split");
	assert.equal(v.kpi.phiSub, "本期暂无");
});

test("prepare keeps the card data and resolves songs through the runtime", async () => {
	assert.equal(variant.tpl, "update-summary");
	assert.equal(variant.width, CARD_WIDTH);
	const data = cardData({
		hisb30Snaps: [
			{ t: 1, phi: [], b27: [] },
			{ t: 2, phi: [{ id: "a.0", rank: "IN" }], b27: [] },
		],
	});
	const out = (await variant.prepare!(data, {
		kind: "hisb30",
		locale: "en",
		catalog: {} as Catalog,
		rt: { getInfo: lookup } as unknown as PhiRuntime,
	})) as typeof data & { us: ReturnType<typeof summaryView> };
	assert.equal(out.Rks, "16.5614");
	assert.equal(out.us.movement.state, "changed");
	const row = out.us.movement.sides[0]!.rows[0]!;
	assert.equal(row.title.lines[0], "Song A");
	assert.equal(row.chip.level, "15.8");
});
