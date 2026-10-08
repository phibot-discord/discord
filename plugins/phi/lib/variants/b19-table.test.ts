import assert from "node:assert/strict";
import test from "node:test";
import { textEm } from "../text-fit.ts";
import { lineEm } from "./b19-common.ts";
import {
	analysisView,
	avgLabel,
	chipTexts,
	fitName,
	fitRank,
	fitTitle,
	HIST,
	paddedScore,
	peerAvg,
	prepareTable,
	pushKey,
	pushTier,
	richTextLines,
	type TableItem,
	type TableRow,
	TITLE_W,
	tableCopy,
	tableItems,
	tagFontPx,
	tipView,
	truncateEm,
} from "./b19-table.ts";

const en = tableCopy("en");
const enT = {
	slotsUnit: " slots",
	validVotes: "Valid votes",
	tagInsufficient: "Not enough votes",
};

function chart(i: number, extra: Record<string, unknown> = {}) {
	return {
		id: `song${i}`,
		song: `Song ${i}`,
		rank: "IN",
		difficulty: 15.3,
		rks: 15 - i * 0.01,
		score: 990_000 - i,
		acc: 99.5,
		Rating: "V",
		illustration: `/ill/${i}.png`,
		suggest: "99.7000%",
		...extra,
	};
}

const rowsOf = (items: TableItem[]) =>
	items.filter((it): it is TableRow => it.type === "row");

test("paddedScore splits the leading zeros of a 7-digit score", () => {
	assert.deepEqual(paddedScore(971455), { lead: "0", rest: "971455" });
	assert.deepEqual(paddedScore(1_000_000), { lead: "", rest: "1000000" });
	assert.deepEqual(paddedScore(0), { lead: "000000", rest: "0" });
	assert.deepEqual(paddedScore("oops"), { lead: "000000", rest: "0" });
	assert.deepEqual(paddedScore(2_000_000), { lead: "", rest: "1000000" });
});

test("fitTitle keeps short titles on one line and wraps long ones in two", () => {
	assert.deepEqual(fitTitle("Stasis", TITLE_W.push), {
		lines: ["Stasis"],
		px: 18,
		clip: false,
	});
	const long = "Compute It With Some Devilish Alcoholic Steampunk Engines";
	const two = fitTitle(long, TITLE_W.push);
	assert.equal(two.lines.length, 2);
	assert.equal(two.lines.join(" "), long);
	assert.equal(two.clip, false);
	assert.ok(two.px >= 12 && two.px <= 18);
	for (const line of two.lines)
		assert.ok(textEm(line) * two.px <= TITLE_W.push);
	// The wider no-push column (x30 / fc30) keeps it on one line at ≥ 14px
	const wide = fitTitle(long, TITLE_W.wide);
	assert.deepEqual(wide.lines, [long]);
	assert.ok(wide.px >= 14);
	assert.deepEqual(fitTitle("   ", 300).lines, ["—"]);
});

test("fitTitle ends an impossible title with an explicit ellipsis", () => {
	const huge = "終わりなき旅路の果てに".repeat(12);
	const fit = fitTitle(huge, TITLE_W.push);
	assert.equal(fit.clip, true);
	assert.equal(fit.px, 12);
	assert.equal(fit.lines.length, 1);
	assert.ok(fit.lines[0]!.endsWith("…"));
	assert.ok(textEm(fit.lines[0]!) <= (TITLE_W.push / 12) * 1.85);
});

test("truncateEm leaves fitting text alone and cuts the rest", () => {
	assert.equal(truncateEm("Retribution", 20), "Retribution");
	const cut = truncateEm("Retribution ~ Cycle of Redemption ~", 8);
	assert.ok(cut.endsWith("…"));
	assert.ok(textEm(cut) <= 8);
});

test("richTextLines and fitName read the plain text of a rich player name", () => {
	const html =
		'<span style="color:#f0a">Saku</span><b>ra</b> &amp; <i>Chi</i><br>second &lt;line&gt;';
	assert.deepEqual(richTextLines(html), ["Sakura & Chi", "second <line>"]);
	assert.deepEqual(fitName("樱本千雪", 540), { px: 40, clip: false });
	const twoLines = fitName("A<br>B", 540);
	assert.equal(twoLines.px, 28);
	const long = fitName("W".repeat(60), 540);
	assert.deepEqual(long, { px: 16, clip: true });
	const mid = fitName(
		"Sakuramoto Chiyuki the Extremely Long Named Player",
		540,
	);
	assert.ok(mid.px < 40 && mid.px >= 16 && !mid.clip);
	assert.deepEqual(fitName("", 540), { px: 40, clip: false });
	// Synthesized bold is wider: the same text gets a smaller size inside <b>
	const plain = fitName("Sakuramoto Chiyuki the Long Named", 520);
	const bold = fitName("<b>Sakuramoto Chiyuki the Long Named</b>", 520);
	assert.ok(bold.px < plain.px);
});

test("peerAvg parses every attachB19AccAvg format into one line", () => {
	assert.equal(peerAvg(undefined, 99), undefined);
	assert.equal(peerAvg("", 99), undefined);
	assert.equal(peerAvg("   ", 99), undefined);
	assert.deepEqual(peerAvg("Avg: 98.1234%", 99), {
		dir: "up",
		text: "98.1234%",
		isNum: true,
		px: 12,
	});
	// The marker follows the numbers, not the colour kind ("Finished" / "Hyper")
	assert.equal(peerAvg("BAvg: 99.5%", 99)?.dir, "down");
	assert.equal(peerAvg("BAvg: 99%", 99)?.dir, "up");
	// avgValue mode hands over a bare number
	assert.equal(peerAvg(98.5, 99)?.text, "98.5000%");
	// "top": the header says "top %", the cell keeps both numbers on one line
	assert.deepEqual(peerAvg("Top 12.34% / 5.67%", 99), {
		dir: "",
		text: "12.34% / 5.67%",
		isNum: false,
		px: 12,
	});
	const wide = peerAvg("Top 100.00% / 100.00%", 99);
	assert.ok(wide && wide.px >= 10 && wide.px <= 12);
	assert.ok(textEm(wide.text) * wide.px <= 104);
	// "rank": the full string does not fit one line, so "/ total" goes first
	const rank = peerAvg("#3,611 / 70,388 · Top 5.1%", 99);
	assert.equal(rank?.text, "#3,611 · Top 5.1%");
	assert.equal(rank?.dir, "");
	assert.equal(rank?.isNum, false);
	assert.ok(rank && rank.px >= 10 && textEm(rank.text) * rank.px <= 104);
	// A huge rank keeps only the percentage; nothing ever spills past the cell
	const huge = peerAvg("#12,345,678 / 99,999,999 · Top 12.3%", 99);
	assert.equal(huge?.text, "Top 12.3%");
	const odd = peerAvg("x".repeat(80), 99);
	assert.ok(odd?.text.endsWith("…"));
	assert.ok(odd && textEm(odd.text) * odd.px <= 104);
	assert.equal(peerAvg("weird", 99)?.text, "weird");
});

test("pushTier buckets the target acc by difficulty", () => {
	assert.equal(pushTier("98.1000%"), "easy");
	assert.equal(pushTier("99.4999%"), "easy");
	assert.equal(pushTier("99.5000%"), "mid");
	assert.equal(pushTier("99.8499%"), "mid");
	assert.equal(pushTier("99.8500%"), "hard");
	assert.equal(pushTier("100.0000%"), "hard");
	assert.equal(pushTier("Can't push"), "");
});

test("chipTexts localizes the server mode labels and keeps the rest", () => {
	const zh = tableCopy("zh");
	assert.deepEqual(chipTexts(["x30"], zh), ["性30"]);
	// The x30 / fc30 title already names its own mode; other chips stay
	assert.deepEqual(chipTexts(["性30"], zh, "x30"), []);
	assert.deepEqual(chipTexts(["FC30", "ACC 限制为 99%"], en, "fc30"), [
		"ACC 限制为 99%",
	]);
	assert.deepEqual(chipTexts(["FC30"], en, "x30"), ["FC30"]);
	assert.deepEqual(chipTexts(["FC30", " "], zh), ["FC30"]);
	assert.deepEqual(chipTexts(["ACC 限制为 99%"], zh), ["ACC 限制为 99%"]);
	assert.deepEqual(chipTexts(undefined, en), []);
});

test("avgLabel names the peer column after the b30AvgKind in use", () => {
	assert.equal(avgLabel([{}, { accAvg: "Avg: 98%" }], en), en.avgAll);
	assert.equal(avgLabel([{ accAvg: 98.5 }], en), en.avgAll);
	assert.equal(avgLabel([{ accAvg: "BAvg: 98%" }], en), en.avgB30);
	assert.equal(avgLabel([{ accAvg: "Top 1% / 2%" }], en), en.avgTop);
	assert.equal(
		avgLabel([{ accAvg: "#3,611 / 70,388 · Top 5.1%" }], en),
		en.avgRank,
	);
	// "rank" rows are known by their accRank badge, whatever accAvg says
	assert.equal(
		avgLabel([{ accAvg: "x", accRank: { pos: "#1", pct: "AP 2%" } }], en),
		"Rank",
	);
	assert.equal(tableCopy("zh").avgRank, "名次");
});

const badge = (extra: Record<string, unknown> = {}) => ({
	pos: "#3,611",
	of: "/ 70,388",
	pct: "Top 5.1%",
	rank: 3611,
	total: 70388,
	percent: 5.13,
	tied: 0,
	ap: false,
	...extra,
});

test("fitRank keeps position, records and share in the hang line", () => {
	const full = fitRank({
		pos: "#3,611",
		of: "/ 70,388",
		pct: "Top 5.1%",
		ap: false,
	});
	assert.equal(full.px, 12);
	assert.equal(full.showOf, true);
	const width = (r: typeof full) =>
		textEm(r.pos) * r.px * 1.1 +
		(r.showOf ? 4 + textEm(r.of) * r.px : 0) +
		8 +
		textEm(r.pct) * r.px;
	assert.ok(width(full) <= 204);
	// Long counts shrink first, then drop "/ total"; never past the hang line
	const big = fitRank({
		pos: "#1,234,567",
		of: "/ 9,876,543",
		pct: "Top 12.5%",
		ap: false,
	});
	assert.ok(big.px >= 10 && big.px < 12);
	assert.ok(width(big) <= 204);
	const huge = fitRank({
		pos: "#123,456,789",
		of: "/ 987,654,321,000",
		pct: "Top 12.5%",
		ap: false,
	});
	assert.equal(huge.showOf, false);
	assert.equal(huge.px, 10);
});

test("tableItems reads accRank in rank mode instead of parsing accAvg", () => {
	const { items } = tableItems(
		{
			phi: [
				chart(100, {
					acc: 100,
					accRank: badge({ pos: "#1", pct: "AP 2.9%", ap: true }),
				}),
			],
			b19_list: [
				chart(1, {
					accAvg: "#3,611 / 70,388 · Top 5.1%",
					accRank: badge(),
				}),
				chart(2, { accAvg: "Avg: 99%" }),
				chart(3, { accRank: { pos: "", pct: "" } }),
			],
		},
		"b30",
		en,
		"Can't push",
	);
	const [p1, b1, b2, b3] = rowsOf(items).filter((row) => !row.empty);
	assert.equal(p1!.peerRank?.ap, true);
	assert.equal(p1!.peerRank?.pct, "AP 2.9%");
	assert.deepEqual(
		[b1!.peerRank?.pos, b1!.peerRank?.of, b1!.peerRank?.pct],
		["#3,611", "/ 70,388", "Top 5.1%"],
	);
	assert.equal(b1!.peerRankSide, undefined);
	assert.equal(b1!.avg, undefined);
	// Rows without a usable badge keep the peer average line
	assert.equal(b2!.peerRank, undefined);
	assert.equal(b2!.avg?.text, "99.0000%");
	assert.equal(b3!.peerRank, undefined);
});

test("with both populations the ±0.05 rank sits beside the first, under the RKS and push cells", () => {
	const all = badge();
	const band = badge({
		pos: "#12",
		of: "/ 400",
		pct: "Top 3.0%",
		tag: "±0.05",
	});
	const { items } = tableItems(
		{
			phi: [],
			b19_list: [
				chart(1, { accRank: all, accRanks: [all, band] }),
				chart(2, { accRank: band, accRanks: [band] }),
			],
		},
		"b30",
		en,
		"Can't push",
	);
	const [b1, b2] = rowsOf(items).filter((row) => !row.empty);
	assert.deepEqual(
		[b1!.peerRank?.tag, b1!.peerRank?.pos],
		[undefined, "#3,611"],
	);
	assert.deepEqual(
		[b1!.peerRankSide?.tag, b1!.peerRankSide?.pos, b1!.peerRankSide?.showOf],
		["±0.05", "#12", true],
	);
	// One line, even a band one, keeps the usual place under the acc
	assert.equal(b2!.peerRank?.tag, "±0.05");
	assert.equal(b2!.peerRankSide, undefined);
});

test("pushKey explains the push colours only when a target is shown", () => {
	const { items } = tableItems(
		{ phi: [], b19_list: [chart(1), chart(2, { suggest: "Can't push" })] },
		"b30",
		en,
		"Can't push",
	);
	assert.deepEqual(pushKey(items, en), [
		{ tier: "easy", text: "easy", sep: false },
		{ tier: "mid", text: "mid", sep: true },
		{ tier: "hard", text: "hard", sep: true },
	]);
	assert.deepEqual(
		pushKey(items, tableCopy("zh")).map((k) => k.text),
		["易", "中", "难"],
	);
	const none = tableItems(
		{ phi: [], b19_list: [chart(1, { suggest: "Can't push" })] },
		"b30",
		en,
		"Can't push",
	);
	assert.deepEqual(pushKey(none.items, en), []);
});

test("tipView breaks emoji tips into at most two measured lines", () => {
	const emoji =
		"啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥哎哎🤗哎哦哎嗯😋～哦哎🥳爱爱爱爱爱😍啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥嗯嗯👿滴嘚滴嘚😈唔😱嘟⬅️嘟↖️嘟⬆️嘟↗️嘟➡️嘟↘️嘟⬇️";
	const tip = tipView(emoji);
	assert.equal(tip.lines.length, 2);
	assert.equal(tip.cut, false);
	for (const line of tip.lines) assert.ok(lineEm(line) * tip.px <= 800);
	assert.equal(tip.lines.join(""), emoji);
	assert.deepEqual(tipView("Short tip"), {
		lines: ["Short tip"],
		px: 15,
		cut: false,
	});
	const long = tipView("word ".repeat(200));
	assert.equal(long.px, 13);
	assert.equal(long.lines.length, 2);
	assert.ok(long.lines[1]!.endsWith("…"));
	assert.deepEqual(tipView("  ").lines, []);
});

test("tableItems lays out b30: Phi band, P1-P3, Best band, overflow", () => {
	const phi = [
		chart(100, { acc: 100, score: 1_000_000, suggest: "Can't push" }),
		undefined,
		chart(101, { acc: 100 }),
	];
	const best = Array.from({ length: 33 }, (_, i) => chart(i));
	best[3]!.suggest = "Can't push";
	const { items, hasPush, mainCount } = tableItems(
		{ phi, b19_list: best },
		"b30",
		en,
		"Can't push",
	);
	assert.equal(hasPush, true);
	assert.equal(mainCount, 27);
	assert.deepEqual(
		items.slice(0, 5).map((it) => it.type),
		["band", "row", "row", "row", "band"],
	);
	const rows = rowsOf(items);
	assert.equal(rows.length, 36);
	assert.deepEqual(
		rows.slice(0, 4).map((r) => `${r.rankPre}${r.rankNum}`),
		["P1", "P2", "P3", "#1"],
	);
	assert.equal(rows[1]!.empty, true);
	assert.match(rows[1]!.cls, /is-empty/);
	assert.equal(rows[1]!.lines[0], en.emptyPhi);
	assert.equal(rows[0]!.accAp, true);
	assert.equal(rows[0]!.push, "");
	assert.equal(rows[0]!.pushText, "Can't push");
	assert.equal(rows[3]!.push, "99.7000%");
	assert.equal(rows[3]!.pushTier, "mid");
	assert.equal(rows[0]!.pushTier, "");
	assert.equal(rows[3 + 3]!.push, "");
	// Divider sits right after B27, then the overflow rows restart the zebra
	const divider = items.findIndex((it) => it.type === "divider");
	const before = items[divider - 1] as TableRow;
	const after = items[divider + 1] as TableRow;
	assert.equal(before.rankNum, "27");
	assert.equal(after.rankNum, "28");
	assert.match(after.cls, /is-over/);
	assert.doesNotMatch(after.cls, /is-alt/);
	assert.equal((items[divider] as { desc: string }).desc, en.overflowB30);
	assert.ok(!items.some((it) => it.type === "note"));
	assert.equal(rows[4]!.score, "989999");
	assert.equal(rows[4]!.scoreLead, "0");
	assert.equal(rows[4]!.acc, "99.5000%");
	assert.equal(rows[4]!.rks, "14.9900");
	assert.equal(rows[4]!.constant, "15.3");
	assert.equal(rows[4]!.lv, "in");
});

test("tableItems for x30 / fc30: no P rows, no push, numbered 1..n, sparse note", () => {
	const { items, hasPush } = tableItems(
		{ phi: undefined, b19_list: [chart(1), chart(2, { rank: "LEGACY" })] },
		"x30",
		en,
		"Can't push",
	);
	assert.equal(hasPush, false);
	assert.ok(!items.some((it) => it.type === "band"));
	const rows = rowsOf(items);
	assert.deepEqual(
		rows.map((r) => `${r.rankPre}${r.rankNum}`),
		["#1", "#2"],
	);
	assert.equal(rows[1]!.lv, "legacy");
	assert.deepEqual(items.at(-1), {
		type: "note",
		text: "2 of 30 slots filled",
	});
	const full = tableItems(
		{ b19_list: Array.from({ length: 31 }, (_, i) => chart(i)) },
		"fc30",
		en,
		"",
	).items;
	const divider = full.findIndex((it) => it.type === "divider");
	assert.equal((full[divider - 1] as TableRow).rankNum, "30");
	assert.equal((full[divider] as { desc: string }).desc, en.overflowTop);
	const none = tableItems({ b19_list: [] }, "fc30", en, "").items;
	assert.deepEqual(none, [{ type: "note", text: en.noRows }]);
});

test("analysisView sizes bars in px and pads sparse histograms", () => {
	assert.equal(analysisView(null, { hasPhi: true, copy: en, t: enT }), null);
	assert.equal(
		analysisView(
			{ histogram: { slots: [] } },
			{ hasPhi: true, copy: en, t: enT },
		),
		null,
	);
	const sparse = analysisView(
		{
			histogram: {
				slots: [
					{ label: "B1", rks: 16.9, kind: "best", height: 90 },
					{ label: "B2", rks: 14.6, kind: "best", height: 10 },
				],
				ticks: [
					{ label: "14.00", position: 0 },
					{ label: "17.00", position: 100 },
				],
				average: 15.7254,
				stddev: 1.1555,
				averagePosition: 55,
				count: 2,
			},
			showTags: false,
		},
		{ hasPhi: false, copy: en, t: enT },
	);
	assert.ok(sparse);
	// Padded to the 30 rows the x30 table holds above the Overflow line
	assert.equal(sparse.bars.length, 30);
	assert.deepEqual(
		sparse.bars.slice(0, 3).map((b) => [b.cls, b.label, b.h]),
		[
			["is-best", "1", Math.round(0.9 * HIST.plotH)],
			["is-best", "2", Math.round(0.1 * HIST.plotH)],
			["is-empty", "", 2],
		],
	);
	assert.equal(sparse.plotW, HIST.fullW - HIST.gutter);
	assert.equal(sparse.title, en.distribution);
	assert.deepEqual(sparse.legend, [{ cls: "is-best", text: "#1–#2" }]);
	assert.equal(sparse.average, "15.7254");
	assert.equal(sparse.stddev, "1.1555");
	assert.equal(sparse.count, "2 slots");
	assert.deepEqual(sparse.ticks.at(-1), { label: "17.00", bottom: HIST.plotH });
	assert.equal(sparse.tags, null);

	// fc30 with a full list: the histogram stops at #27 but the table shows 30
	// main rows, so the legend says so and no fake empty slots are added
	const fc30 = analysisView(
		{
			histogram: {
				slots: Array.from({ length: 27 }, (_, i) => ({
					label: `B${i + 1}`,
					kind: "best",
					height: 50,
				})),
			},
		},
		{ hasPhi: false, mainCount: 30, copy: en, t: enT },
	);
	assert.equal(fc30?.bars.length, 27);
	assert.deepEqual(fc30?.legend, [
		{ cls: "is-best", text: "#1–#27 of top 30" },
	]);
	const fc30zh = analysisView(
		{ histogram: { slots: [{ label: "B1", kind: "best", height: 50 }] } },
		{ hasPhi: false, mainCount: 30, copy: tableCopy("zh"), t: enT },
	);
	assert.equal(fc30zh?.legend[0]?.text, "前 30 中的 #1–#1");

	const full = analysisView(
		{
			histogram: {
				slots: [
					{ label: "P1", kind: "phi", height: 120 },
					...Array.from({ length: 29 }, (_, i) => ({
						label: `B${i + 1}`,
						kind: "best",
						height: -5,
					})),
				],
			},
			showTags: true,
			tagAnalysis: {
				totalVotes: 12.4,
				insufficient: false,
				strong: [{ name: "Stairs", rks: 15.554 }, { name: "" }],
				weak: [{ name: "One hand locked", rks: 15.17 }],
			},
			tagPoolNote: "Pools every score with chart RKS ≥ 16.3",
		},
		{ hasPhi: true, copy: en, t: enT },
	);
	assert.ok(full);
	assert.equal(full.bars.length, 30);
	assert.equal(full.bars[0]!.h, HIST.plotH);
	assert.equal(full.bars[1]!.h, 3);
	assert.equal(full.plotW, HIST.tagsW - HIST.gutter);
	assert.ok(full.slotW * 30 <= full.plotW);
	assert.deepEqual(
		full.legend.map((l) => l.text),
		["P1–P3", "#1–#29"],
	);
	assert.equal(full.title, en.analysis);
	assert.deepEqual(full.tags?.strong, [
		{ rank: "1", name: "Stairs", rks: "15.55" },
	]);
	// No tagMeta from the server side: fall back to the vote count
	assert.equal(full.tags?.meta, "Valid votes 12");
	assert.equal(full.tags?.px, tagFontPx(["Stairs", "One hand locked"]));
	assert.equal(full.tags?.insufficient, false);
	assert.equal(full.tags?.message, "");
	assert.equal(full.tags?.note, "Pools every score with chart RKS ≥ 16.3");

	const slots = [{ label: "B1", kind: "best", height: 50 }];
	const failed = analysisView(
		{
			histogram: { slots },
			showTags: true,
			tagAnalysis: null,
			tagMeta: "No data",
			tagMessage: "The chart-tag service did not answer in time.",
			tagPoolNote: "ignored",
		},
		{ hasPhi: false, copy: en, t: enT },
	);
	assert.deepEqual(
		failed?.tags && {
			meta: failed.tags.meta,
			insufficient: failed.tags.insufficient,
			message: failed.tags.message,
			note: failed.tags.note,
			strong: failed.tags.strong,
		},
		{
			meta: "No data",
			insufficient: true,
			message: "The chart-tag service did not answer in time.",
			note: "",
			strong: [],
		},
	);
	const thin = analysisView(
		{
			histogram: { slots },
			showTags: true,
			tagAnalysis: { insufficient: true, strong: [], weak: [] },
			tagMeta: "RKS≥16.3 · Scores 4 · Votes 2",
		},
		{ hasPhi: false, copy: en, t: enT },
	);
	assert.equal(thin?.tags?.meta, "RKS≥16.3 · Scores 4 · Votes 2");
	assert.equal(thin?.tags?.message, enT.tagInsufficient);
});

test("tagFontPx shares one size and never goes below 12px", () => {
	assert.equal(tagFontPx(["楼梯"]), 15);
	assert.ok(tagFontPx(["Flash / BPM Change", "Stairs"]) < 15);
	assert.equal(tagFontPx(["Fast interaction", "Stairs"]), 15);
	assert.equal(tagFontPx(["W".repeat(40)]), 12);
	assert.equal(tagFontPx([]), 15);
});

test("prepareTable hides meaningless header bits and localizes", () => {
	const data = {
		cardKind: "b30",
		phi: [chart(100, { acc: 100 }), undefined, undefined],
		b19_list: [chart(1)],
		gameuser: {
			avatar: "Introduction",
			ChallengeMode: 0,
			ChallengeModeRank: 0,
			rks: 16.561447,
			data: "0KiB",
			PlayerId: "",
		},
		stats: [
			{ title: "EZ", cleared: 1, fc: 2, phi: 3 },
			{ title: "HD", cleared: 4, fc: 5, phi: 6 },
			{ title: "IN", cleared: 7, fc: 8, phi: 9 },
			{ title: "AT", cleared: 10, fc: 11, phi: 12 },
		],
		hideRecordStats: true,
		rksStddev: 0.2604,
		spInfo: [],
		Date: "2026/09/21 09:54:58",
		b30Analysis: null,
	};
	const now = new Date("2026-10-06T03:34:00Z");
	const view = prepareTable(
		data,
		{ kind: "b30", locale: "en", tips: ["Only tip"] },
		now,
	);
	assert.equal(view.kind, "b30");
	assert.equal(view.title, "Best 30");
	assert.equal(view.challenge, null);
	assert.equal(view.dataText, "");
	assert.deepEqual(view.stats, []);
	assert.equal(view.nameHtml, "Guest");
	assert.equal(view.rks, "16.5614");
	assert.equal(view.sd, "±0.26");
	assert.equal(view.sdLabel, "B30 SD");
	assert.equal(view.saved, "2026/09/21 09:54:58");
	assert.equal(view.generated, "2026/10/06 11:34");
	assert.deepEqual(view.tip.lines, ["Only tip"]);
	assert.equal(view.hasPush, true);
	assert.deepEqual(
		view.pushKey.map((k) => k.tier),
		["easy", "mid", "hard"],
	);
	assert.equal(view.hasAvg, false);
	assert.equal(view.analysis, null);

	const zh = prepareTable(
		{
			...data,
			cardKind: "fc30",
			phi: undefined,
			hideRecordStats: false,
			spInfo: ["Full Combo Mode"],
			gameuser: {
				...data.gameuser,
				ChallengeMode: 3,
				ChallengeModeRank: 51,
				data: "600MiB 1012KiB",
			},
			tips: "固定提示",
			b19_list: [chart(1, { accAvg: "BAvg: 99.1%" })],
		},
		{ kind: "b30", locale: "zh" },
		now,
	);
	assert.equal(zh.kind, "fc30");
	assert.equal(zh.title, "FC30");
	assert.equal(zh.desc, "");
	assert.equal(zh.copy.colSong, "曲目");
	// The title already names the mode: no chip repeating it
	assert.deepEqual(zh.chips, []);
	// The fc30 list's spread is not the spread behind the account RKS: beside the
	// RKS it would read as one figure, so only the analysis panel shows it
	assert.equal(zh.sd, "");
	assert.deepEqual(zh.challenge, { mode: 3, rank: 51 });
	assert.equal(zh.dataText, "600MiB 1012KiB");
	assert.deepEqual(
		zh.stats.map((s) => [s.title, s.lv, s.cleared, s.fc, s.phi]),
		[
			["EZ", "ez", "1", "2", "3"],
			["HD", "hd", "4", "5", "6"],
			["IN", "in", "7", "8", "9"],
			["AT", "at", "10", "11", "12"],
		],
	);
	assert.equal(zh.hasPush, false);
	assert.deepEqual(zh.pushKey, []);
	assert.equal(zh.hasAvg, true);
	assert.equal(zh.avgLabel, "B30 均值");
	assert.deepEqual(zh.tip.lines, ["固定提示"]);
	assert.equal(rowsOf(zh.items)[0]!.pushText, "");
});

test("prepareTable in rank mode: Rank column label, no population note", () => {
	const data = {
		cardKind: "b30",
		phi: [chart(100, { acc: 100, accRank: badge({ pos: "#1", ap: true }) })],
		b19_list: [chart(1, { accRank: badge() }), chart(2)],
		gameuser: { rks: 16 },
	};
	const view = prepareTable(data, { kind: "b30", locale: "en" });
	assert.equal(view.hasAvg, true);
	assert.equal(view.avgLabel, "Rank");
	assert.deepEqual(view.chips, []);
	assert.equal("rankNote" in view, false);
	const zh = prepareTable(data, { kind: "b30", locale: "zh" });
	assert.equal(zh.avgLabel, "名次");
	const plain = prepareTable(
		{ ...data, phi: [], b19_list: [chart(1)] },
		{ kind: "b30", locale: "en" },
	);
	assert.equal(plain.hasAvg, false);
});
