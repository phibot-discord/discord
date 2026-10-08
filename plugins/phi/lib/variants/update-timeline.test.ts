import assert from "node:assert/strict";
import test from "node:test";
import { textEm } from "../text-fit.ts";
import {
	buildTimeline,
	type ConstLookup,
	chartOf,
	clipEm,
	defaultConstLookup,
	fitTitle,
	groupDays,
	nameFontPx,
	numEm,
	regroupBoxLine,
	richTextLines,
	splitRichLines,
	variant,
} from "./update-timeline.ts";

const ILL = "/x/original_ill/illLow";

function tile(song: string, over: Record<string, unknown> = {}) {
	return {
		song,
		rank: "IN",
		illustration: `${ILL}/${song.replace(/\W/g, "")}.Artist.png`,
		Rating: "V",
		acc_new: 99.5,
		acc_old: 98.7,
		score_new: 985000,
		score_old: 976000,
		date_new: new Date("2026-09-21T01:52:47Z"),
		rks_new: 15.2,
		rks_old: 14.6,
		...over,
	};
}

/** box_line as packUpdateRows builds it: 5 tiles per row, dates split across rows */
function boxLine() {
	const a = Array.from({ length: 7 }, (_, i) => tile(`A${i}`));
	const b = [tile("B0"), tile("B1")];
	const c = [tile("C0")];
	return [
		[
			{
				date: "2026/09/21 20:10:00",
				color: "#111",
				song: a.slice(0, 5),
				width: 0,
			},
		],
		[
			{ color: "#111", song: a.slice(5), width: 0, update_num: 12 },
			{
				date: "2026/09/21 09:52:47",
				color: "#222",
				song: b,
				width: 0,
				update_num: 2,
			},
			{
				date: "2026/09/18 08:00:00",
				color: "#333",
				song: c,
				width: 0,
				update_num: 1,
			},
		],
	];
}

const noConst: ConstLookup = () => undefined;
const MINUS = "\u2212";

function baseData(over: Record<string, unknown> = {}) {
	return {
		PlayerId: "Player",
		Rks: "16.5614",
		Date: "2026/09/21 09:54:58",
		ChallengeMode: 3,
		ChallengeModeRank: 51,
		added_rks_notes: ["+0.0123", ""],
		box_line: boxLine(),
		task_data: null,
		task_time: "",
		rks_history: [
			[0, 0, 50, 40],
			[50, 40, 100, 100],
		],
		rks_range: [16.3, 16.6],
		rks_date: ["2026/08/19 09:52:47", "2026/09/21 09:52:47"],
		hisb30Snaps: [],
		...over,
	};
}

test("regroupBoxLine rejoins one upload split across packed rows", () => {
	const groups = regroupBoxLine(boxLine());
	assert.deepEqual(
		groups.map((g) => [g.stamp, g.tiles.length, g.updates]),
		[
			["2026/09/21 20:10:00", 7, 12],
			["2026/09/21 09:52:47", 2, 2],
			["2026/09/18 08:00:00", 1, 1],
		],
	);
	assert.deepEqual(regroupBoxLine(undefined), []);
	assert.deepEqual(regroupBoxLine([[{ song: "nope" }]]), [
		{ stamp: "", updates: 0, tiles: [] },
	]);
});

test("groupDays merges uploads from the same calendar day, newest first", () => {
	const days = groupDays(regroupBoxLine(boxLine()));
	assert.deepEqual(
		days.map((d) => [d.day, d.times, d.updates, d.tiles.length]),
		[
			["2026/09/21", ["20:10:00", "09:52:47"], 14, 9],
			["2026/09/18", ["08:00:00"], 1, 1],
		],
	);
});

test("day headers carry weekday, upload times and how many updates are shown", () => {
	const view = buildTimeline(baseData(), "en", noConst);
	const [first, second] = view.days;
	assert.equal(first?.weekday, "MON");
	assert.equal(first?.times, "20:10 · 09:52");
	assert.equal(first?.count, "14 updates");
	assert.equal(first?.shown, "top 9 shown");
	assert.equal(first?.latest, true);
	assert.equal(second?.weekday, "FRI");
	assert.equal(second?.times, "08:00", "HH:MM for a single upload too");
	assert.equal(second?.count, "1 update");
	assert.equal(second?.shown, "");
	assert.equal(view.total, "15 updates · 2 days");
	assert.equal(view.empty, false);
});

test("entries show before → after with signed deltas", () => {
	const data = baseData({
		box_line: [
			[
				{
					date: "2026/09/21 09:52:47",
					color: "#111",
					width: 0,
					update_num: 4,
					song: [
						tile("Up"),
						tile("Down", {
							score_old: 990000,
							acc_old: 99.6,
							rks_old: 15.3,
						}),
						tile("Fresh", {
							score_old: undefined,
							acc_old: undefined,
							rks_old: 0,
						}),
						tile("Phi", {
							score_new: 1000000,
							score_old: 1000000,
							acc_new: 100,
							acc_old: 100,
							rks_new: 0,
							rks_old: 0,
						}),
					],
				},
			],
		],
	});
	const [up, down, fresh, flat] = buildTimeline(data, "en", noConst).days[0]!
		.entries;
	assert.equal(up?.scoreLead, "0");
	assert.equal(up?.scoreMain, "985000");
	assert.equal(up?.scoreOld, "976000", "old score without the leading zero");
	assert.deepEqual(up?.scoreDelta, { text: "+9000", cls: "tl-up" });
	assert.equal(up?.acc, "99.5000%");
	assert.equal(up?.accOld, "98.7000");
	assert.deepEqual(up?.accDelta, { text: "+0.80%", cls: "tl-up" });
	assert.equal(up?.rks, "15.2000");
	assert.deepEqual(up?.rksDelta, { text: "+0.6000", cls: "tl-up" });
	assert.equal(up?.isNew, false);
	assert.equal(up?.scoreWasPx, 16, "typical values fit their boxes");
	assert.equal(up?.accWasPx, 16);

	assert.deepEqual(down?.scoreDelta, { text: `${MINUS}5000`, cls: "tl-down" });
	assert.deepEqual(down?.accDelta, { text: `${MINUS}0.10%`, cls: "tl-down" });
	assert.deepEqual(down?.rksDelta, {
		text: `${MINUS}0.1000`,
		cls: "tl-down",
	});

	assert.equal(fresh?.isNew, true);
	assert.equal(fresh?.scoreOld, "");
	assert.equal(fresh?.accOld, "");
	assert.equal(fresh?.scoreDelta.text, "");
	assert.equal(fresh?.rksDelta.text, "");

	assert.equal(flat?.scoreLead, "");
	assert.equal(flat?.scoreMain, "1000000");
	assert.deepEqual(flat?.scoreDelta, { text: "±0", cls: "tl-flat" });
	assert.deepEqual(flat?.accDelta, { text: "±0.00%", cls: "tl-flat" });
	assert.equal(flat?.rks, "", "unknown constant has no RKS");
	assert.equal(flat?.rksDelta.text, "");
});

function oneDay(song: unknown[]) {
	return baseData({
		box_line: [
			[
				{
					date: "2026/09/21 09:52:47",
					color: "#111",
					width: 0,
					update_num: song.length,
					song,
				},
			],
		],
	});
}

test("RKS: a real 0 still counts, the dash only means an unknown constant", () => {
	const lookup: ConstLookup = (id) =>
		id === "Unknown.Artist.0" ? undefined : 15.4;
	const data = oneDay([
		// The old record was below 70%: rks_old is 0, and that 0 is real
		tile("Climb", {
			Rating: "C",
			score_new: 712000,
			score_old: 600000,
			acc_new: 75.5,
			acc_old: 65.2,
			rks_new: 8.9,
			rks_old: 0,
		}),
		tile("Fail", {
			Rating: "F",
			score_new: 412345,
			score_old: 398765,
			acc_new: 61.23,
			acc_old: 58.1,
			rks_new: 0,
			rks_old: 0,
		}),
		tile("Unknown", { rks_new: 0, rks_old: 0 }),
	]);
	const [climb, fail, unknown] = buildTimeline(data, "en", lookup).days[0]!
		.entries;
	assert.equal(climb?.rks, "8.9000");
	assert.deepEqual(climb?.rksDelta, { text: "+8.9000", cls: "tl-up" });
	assert.deepEqual(climb?.accDelta, { text: "+10.30%", cls: "tl-up" });
	assert.equal(fail?.constText, "15.4");
	assert.equal(fail?.rks, "0.0000", "known constant below 70%");
	assert.equal(fail?.rksDelta.text, "");
	assert.equal(unknown?.rks, "", "unknown constant: dash");
	assert.equal(unknown?.rksDelta.text, "");
});

test("before lines keep 16px unless a value overflows its fixed box", () => {
	assert.ok(Math.abs(numEm("+9000") - 5 * 0.572) < 1e-9, "tabular digits");
	assert.ok(numEm("\u22120.10%") < numEm("+12.34%"));
	const [big] = buildTimeline(
		oneDay([
			tile("Big", {
				score_new: 712000,
				score_old: 600000,
				acc_new: 75.5,
				acc_old: 65.2,
			}),
		]),
		"en",
		noConst,
	).days[0]!.entries;
	assert.equal(big?.scoreDelta.text, "+112000");
	assert.ok(big!.scoreWasPx < 16 && big!.scoreWasPx >= 11);
	assert.ok(numEm("+112000") * big!.scoreWasPx <= 58, "fits the 58px box");
	assert.ok(numEm("+10.30%") * big!.accWasPx <= 60, "fits the 60px box");
});

test("accuracy changes are percentage points: 2 dp, 4 dp only when tiny", () => {
	const entries = buildTimeline(
		oneDay([
			tile("Tiny", { acc_new: 99.5012, acc_old: 99.5 }),
			tile("Same", { acc_new: 99.5, acc_old: 99.5 }),
			tile("Round", { acc_new: 99.5, acc_old: 99.3766 }),
		]),
		"en",
		noConst,
	).days[0]!.entries;
	assert.deepEqual(
		entries.map((e) => e.accDelta.text),
		["+0.0012%", "±0.00%", "+0.12%"],
	);
});

test("entries look up the chart constant and B30 membership by song id", () => {
	const seen: string[] = [];
	const lookup: ConstLookup = (id, rank) => {
		seen.push(`${id}|${rank}`);
		return id === "A0.Artist.0" ? 15.8 : undefined;
	};
	const view = buildTimeline(
		baseData({
			hisb30Snaps: [
				{ t: 1, rks: 16, phi: [], b27: [{ id: "A1.Artist.0", rank: "IN" }] },
				{
					t: 2,
					rks: 16.1,
					phi: [{ id: "A0.Artist.0", rank: "IN" }],
					b27: [{ id: "A2.Artist.0", rank: "AT" }],
				},
			],
		}),
		"en",
		lookup,
	);
	const [a0, a1, a2] = view.days[0]!.entries;
	assert.equal(seen[0], "A0.Artist.0|IN");
	assert.equal(a0?.constText, "15.8");
	assert.equal(a1?.constText, "");
	assert.equal(a0?.inB30, true, "listed in the newest snapshot");
	assert.equal(a1?.inB30, false, "only in an older snapshot");
	assert.equal(a2?.inB30, false, "same song, other difficulty");
	assert.equal(a0?.rankCls, "tl-r-in");
	assert.equal(a0?.grade, "V");
});

test("defaultConstLookup reads the catalog by id, else by song title", () => {
	const rows: Record<
		string,
		{ chart: Record<string, { difficulty: number }> }
	> = {
		"Stasis.Maozon.0": { chart: { IN: { difficulty: 15.3 } } },
		"Other.Artist.0": { chart: { AT: { difficulty: 16.1 } } },
	};
	const lookup = defaultConstLookup({
		raw: ((id: string) => rows[id]) as never,
		SongGetId: ((song: string) =>
			song === "Other" ? "Other.Artist.0" : undefined) as never,
	});
	assert.equal(lookup("Stasis.Maozon.0", "IN", "Stasis"), 15.3);
	assert.equal(lookup("Stasis.Maozon.0", "AT", "Stasis"), undefined);
	assert.equal(lookup("", "AT", "Other"), 16.1);
	assert.equal(lookup("Gone.X.0", "AT", "Other"), 16.1);
	assert.equal(lookup("", "AT", "Unknown"), undefined);
});

test("difficulty classes cover LEGACY and unknown ranks; unknown grades are dropped", () => {
	const view = buildTimeline(
		baseData({
			box_line: [
				[
					{
						date: "2026/09/21 09:52:47",
						color: "#111",
						width: 0,
						song: [
							tile("L", { rank: "LEGACY", Rating: "phi" }),
							tile("Q", { rank: "SP", Rating: "??" }),
							tile("Z", { Rating: "NEW", score_new: 0 }),
						],
					},
				],
			],
		}),
		"en",
		noConst,
	);
	const [legacy, odd, unplayed] = view.days[0]!.entries;
	assert.equal(legacy?.rankCls, "tl-r-legacy");
	assert.equal(legacy?.grade, "phi");
	assert.equal(odd?.rankCls, "tl-r-unknown");
	assert.equal(odd?.grade, "");
	assert.equal(unplayed?.grade, "", "score 0 rates NEW: no grade icon");
});

test("header: RKS delta colour, challenge badge hidden at rank 0", () => {
	const up = buildTimeline(baseData(), "en", noConst);
	assert.equal(up.rks, "16.5614");
	assert.deepEqual(up.rksDelta, { text: "+0.0123", cls: "tl-gold" });
	assert.deepEqual(up.challenge, { mode: 3, rank: 51 });

	const down = buildTimeline(
		baseData({
			added_rks_notes: ["-0.0050", ""],
			ChallengeMode: 0,
			ChallengeModeRank: 0,
		}),
		"en",
		noConst,
	);
	assert.deepEqual(down.rksDelta, { text: `${MINUS}0.0050`, cls: "tl-down" });
	assert.equal(down.challenge, null);

	const none = buildTimeline(
		baseData({ added_rks_notes: ["", ""] }),
		"en",
		noConst,
	);
	assert.equal(none.rksDelta.text, "");
});

test("splitRichLines breaks at <br> and keeps every line's tags balanced", () => {
	assert.deepEqual(splitRichLines("Yue"), ["Yue"]);
	assert.deepEqual(
		splitRichLines('<span style="color:#f00">ab<br>cd</span><br><b>e</b>'),
		[
			'<span style="color:#f00">ab</span>',
			'<span style="color:#f00">cd</span>',
			"<b>e</b>",
		],
	);
	assert.deepEqual(splitRichLines("a<br/>b"), ["a", "b"]);
	// The space between two tags survives (the CSS keeps the line a block, not flex)
	const spaced =
		'Hello <b>World</b> <span style="color:#ff8fa3">Again</span> end';
	assert.deepEqual(splitRichLines(spaced), [spaced]);
	assert.deepEqual(richTextLines(spaced), ["Hello World Again end"]);
});

test("player name size comes from the visible text of the rich-text HTML", () => {
	assert.deepEqual(
		richTextLines('<span style="color:#f00">A&amp;B</span><br><b>CD</b>'),
		["A&B", "CD"],
	);
	const short = buildTimeline(baseData({ PlayerId: "Yue" }), "en", noConst);
	const long = buildTimeline(
		baseData({ PlayerId: '<span style="color:#fff">W</span>'.repeat(40) }),
		"en",
		noConst,
	);
	assert.equal(short.namePx, 38);
	assert.ok(long.namePx < 26 && long.namePx >= 16, "wraps onto two rows");
	const lines = buildTimeline(
		baseData({ PlayerId: "a<br>b<br>c" }),
		"en",
		noConst,
	);
	assert.equal(lines.namePx, 27, "three lines fit the header height");
});

test("nameFontPx shrinks to one row, then sizes two wrapped rows to fit", () => {
	const fits = (px: number, text: string, rows: number) =>
		textEm(text) * 1.1 * px <= 404 * rows;
	const mid = "SakuraChiyuki_Player";
	const midPx = nameFontPx([mid]);
	assert.ok(midPx >= 22 && midPx < 38 && fits(midPx, mid, 1), String(midPx));

	const plain = "TheVeryLongPlayerNameWithoutAnySpaces_1234567890_ABCDEFG";
	const plainPx = nameFontPx([plain]);
	assert.ok(plainPx >= 16 && plainPx < 22, String(plainPx));
	assert.ok(!fits(plainPx, plain, 1) && fits(plainPx, plain, 1.85));

	assert.equal(nameFontPx([""]), 38, "empty name keeps the full size");
	assert.equal(nameFontPx(["a", "b"]), 38, "two short lines");
	assert.equal(nameFontPx(["x".repeat(80), "y"]), 16, "never below the floor");
});

test("fitTitle shrinks, then wraps to two lines, then ellipsizes", () => {
	const short = fitTitle("Stasis", 170);
	assert.deepEqual(short, { lines: ["Stasis"], px: 19 });

	const two = fitTitle("PRAGMATISM -RESURRECTION-", 170);
	assert.deepEqual(two.lines, ["PRAGMATISM", "-RESURRECTION-"]);
	assert.ok(two.px >= 12.5 && two.px <= 14.5, "two lines cap at 14.5px");

	const long = fitTitle(
		"Chronologika: The Extremely Long Subtitle of an Imaginary Song That Never Ends",
		170,
	);
	assert.equal(long.lines.length, 2);
	assert.equal(long.px, 12.5);
	assert.ok(long.lines[1]!.endsWith("…"));
	for (const line of long.lines)
		assert.ok(textEm(line) * 1.1 * long.px <= 170 + 0.01, line);

	const cjk = fitTitle(
		"超长的中文曲名测试用例一二三四五六七八九十甲乙丙丁戊己庚辛",
		170,
	);
	assert.equal(cjk.lines.length, 2);
	assert.ok(cjk.lines[1]!.endsWith("…"));
});

test("fitTitle keeps the two-line split that fits the largest size", () => {
	// The space split leaves "祈" alone and the rest tiny; the CJK split is larger
	const cjk = fitTitle("祈 -我ら神祖と共に歩む者なり-", 202);
	assert.deepEqual(cjk, {
		lines: ["祈 -我ら神祖と", "共に歩む者なり-"],
		px: 14.5,
	});
	// On a tie the split at the space wins
	const tie = fitTitle("一二三四五六 七八九十甲乙丙", 202);
	assert.deepEqual(tie.lines, ["一二三四五六", "七八九十甲乙丙"]);

	const view = buildTimeline(
		oneDay([tile("PRAGMATISM -RESURRECTION-"), tile("Stasis")]),
		"en",
		noConst,
	);
	assert.deepEqual(
		view.days[0]!.entries.map((e) => e.twoLine),
		[true, false],
	);
});

test("clipEm keeps text that fits and ellipsizes the rest", () => {
	assert.equal(clipEm("abc", 10), "abc");
	const clipped = clipEm("abcdefghijklmnop", 3);
	assert.ok(clipped.endsWith("…"));
	assert.ok(textEm(clipped) <= 3);
});

test("chartOf maps segments into the plot with y measured up from the minimum", () => {
	const chart = chartOf(
		[
			[0, 0, 50, 40],
			[50, 40, 100, 100],
		],
		[16.3, 16.6],
		["2026/08/19 09:52:47", "2026/09/21 09:52:47"],
	);
	assert.ok(chart);
	assert.equal(chart.max, "16.6000");
	assert.equal(chart.mid, "16.4500");
	assert.equal(chart.min, "16.3000");
	assert.equal(chart.first, "16.3000");
	assert.equal(chart.last, "16.6000");
	assert.deepEqual(chart.change, { text: "+0.3000", cls: "tl-up" });
	assert.equal(chart.from, "2026/08/19");
	assert.equal(chart.to, "2026/09/21");
	// First point bottom-left, last point top-right of a 640x150 plot (padding 10/12)
	assert.match(chart.svg, /<path d="M10 138 L320 87.6 L630 12" fill="none"/);
	assert.match(chart.svg, /width="640" height="150"/);
});

test("chartOf keeps times for a single-day range and hides without history", () => {
	const day = chartOf(
		[[0, 0, 100, 100]],
		[16.55, 16.57],
		["2026/09/21 08:00:00", "2026/09/21 21:00:00"],
	);
	assert.equal(day?.single, false);
	assert.equal(day?.from, "2026/09/21 08:00:00");
	assert.equal(day?.to, "2026/09/21 21:00:00");
	assert.equal(chartOf([], [0, 1], ["", ""]), null);
	assert.equal(chartOf(undefined, undefined, undefined), null);
	assert.equal(chartOf([["a", 1, 2, 3]], [0, 1], ["", ""]), null);
});

test("chartOf: one record gets no line, a flat history labels only its value", () => {
	// history.ts: one record → the placeholder segment and a ±0.01 range around it
	const single = chartOf(
		[[0, 50, 100, 50]],
		[16.5514, 16.5714],
		["2026/09/21 09:52:47", "2026/09/21 09:52:47"],
	);
	assert.equal(single?.single, true);
	assert.equal(single?.svg, "");
	assert.equal(single?.last, "16.5614");
	assert.equal(single?.to, "2026/09/21 09:52:47");
	assert.equal(single?.change.text, "");

	const flat = chartOf(
		[[0, 50, 100, 50]],
		[16.5514, 16.5714],
		["2026/09/01 09:52:47", "2026/09/21 09:52:47"],
	);
	assert.equal(flat?.single, false);
	assert.deepEqual(
		[flat?.max, flat?.mid, flat?.min],
		["", "16.5614", ""],
		"no made-up axis labels",
	);
	assert.deepEqual(flat?.change, { text: "±0.0000", cls: "tl-flat" });
	assert.equal(flat?.from, "2026/09/01");
});

test("chartOf drops per-point markers on a long history", () => {
	const circles = (svg = "") => (svg.match(/<circle/g) ?? []).length;
	const short = chartOf(
		[
			[0, 0, 50, 40],
			[50, 40, 100, 100],
		],
		[16, 17],
		["2026/08/19 09:52:47", "2026/09/21 09:52:47"],
	);
	assert.equal(
		circles(short?.svg),
		4,
		"2 markers + the highlighted last point",
	);
	const segs = Array.from({ length: 60 }, (_, i) => [
		(i * 100) / 60,
		i % 2 ? 40 : 60,
		((i + 1) * 100) / 60,
		i % 2 ? 60 : 40,
	]);
	const dense = chartOf(
		segs,
		[16, 17],
		["2025/10/01 10:00:00", "2026/09/21 09:52:47"],
	);
	assert.equal(circles(dense?.svg), 2, "only the highlighted last point");
});

test("empty history gives the empty state, tasks are mapped with localized status", () => {
	const view = buildTimeline(
		baseData({
			box_line: [],
			rks_history: [],
			task_data: [
				{
					song: "Stasis",
					illustration: `${ILL}/Stasis.Maozon.png`,
					finished: true,
					request: { type: "acc", rank: "in", value: "99.50%" },
				},
				{
					song: "Rrharil",
					illustration: "",
					finished: false,
					request: { type: "score", rank: "AT", value: "0990000" },
				},
				null,
			],
		}),
		"zh",
		noConst,
	);
	assert.equal(view.empty, true);
	assert.equal(view.chart, null);
	assert.deepEqual(
		view.tasks.map((t) => [t.rank, t.rankCls, t.request, t.done, t.status]),
		[
			["IN", "tl-r-in", "ACC ≥ 99.50%", true, "已完成"],
			["AT", "tl-r-at", "分数 ≥ 0990000", false, "未完成"],
		],
	);
	assert.equal(view.total, "共 0 次更新 · 0 天");
});

test("prepare keeps the card data and adds localized copy plus the view model", async () => {
	const data = baseData();
	const out = await variant.prepare!(data, {
		kind: "hisb30",
		locale: "zh",
		catalog: {} as never,
	});
	assert.equal(out.PlayerId, "Player");
	assert.equal((out.vt as { updates: string }).updates, "最近更新");
	assert.equal((out.tl as { days: unknown[] }).days.length, 2);
	assert.equal(
		(out.tl as { days: { weekday: string }[] }).days[0]?.weekday,
		"周一",
	);
	assert.equal(variant.tpl, "update-timeline");
	assert.equal(variant.width, 800);
});

test("the empty-state message is two short lines, each within the panel", async () => {
	for (const locale of ["en", "zh"] as const) {
		const out = await variant.prepare!(baseData({ box_line: [] }), {
			kind: "hisb30",
			locale,
			catalog: {} as never,
		});
		const lines = (out.vt as { emptyBody: string[] }).emptyBody;
		assert.equal(lines.length, 2, locale);
		// 16px body text in a 632px-wide panel (nowrap lines)
		for (const line of lines) assert.ok(textEm(line) * 16 < 632, line);
	}
});
