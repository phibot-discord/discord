import assert from "node:assert/strict";
import test from "node:test";
import type { Board, Placement } from "../leaderboard.ts";
import type { SongCardData } from "../song-card.ts";
import {
	BIN_W,
	boardTopPercent,
	fitLines,
	fmtScore,
	PLOT_H,
	STRIP_W,
	songView,
	variant,
} from "./song.ts";

function board(over: Partial<Board> = {}): Board {
	const bins = Array.from({ length: 40 }, (_, i) => i * 10);
	return {
		v: 1,
		at: 0,
		n: 10_000,
		ap: 290,
		fc: 480,
		// q[k]: acc of the best k·0.5 %; 201 points from 100 down
		q: Array.from({ length: 201 }, (_, k) =>
			k < 6 ? 100 : Math.max(0, 100 - k * 0.05),
		),
		hist: { lo: 80, step: 0.5, bins, below: 781 },
		...over,
	};
}

function place(over: Partial<Placement> = {}): Placement {
	return {
		rank: 3611,
		of: 70_388,
		percent: 5.13,
		tied: 0,
		total: 70_387,
		ap: false,
		...over,
	};
}

function card(over: Partial<SongCardData> = {}): SongCardData {
	return {
		id: "Rrharil.TeamGrimoire.0",
		level: "AT",
		title: "Rrhar'il",
		composer: "Team Grimoire",
		charter: "RWND",
		illustrator: "x",
		constant: 17.6,
		notes: 1300,
		noteKinds: { tap: 991, drag: 44, hold: 123, flick: 142 },
		jacket: "/ill/a.png",
		player: { name: "Me", rks: 16.5614, avatar: "" },
		record: { score: 995_000, acc: 99.5, fc: false, rks: 17.1, rating: "V" },
		overall: place(),
		band: place({ rank: 28, of: 5805, percent: 0.48, total: 5804 }),
		rksBand: { minRks: 16.5, maxRks: 16.6 },
		apfc: { total: 70_387, ap: 2036, fc: 3360 },
		board: board(),
		levels: [
			{
				level: "AT",
				constant: 17.6,
				notes: 1300,
				record: {
					score: 995_000,
					acc: 99.5,
					fc: false,
					rks: 17.1,
					rating: "V",
				},
				place: place(),
				apfc: { total: 70_387, ap: 2036, fc: 3360 },
			},
		],
		state: { rank: "ok", band: "ok", apfc: "ok", board: "ok" },
		asOf: "2026-10-06",
		...over,
	};
}

test("scores print as Phigros' 7 digits and titles shrink, then wrap, then cut", () => {
	assert.equal(fmtScore(910415), "0910415");
	assert.equal(fmtScore(1_000_000), "1000000");
	assert.deepEqual(fitLines("Short", 372, { max: 34, min: 20, wrap: 26 }), {
		px: 34,
		lines: ["Short"],
	});
	const long = fitLines(
		"A very long song title that cannot possibly fit on one line at all",
		372,
		{ max: 34, min: 20, wrap: 26 },
	);
	assert.equal(long.lines.length, 2);
	assert.ok(long.px >= 20 && long.px <= 26);
});

test("standing tiles show the rank, the population and a rank-derived Top %", () => {
	const view = songView(card(), "en");
	const [all, band] = view.tiles;
	assert.equal(all?.pos, "#3,611");
	assert.equal(all?.of, "/ 70,388");
	assert.equal(all?.pct, "Top 5.1%");
	assert.equal(all?.label, "ALL RECORDS");
	// "/ 70,388" includes the user: the line under it says so
	assert.equal(
		all?.sub,
		"Among 70,387 phib19.top records on this chart, plus you",
	);
	assert.equal(band?.label, "RKS 16.50–16.60");
	assert.equal(band?.pct, "Top 0.48%");
	assert.equal(band?.sub, "Among 5,804 records set at a similar RKS, plus you");
	assert.ok((all?.posPx ?? 0) <= 44 && (all?.posPx ?? 0) >= 26);
	const ap = songView(
		card({
			record: {
				score: 1_000_000,
				acc: 100,
				fc: true,
				rks: 17.6,
				rating: "phi",
			},
			overall: place({ rank: 1, percent: 2.89, tied: 2032, ap: true }),
		}),
		"en",
	);
	assert.equal(ap.tiles[0]?.pos, "#1");
	// #1 next to "Top 2.9%" would contradict itself: an AP shows the AP share
	assert.equal(ap.tiles[0]?.pct, "AP · 2.9% of records");
	assert.equal(ap.tiles[0]?.note, "Tied with 2,032 other AP records");
	assert.equal(ap.record?.badge, "AP");
	assert.equal(ap.dist.strip.marker?.label, "YOU · AP");
	// The first AP on a chart is tied with nobody: no "tied with 0"
	const first = songView(
		card({
			record: {
				score: 1_000_000,
				acc: 100,
				fc: true,
				rks: 17.6,
				rating: "phi",
			},
			overall: place({ rank: 1, percent: 0.01, tied: 0, ap: true }),
		}),
		"en",
	);
	assert.equal(first.tiles[0]?.note, "");
	const apRow = songView(
		card({
			levels: [
				{
					level: "AT",
					constant: 17.6,
					record: {
						score: 1_000_000,
						acc: 100,
						fc: true,
						rks: 17.6,
						rating: "phi",
					},
					place: place({ rank: 1, percent: 2.89, tied: 2032, ap: true }),
					apfc: null,
				},
			],
		}),
		"en",
	);
	assert.equal(apRow.levels[0]?.pct, "AP 2.9%");
});

test("the histogram marks the user's bin, the records ahead and the AP column", () => {
	const view = songView(card(), "en");
	const d = view.dist;
	assert.ok(d.ok);
	assert.equal(d.bars.length, 40);
	// 99.5 % falls in the last bin (99.5–100)
	assert.equal(d.bars[39]?.cls, "you");
	assert.equal(d.bars[0]?.cls, "lo");
	assert.equal(d.bars[39]?.h, PLOT_H);
	assert.equal(d.bars[0]?.h, 0);
	assert.equal(d.marker?.x, 39 * BIN_W);
	assert.ok(d.marker?.line);
	assert.equal(d.ticks[0]?.label, "80%");
	assert.equal(d.ticks.at(-1)?.label, "100%");
	assert.equal(d.ticks.at(-1)?.x, 40 * BIN_W);
	assert.equal(d.below, "781 records below 80%");
	assert.equal(d.ap.label, "290");
	assert.ok(!d.ap.you);
	// Strip: best on the right; Top 5.13 % sits at 94.87 % of the width
	assert.equal(d.strip.marker?.x, Math.round(0.9487 * STRIP_W));
	assert.deepEqual(
		d.strip.ticks.map((t) => t.label),
		["Median", "Top 25%", "Top 10%"],
	);
	assert.equal(d.strip.apW, Math.round(0.029 * STRIP_W));
	const mid = songView(
		card({
			record: { score: 900_000, acc: 90.2, fc: false, rks: 10, rating: "A" },
		}),
		"en",
	).dist;
	assert.equal(mid.bars[20]?.cls, "you");
	assert.equal(mid.bars[21]?.cls, "hi");
	assert.equal(mid.bars[19]?.cls, "lo");
});

test("an AP is marked on the AP column without a line, and its count label gives way", () => {
	const d = songView(
		card({
			record: {
				score: 1_000_000,
				acc: 100,
				fc: true,
				rks: 17.6,
				rating: "phi",
			},
			overall: place({ rank: 1, percent: 2.89, tied: 2032, ap: true }),
		}),
		"en",
	).dist;
	assert.ok(d.ap.you);
	assert.equal(d.ap.label, "");
	assert.equal(d.marker?.line, false);
	assert.ok(d.bars.every((b) => b.cls === "lo"));
});

test("missing lookups explain themselves instead of drawing empty charts", () => {
	const late = songView(
		card({
			overall: null,
			band: null,
			apfc: null,
			board: null,
			state: { rank: "late", band: "failed", apfc: "off", board: "late" },
		}),
		"en",
	);
	assert.equal(late.tiles[0]?.pos, "—");
	assert.match(late.tiles[0]?.note ?? "", /slow/);
	assert.match(late.tiles[1]?.note ?? "", /did not answer/);
	assert.ok(!late.dist.ok);
	assert.match(late.dist.note, /slow/);
	assert.ok(!late.counts.ok);
	assert.match(late.counts.note, /off in your settings/);
	// A route phib19 (or the proxy) doesn't serve right now: not "turned off"
	const gone = songView(
		card({
			apfc: null,
			board: null,
			state: {
				rank: "ok",
				band: "ok",
				apfc: "unavailable",
				board: "unavailable",
			},
		}),
		"en",
	);
	assert.equal(gone.dist.note, "Leaderboard data isn't available right now.");
	assert.equal(gone.counts.note, "Leaderboard data isn't available right now.");
	assert.equal(
		songView(
			card({
				apfc: null,
				board: null,
				state: {
					rank: "ok",
					band: "ok",
					apfc: "unavailable",
					board: "unavailable",
				},
			}),
			"zh",
		).dist.note,
		"排行数据暂时不可用。",
	);
	// No records on the chart at all: said plainly, no "0 records" meters
	const empty = songView(
		card({
			overall: null,
			band: null,
			apfc: null,
			board: board({ n: 0, ap: 0, fc: 0, q: [] }),
		}),
		"en",
	);
	assert.ok(!empty.counts.ok);
	assert.equal(
		empty.counts.note,
		"phib19.top has no records on this chart yet.",
	);
	assert.equal(empty.dist.note, "phib19.top has no records on this chart yet.");
	const none = songView(
		card({
			record: null,
			overall: null,
			band: null,
			state: { rank: "none", band: "none", apfc: "ok", board: "ok" },
		}),
		"en",
	);
	assert.equal(none.record, null);
	assert.equal(none.tiles[0]?.note, "");
	assert.ok(none.dist.ok);
	assert.equal(none.dist.marker, null);
	assert.ok(none.dist.bars.every((b) => b.cls === "mid"));
});

test("the strip falls back to the board's quantiles when the rank lookup missed", () => {
	const b = board();
	assert.ok(Math.abs((boardTopPercent(b, 100) ?? 0) - 2.9) < 1e-9);
	// q[k] = 100 − 0.05k below the AP block: 99.5 is reached by the best 5 %
	const p = boardTopPercent(b, 99.5);
	assert.ok(p != null && p > 4.5 && p <= 5.5);
	const view = songView(
		card({
			overall: null,
			state: { rank: "failed", band: "ok", apfc: "ok", board: "ok" },
		}),
		"en",
	);
	assert.ok(view.dist.strip.marker);
});

test("Chinese copy and the variant hook", async () => {
	const zh = songView(card(), "zh");
	assert.equal(zh.tiles[0]?.pct, "前 5.1%");
	assert.equal(zh.vt.standing, "排名");
	assert.equal(zh.source, "数据：phib19.top · 2026-10-06");
	assert.equal(variant.tpl, "song");
	assert.equal(variant.width, 800);
	const data = await variant.prepare?.(
		{ songCard: card() },
		{ kind: "song", locale: "en", catalog: {} as never },
	);
	assert.equal((data?.sc as { lc: string } | undefined)?.lc, "en");
	assert.deepEqual(
		await variant.prepare?.(
			{ x: 1 },
			{ kind: "song", locale: "en", catalog: {} as never },
		),
		{ x: 1 },
	);
});
