import assert from "node:assert/strict";
import test from "node:test";
import {
	buildChart,
	CHART_GUTTER,
	fitIntro,
	fmtKiB,
	infoView,
	richPlain,
} from "./info-common.ts";

const GEO = {
	nameW: 380,
	nameMax: 44,
	nameMin: 22,
	introW: 1064,
	introMaxLines: 4,
	introMax: 22,
	introMin: 16,
	rks: { w: 496, h: 170 },
	data: { w: 496, h: 170 },
	acc: { w: 1064, h: 170 },
};

const stat = (o: Record<string, unknown>) => ({
	title: "IN",
	Rating: "V",
	unlock: 0,
	tot: 0,
	cleared: 0,
	fc: 0,
	phi: 0,
	real_score: 0,
	tot_score: 0,
	highest: 0,
	lowest: 0,
	...o,
});

test("richPlain keeps the visible text and turns <br> into newlines", () => {
	assert.equal(
		richPlain('Hi<br><span style="color:red">there</span> &amp; you\r'),
		"Hi\nthere & you",
	);
});

test("fmtKiB picks the largest unit that keeps the value readable", () => {
	assert.equal(fmtKiB(615412), "601 MiB");
	assert.equal(fmtKiB(1012), "1012 KiB");
	assert.equal(fmtKiB(5 * 1024 * 1024), "5.0 GiB");
});

test("fitIntro keeps line breaks, then flows short lines, then cuts", () => {
	const short = fitIntro("Hello there", 1064, {
		maxLines: 4,
		max: 22,
		min: 16,
	});
	assert.deepEqual(short && [short.px, short.lines], [22, 1]);
	// Six one-word lines can't stay six lines in a 4-line box: they flow
	const many = fitIntro("a<br>b<br>c<br>d<br>e<br>f", 1064, {
		maxLines: 4,
		max: 22,
		min: 16,
	});
	assert.ok(many);
	assert.ok(!many.html.includes("<br"));
	assert.equal(many.lines, 1);
	const long = fitIntro("word ".repeat(400), 300, {
		maxLines: 2,
		max: 18,
		min: 14,
	});
	assert.ok(long?.html.endsWith("…"));
	assert.equal(long?.px, 14);
	assert.equal(
		fitIntro("  <br> ", 300, { maxLines: 2, max: 18, min: 14 }),
		null,
	);
});

test("buildChart maps up-from-min percentages into the plot, leaving the label gutter", () => {
	const c = buildChart(
		[
			[0, 0, 50, 100],
			[50, 100, 100, 50],
		],
		{ w: 300, h: 116 },
		{ yTop: "17", yBottom: "16", xTicks: [{ pct: 50, label: "mid" }] },
	);
	assert.ok(c);
	assert.equal(c.w, 300 - CHART_GUTTER);
	// y 0% sits on the bottom grid line, 100% on the top one
	assert.equal(c.dots[0]?.y, 108);
	assert.equal(c.dots[1]?.y, 8);
	assert.equal(c.dots[0]?.x, 6);
	assert.equal(c.last.x, c.w - 6);
	assert.deepEqual(c.grid, [8, 58, 108]);
	assert.equal(c.xTicks[0]?.anchor, "middle");
	assert.equal(
		buildChart([], { w: 300, h: 116 }, { yTop: "", yBottom: "", xTicks: [] }),
		null,
	);
});

test("infoView: progress per difficulty, totals, hidden empty bits", () => {
	const v = infoView(
		{
			gameuser: {
				PlayerId: "<b>Name</b>",
				rks: 16.56144,
				ChallengeMode: 0,
				ChallengeModeRank: 0,
				data: "0KiB",
				avatar: "Introduction",
				selfIntro: "",
			},
			userstats: [
				stat({ unlock: 10, tot: 20, Rating: "phi" }),
				stat({
					unlock: 4,
					tot: 20,
					cleared: 2,
					fc: 1,
					phi: 1,
					real_score: 1_980_000,
					tot_score: 2_000_000,
					highest: 12.7,
					lowest: 8.1,
				}),
			],
			rks_history: [[0, 0, 100, 100]],
			rks_range: [16.1, 16.5],
			rks_date: ["2026/07/06 09:52:47", "2026/09/21 09:52:47"],
		},
		"en",
		GEO,
		new Date(2026, 9, 7),
	);
	assert.equal(v.rks, "16.5614");
	// Manual-mode noise: no challenge badge, no "0KiB"
	assert.equal(v.challenge, null);
	assert.equal(v.dataText, "");
	assert.equal(v.intro, null);
	const [ez, hd, inn] = v.levels;
	// Nothing played: no grade icon, marked empty
	assert.equal(ez?.rating, "");
	assert.equal(ez?.empty, true);
	assert.equal(hd?.clearRate, "50.0%");
	assert.equal(hd?.fcPct, 25);
	assert.equal(hd?.scorePct, "99.00%");
	assert.equal(hd?.best, "12.70");
	// Missing stats rows are zeros, not crashes
	assert.equal(inn?.unlocked, 0);
	assert.equal(v.totals.cleared, 2);
	assert.equal(v.totals.unlocked, 14);
	assert.ok(v.charts.rks);
	assert.equal(v.charts.data, null);
	assert.deepEqual(v.charts.rksDates, ["2026/07/06", "2026/09/21"]);
	assert.equal(v.trends.length, 2);
	assert.equal(v.generated, "2026/10/07");
});
