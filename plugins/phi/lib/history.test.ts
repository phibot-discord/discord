import assert from "node:assert/strict";
import test from "node:test";
import { fCompute } from "./fcompute.ts";
import { buildUpdateCard, updateCardImages } from "./history.ts";
import type { UserNotes } from "./notes.ts";
import type { PhiRuntime } from "./runtime.ts";
import type { Save } from "./save.ts";
import { SaveHistory } from "./save-history.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1, 4, 0, 0);

function mockRt(): PhiRuntime {
	return {
		getInfo: {
			resources: "/res",
			raw: (id: string) => ({
				chart: { IN: { difficulty: 15 }, AT: { difficulty: 16 } },
				song: `Song ${id}`,
			}),
			idgetsong: (id: string) => `Song ${id}`,
			getill: (id: string, kind: string) => `/ill/${kind}/${id}.png`,
		},
		fCompute,
	} as unknown as PhiRuntime;
}

function mockSave(): Save {
	return {
		saveInfo: {
			PlayerId: "tester",
			summary: {
				rankingScore: 15.1234,
				challengeModeRank: 351,
				updatedAt: new Date(T0),
			},
		},
	} as unknown as Save;
}

const catalog = { randomIll: () => "/ill/blur/bg.png" } as never;
const notes = { theme: "default", task: [] } as unknown as UserNotes;

function scores(count: number, dayOffset: number, acc = 99) {
	const date = new Date(T0 + dayOffset * DAY).toISOString();
	const out: Record<string, Record<string, unknown[]>> = {};
	for (let i = 0; i < count; i++) {
		out[`s${dayOffset}-${i}.0`] = {
			IN: [[(acc - i * 0.01).toFixed(4), 990_000 - i, date, false]],
		};
	}
	return out;
}

test("update card packs date groups into rows of five tiles", async () => {
	const history = new SaveHistory({
		version: 3,
		scoreHistory: { ...scores(7, 2), ...scores(2, 1), ...scores(1, 0) },
	} as never);
	const card = await buildUpdateCard(
		mockRt(),
		mockSave(),
		catalog,
		history,
		notes,
		[],
		{ locale: "en" },
	);
	assert.equal(card.show, 10);
	assert.equal(card.update_ans, "Updated 10 scores");
	// Newest save first: 7 songs → 5 + 2, then the 2- and 1-song saves fill the second row
	assert.deepEqual(
		card.box_line.map((line) => line.map((box) => box.song.length)),
		[[5], [2, 2, 1]],
	);
	const [first, second] = card.box_line;
	assert.ok(first?.[0]?.date, "first box carries its date");
	assert.equal(second?.[0]?.date, undefined, "continuation box has no date");
	assert.equal(second?.[0]?.update_num, 7, "last box of a group counts it");
	assert.equal(second?.[1]?.update_num, 2);
	assert.equal(second?.[0]?.width, 2 * 135 + 20 * 2 - 20);
	// Within a save, tiles are ordered by the new RKS, best first
	const rks = first?.[0]?.song.map((s) => s.rks_new) ?? [];
	assert.deepEqual(
		rks,
		[...rks].sort((a, b) => b - a),
	);
	assert.equal(first?.[0]?.song[0]?.Rating, "V");
	assert.equal(first?.[0]?.song[0]?.illustration, "/ill/low/s2-0.0.png");
});

test("update card keeps at most ten saves, ten tiles each, fifty total", async () => {
	const scoreHistory: Record<string, unknown> = {};
	for (let day = 0; day < 12; day++)
		Object.assign(scoreHistory, scores(12, day));
	const history = new SaveHistory({ version: 3, scoreHistory } as never);
	const card = await buildUpdateCard(
		mockRt(),
		mockSave(),
		catalog,
		history,
		notes,
		[],
	);
	assert.equal(card.show, 50);
	const boxes = card.box_line.flat();
	const dated = boxes.filter((b) => b.date);
	assert.equal(dated.length, 5, "10 tiles per save → 5 saves fit in 50");
	const counted = boxes.filter((b) => b.update_num != null);
	assert.equal(counted.length, 5);
	for (const b of counted) {
		assert.equal(b.update_num, 12);
		assert.equal(b.date, undefined);
	}
	assert.equal(card.box_line.length, 10);
	assert.equal(
		card.box_line.reduce(
			(n, line) => n + line.reduce((m, b) => m + b.song.length, 0),
			0,
		),
		50,
	);
});

test("update card with no history shows the empty state and RKS delta from snapshots", async () => {
	const card = await buildUpdateCard(
		mockRt(),
		mockSave(),
		catalog,
		new SaveHistory(null),
		notes,
		[
			{ t: T0, rks: 15.1, phi: [], b27: [] },
			{ t: T0 + DAY, rks: 15.1234, phi: [], b27: [] },
		],
		{ locale: "zh" },
	);
	assert.equal(card.show, 0);
	assert.deepEqual(card.box_line, []);
	assert.equal(card.update_ans, "未收集到新成绩");
	assert.equal(card.added_rks_notes[0], "+0.0234");
	assert.equal(card.rks_history.length, 1, "snapshots draw the RKS line");
	assert.equal(card.ChallengeMode, 3);
	assert.equal(card.ChallengeModeRank, 51);
});

test("updateCardImages lists every jacket, grade icon, the challenge icon and background once", async () => {
	const history = new SaveHistory({
		version: 3,
		scoreHistory: {
			...scores(3, 0),
			"phi.0": {
				AT: [["100.0000", 1_000_000, new Date(T0).toISOString(), true]],
			},
		},
	} as never);
	const card = await buildUpdateCard(
		mockRt(),
		mockSave(),
		catalog,
		history,
		notes,
		[],
	);
	const images = updateCardImages(mockRt(), card);
	assert.equal(new Set(images).size, images.length);
	assert.ok(images.includes("/ill/blur/bg.png"));
	assert.ok(images.includes("/res/html/otherimg/3.png"));
	assert.ok(images.includes("/res/html/otherimg/V.png"));
	assert.ok(images.includes("/res/html/otherimg/phi.png"));
	assert.ok(images.includes("/ill/low/phi.0.png"));
	assert.equal(images.filter((i) => i.startsWith("/ill/low/")).length, 4);
});

test("the summary layout also prefetches the jackets of charts that entered or left the B30", async () => {
	const card = await buildUpdateCard(
		mockRt(),
		mockSave(),
		catalog,
		new SaveHistory({ version: 3, scoreHistory: {} } as never),
		notes,
		[],
	);
	const row = (id: string, rank = "IN") => ({ id, rank });
	const snaps = [
		{ t: 1, rks: 15, phi: [row("p.0")], b27: [row("old.0"), row("kept.0")] },
		{
			t: 2,
			rks: 15.1,
			phi: [row("p.0")],
			// kept.0 changed level: its IN left and its AT entered
			b27: [row("kept.0", "AT"), row("new.0")],
		},
	];
	const jackets = (cardStyle?: string) =>
		updateCardImages(mockRt(), { ...card, cardStyle, hisb30Snaps: snaps })
			.filter((i) => i.startsWith("/ill/low/"))
			.sort();
	assert.deepEqual(jackets("summary"), [
		"/ill/low/kept.0.png",
		"/ill/low/new.0.png",
		"/ill/low/old.0.png",
	]);
	assert.deepEqual(jackets("classic"), []);
	assert.deepEqual(jackets(), []);
	assert.deepEqual(
		updateCardImages(mockRt(), {
			...card,
			cardStyle: "summary",
			hisb30Snaps: snaps.slice(1),
		}).filter((i) => i.startsWith("/ill/low/")),
		[],
		"one snapshot: no movement to show",
	);
});
