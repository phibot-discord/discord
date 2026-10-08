import assert from "node:assert/strict";
import test from "node:test";
import type { Catalog } from "../catalog.ts";
import { textEm } from "../text-fit.ts";
import { lineEm } from "./b19-common.ts";
import {
	breakHtmlAt,
	buildAnalysis,
	buildChips,
	buildHistogram,
	buildRows,
	buildStats,
	buildTags,
	buildView,
	type ChartRowView,
	estimateHeight,
	fillTwoLines,
	fitChip,
	fitPlayerName,
	fitRank,
	fitSmall,
	fitTitle,
	GEOMETRY,
	kickerHeight,
	kindChipW,
	modeChips,
	nameLines,
	peerAverage,
	portraitCopy,
	portraitTip,
	type RowView,
	scoreDigits,
	splitName,
	splitTitle,
	tagNameLines,
	titleSplits,
	truncateEm,
	variant,
	wantsCompact,
} from "./b19-portrait.ts";

const en = portraitCopy("en");
const zh = portraitCopy("zh");

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
		num: i + 1,
		suggest: "99.7000%",
		...extra,
	};
}

const charts = (rows: RowView[]) =>
	rows.filter((r): r is ChartRowView => r.type === "chart");

const ctx = (kind: "b30" | "x30" | "fc30", locale: "en" | "zh" = "en") => ({
	kind,
	locale,
	catalog: {} as Catalog,
});

test("splitTitle breaks Latin titles at spaces, balanced when nothing else counts", () => {
	const [head, tail] = splitTitle("Compute It With Some Devilish Engines");
	assert.equal(`${head} ${tail}`, "Compute It With Some Devilish Engines");
	assert.ok(!head.endsWith(" ") && !tail.startsWith(" "));
	assert.ok(Math.abs(textEm(head) - textEm(tail)) < 3);
	// Hyphens inside words are not phrase marks
	assert.deepEqual(splitTitle("Non-Melodic Ragez"), ["Non-Melodic", "Ragez"]);
});

test("titleSplits keeps bracketed, ~ and - phrases on one line", () => {
	// Width of one 30 px line on the card, as fitTitle passes it
	const fitEm = (GEOMETRY.infoW * 0.95) / 30;
	const split = (text: string) => splitTitle(text, fitEm);
	assert.deepEqual(split("Parallel Retrogression(Game Ver.)"), [
		"Parallel Retrogression",
		"(Game Ver.)",
	]);
	assert.deepEqual(split("Avataar ~Reincarnation of Kalpa~"), [
		"Avataar",
		"~Reincarnation of Kalpa~",
	]);
	assert.deepEqual(split("G.V.N. (Glitter,Vomitus and Neon)"), [
		"G.V.N.",
		"(Glitter,Vomitus and Neon)",
	]);
	assert.deepEqual(split("Retribution ~ Cycle of Redemption ~"), [
		"Retribution",
		"~ Cycle of Redemption ~",
	]);
	assert.deepEqual(split("Silence is Golden, Speech is Golden"), [
		"Silence is Golden,",
		"Speech is Golden",
	]);
	// A phrase too wide for the line loses to a balanced break that fits
	assert.deepEqual(split("JunXion Between Life And Death(VIP Mix)"), [
		"JunXion Between Life",
		"And Death(VIP Mix)",
	]);
	// Best first; no line starts with a closer or ends with an opener
	const all = titleSplits("Song (Remix) ~Ver~ End", fitEm);
	// Two phrase breaks that both fit: the more balanced one
	assert.deepEqual([all[0]!.head, all[0]!.tail], ["Song (Remix)", "~Ver~ End"]);
	for (const s of all) {
		assert.ok(!/^\)/.test(s.tail) && !/(\(| ~)$/.test(s.head), s.head);
		assert.ok(s.tail !== "~ End", s.tail);
	}
});

test("splitTitle handles CJK titles and punctuation", () => {
	const fitEm = (GEOMETRY.infoW * 0.95) / 30;
	// The subtitle keeps its own line when it fits there
	assert.deepEqual(splitTitle("祈 -我ら神祖と共に歩む者なり-", fitEm), [
		"祈",
		"-我ら神祖と共に歩む者なり-",
	]);
	// Without phrase marks CJK text breaks anywhere, balanced
	const [head, tail] = splitTitle("我ら神祖と共に歩む者なり");
	assert.ok(Math.abs(textEm(head) - textEm(tail)) <= 1);
	assert.deepEqual(splitTitle("玩具狂奏曲 -終焉-"), ["玩具狂奏曲", "-終焉-"]);
	// Closing punctuation never starts the second line, openers never end the first
	for (const text of ["あいうえお、かきくけこ", "テスト（ライブ）です"]) {
		const [h, t] = splitTitle(text);
		assert.ok(!/^[、）]/.test(t), t);
		assert.ok(!/（$/.test(h), h);
	}
});

test("fitTitle: one line at 28–30 px, then two lines at 26–30 px, then an ellipsis", () => {
	assert.deepEqual(fitTitle("Stasis"), { lines: ["Stasis"], px: 30 });
	const two = fitTitle("Retribution ~ Cycle of Redemption ~");
	assert.equal(two.lines.length, 2);
	assert.ok(two.px >= 28 && two.px <= 30);
	const long = fitTitle(
		"Compute It With Some Devilish Alcoholic Steampunk Engines And Then Some More",
	);
	assert.equal(long.px, 26);
	assert.equal(long.lines.length, 2);
	assert.ok(long.lines[1]!.endsWith("…"));
	for (const line of long.lines)
		assert.ok(textEm(line) * 26 <= GEOMETRY.infoW, line);
	// Line one stays nearly full instead of backing off to an early space
	assert.ok(textEm(long.lines[0]!) * 26 >= GEOMETRY.infoW * 0.6);
	assert.deepEqual(fitTitle("   "), { lines: ["—"], px: 30 });
});

test("fitTitle shows the longest catalog titles in full on two lines", () => {
	for (const title of [
		"a truth seeker -Communication with Utopia will be lost-",
		"Compute It With Some Devilish Alcoholic Steampunk Engines",
	]) {
		const fit = fitTitle(title);
		assert.equal(fit.lines.length, 2, title);
		assert.equal(fit.lines.join(" "), title);
		assert.ok(fit.px >= 26 && fit.px < 28, `${fit.px}`);
		for (const line of fit.lines)
			assert.ok(textEm(line) * fit.px <= GEOMETRY.infoW, line);
	}
	assert.deepEqual(
		fitTitle("a truth seeker -Communication with Utopia will be lost-").lines,
		["a truth seeker -Communication", "with Utopia will be lost-"],
	);
	// Phrase breaks keep the full 30 px
	assert.deepEqual(fitTitle("Parallel Retrogression(Game Ver.)"), {
		lines: ["Parallel Retrogression", "(Game Ver.)"],
		px: 30,
	});
});

test("fillTwoLines fills line one at a word break and ellipsizes the rest", () => {
	assert.deepEqual(fillTwoLines("short", 10), ["short"]);
	const [first, second] = fillTwoLines(
		"alpha beta gamma delta epsilon zeta",
		8,
	);
	assert.ok(textEm(first!) <= 8 && !first!.endsWith(" "));
	assert.ok(second!.endsWith("…") && textEm(second!) <= 8);
	assert.equal(fillTwoLines("alpha beta", 100).length, 1);
	// The last space would leave line one under 70% full: cut mid-word instead
	const [mid] = fillTwoLines("ab cdefghijklmnopqrstuvwxyz0123456789", 8);
	assert.ok(mid!.startsWith("ab cdefg"), mid!);
	assert.ok(textEm(mid!) > 7 && textEm(mid!) <= 8);
	// A cut that already lands on a space keeps the whole first line
	const head = "alpha beta";
	const [exact] = fillTwoLines(`${head} gamma delta`, textEm(head) + 0.05);
	assert.equal(exact, head);
});

test("truncateEm keeps short text and ellipsizes long text within the width", () => {
	assert.equal(truncateEm("abc", 10), "abc");
	const cut = truncateEm("abcdefghijklmnopqrstuvwxyz", 5);
	assert.ok(cut.endsWith("…"));
	assert.ok(textEm(cut) <= 5);
});

test("splitName balances at spaces, CJK boundaries or mid-word", () => {
	assert.deepEqual(splitName("Rainbow Super Long Name"), [
		"Rainbow Super",
		"Long Name",
	]);
	const [a, b] = splitName("RainbowSuperLongPlayerName_9876543210");
	assert.equal(a + b, "RainbowSuperLongPlayerName_9876543210");
	assert.ok(Math.abs(textEm(a) - textEm(b)) < 1);
	// One space far from the middle loses to a mid-word break
	const [c] = splitName("A VeryLongNameWithoutAnySpaces1234567");
	assert.notEqual(c, "A");
});

test("breakHtmlAt inserts a <br> at a visible character, skipping tags and entities", () => {
	assert.equal(
		breakHtmlAt('<span style="color:#f00">ab</span><b>cd</b>', 3),
		'<span style="color:#f00">ab</span><b>c<br>d</b>',
	);
	assert.equal(breakHtmlAt("a&amp;b", 2), "a&amp;<br>b");
	assert.equal(breakHtmlAt("ab", 9), "ab");
});

test("fitPlayerName: one line, then two lines via <br>, then cut plain text", () => {
	assert.deepEqual(fitPlayerName("Mizuki"), {
		px: 42,
		multi: false,
		html: "Mizuki",
	});
	assert.deepEqual(fitPlayerName("  "), { px: 42, multi: false, html: "—" });
	const rich =
		'<span style="color:#f00">Rainbow</span><b>SuperLongPlayerName</b>_9876543210';
	const long = fitPlayerName(rich);
	assert.equal(long.multi, true);
	assert.ok(long.px >= 22 && long.px <= 32);
	// The break goes inside the HTML, which keeps its colours
	assert.equal(long.html.replace("<br>", ""), rich);
	assert.deepEqual(
		nameLines(long.html).join(""),
		"RainbowSuperLongPlayerName_9876543210",
	);
	for (const line of nameLines(long.html))
		assert.ok(textEm(line) * long.px <= GEOMETRY.nameW, line);
	const multi = fitPlayerName("first line<br><i>second</i>");
	assert.deepEqual(multi, {
		px: 32,
		multi: true,
		html: "first line<br><i>second</i>",
	});
	// Five explicit lines would be too small: joined into one line of plain text
	assert.deepEqual(fitPlayerName("a<br>b<br>c<br>d<br>e"), {
		px: 42,
		multi: false,
		html: "a b c d e",
	});
	const huge = fitPlayerName(`<b>${"VeryLongName_".repeat(12)}</b>`);
	assert.equal(huge.px, 22);
	assert.equal(huge.multi, true);
	assert.ok(!huge.html.includes("<b>"));
	assert.ok(huge.html.endsWith("…"));
	assert.equal(fitPlayerName("x\ny").html, "x y");
	assert.deepEqual(nameLines("a &amp; b<br/>  <b>c</b>"), ["a & b", "c"]);
});

test("peerAverage reads every accAvg format", () => {
	assert.deepEqual(peerAverage("Avg: 99.1234%", 99.5, en), {
		texts: ["avg 99.12%", "99.12%"],
		dir: "up",
	});
	assert.deepEqual(peerAverage("BAvg: 99.9900%", 99.5, en), {
		texts: ["B30 avg 99.99%", "99.99%"],
		dir: "down",
	});
	assert.deepEqual(peerAverage(98.5, 99, zh).texts, ["均值 98.50%", "98.50%"]);
	assert.deepEqual(peerAverage("Top 1.23% / 4.56%", 99, en), {
		texts: ["Top 1.23% / 4.56%", "Top 1.23%"],
		dir: "",
	});
	assert.deepEqual(peerAverage("#3,611 / 70,388 · Top 5.1%", 99, en).texts, [
		"#3,611 / 70,388 · Top 5.1%",
		"Top 5.1%",
	]);
	assert.deepEqual(peerAverage(undefined, 99, en), { texts: [], dir: "" });
	assert.deepEqual(peerAverage("", 99, en), { texts: [], dir: "" });
});

test("fitSmall falls back to shorter candidates, then ellipsizes", () => {
	assert.deepEqual(fitSmall(["avg 99.12%", "99.12%"], 300), {
		text: "avg 99.12%",
		px: 20,
	});
	assert.equal(fitSmall(["avg 99.12%", "99.12%"], 80).text, "99.12%");
	const cut = fitSmall(["a very long label that cannot fit"], 60);
	assert.equal(cut.px, 18);
	assert.ok(cut.text.endsWith("…"));
});

test("fitChip keeps bold for normal chips and drops it for LEGACY", () => {
	assert.deepEqual(fitChip("AT 16.8"), { px: 22, thin: false });
	const legacy = fitChip("LEGACY 15.2");
	assert.equal(legacy.px, 18);
	assert.equal(legacy.thin, true);
	assert.ok(textEm("LEGACY 15.2") * 18 <= GEOMETRY.chipTextW);
});

test("buildRows: b30 has gold P rows, empty slots and the OVERFLOW after B27", () => {
	const best = Array.from({ length: 33 }, (_, i) => chart(i));
	const rows = buildRows(
		{ phi: [chart(100, { score: 1e6, acc: 100, Rating: "phi" }), undefined] },
		"b30",
		en,
	);
	assert.deepEqual(
		rows.map((r) => (r.type === "chart" ? r.label : r.type)),
		["P1", "empty", "empty"],
	);
	const full = buildRows({ phi: [chart(100)], b19_list: best }, "b30", en);
	const over = full.findIndex((r) => r.type === "overflow");
	// P1 + two empty slots + B1..B27, then the divider
	assert.equal(over, 3 + 27);
	assert.deepEqual(full[over], { type: "overflow", note: en.overflowNoteB30 });
	const list = charts(full);
	assert.equal(list[0]!.gold, true);
	assert.equal(list[1]!.label, "#1");
	assert.equal(list[1]!.gold, false);
	assert.equal(list[27]!.over, false);
	assert.equal(list[28]!.over, true);
	assert.equal(list[28]!.label, "#28");
});

test("buildRows formats values and hides push where it means nothing", () => {
	const [ap, normal, stuck] = charts(
		buildRows(
			{
				phi: [],
				b19_list: [
					chart(0, {
						score: 1e6,
						acc: 100,
						Rating: "phi",
						suggest: "Can't push",
					}),
					chart(1, {
						acc: 99.61803,
						rks: 17.00759,
						difficulty: 17.3,
						rank: "AT",
					}),
					chart(2, { suggest: "Can't push" }),
				],
			},
			"b30",
			en,
		),
	);
	assert.equal(ap!.push, "");
	assert.equal(ap!.rating, "phi");
	assert.equal(normal!.acc, "99.6180%");
	assert.equal(normal!.rks, "17.0076");
	assert.equal(normal!.rankText, "AT");
	assert.equal(normal!.constText, "17.3");
	assert.equal(normal!.rankCls, "at");
	assert.equal(normal!.push, "99.7000%");
	assert.equal(normal!.pushMuted, false);
	assert.equal(stuck!.push, "Can't push");
	assert.equal(stuck!.pushMuted, true);
	assert.equal(normal!.score, "989999");
	assert.equal(normal!.digits.map((d) => d.c).join(""), "0989999");
	assert.equal(ap!.digits.filter((d) => d.pad).length, 0);
	const x30 = charts(buildRows({ b19_list: [chart(0)] }, "x30", en));
	assert.equal(x30[0]!.push, "");
});

test("buildRows: x30 / fc30 cut at 30 and survive junk rows", () => {
	const best = Array.from({ length: 32 }, (_, i) => chart(i));
	const rows = buildRows({ b19_list: best }, "fc30", en);
	const over = rows.findIndex((r) => r.type === "overflow");
	assert.equal(over, 30);
	assert.deepEqual(rows[over], { type: "overflow", note: en.overflowNote });
	const junk = buildRows(
		{ b19_list: [null, { song: 5, score: "x", Rating: "??", rank: "ZZ" }] },
		"x30",
		en,
	);
	const [row] = charts(junk);
	assert.equal(row!.score, "—");
	assert.equal(row!.rating, "");
	assert.equal(row!.rankCls, "unknown");
	assert.equal(row!.label, "#2");
	assert.deepEqual(buildRows({}, "x30", en), []);
});

test("buildRows fits the peer average beside accuracy and push", () => {
	const [row] = charts(
		buildRows(
			{ phi: [], b19_list: [chart(0, { accAvg: "Avg: 99.1234%" })] },
			"b30",
			en,
		),
	);
	assert.equal(row!.peer, "avg 99.12%");
	assert.equal(row!.peerDir, "up");
	assert.ok(row!.peerPx >= 18 && row!.peerPx <= 20);
});

test("buildHistogram lays out bars and relabels x30 slots", () => {
	assert.equal(buildHistogram({ slots: [{}, {}] }, "b30"), null);
	const slots = [
		...[1, 2, 3].map((i) => ({ label: `P${i}`, kind: "phi", height: 80 })),
		...Array.from({ length: 27 }, (_, i) => ({
			label: `B${i + 1}`,
			kind: "best",
			height: 100 - i * 3,
		})),
	];
	const ticks = [0, 50, 100].map((p) => ({ label: `${p}`, position: p }));
	const b30 = buildHistogram({ slots, ticks, averagePosition: 50 }, "b30")!;
	assert.equal(b30.bars.length, 30);
	assert.equal(b30.bars[0]!.gold, true);
	assert.equal(b30.bars[3]!.height, GEOMETRY.plotH);
	assert.equal(b30.avgBottom, GEOMETRY.plotH / 2);
	assert.equal(b30.legendPhi, "P1–P3");
	assert.equal(b30.legendBest, "B1–B27");
	assert.equal(b30.xLabels[0]!.text, "P1");
	assert.equal(b30.xLabels.at(-1)!.text, "B27");
	for (const bar of b30.bars)
		assert.ok(bar.left >= 0 && bar.left + bar.width <= GEOMETRY.plotW);
	for (const label of b30.xLabels)
		assert.ok(
			label.left >= 0 && label.left + GEOMETRY.xLabelW <= GEOMETRY.plotW,
		);
	const x30 = buildHistogram({ slots: slots.slice(3), ticks }, "x30")!;
	assert.equal(x30.legendPhi, "");
	assert.equal(x30.legendBest, "#1–#27");
	assert.ok(x30.xLabels.every((l) => l.text.startsWith("#")));
});

test("buildAnalysis: titles, tags, pool note and failure message", () => {
	assert.equal(buildAnalysis(null, "b30", en), null);
	assert.equal(buildAnalysis({ histogram: { count: 0 } }, "b30", en), null);
	const base = {
		histogram: { count: 27, average: 15.75301, stddev: 0.82449, slots: [] },
		showTags: true,
		tagAnalysis: {
			insufficient: false,
			strong: [{ name: "Fast tapping", rks: 16.921 }],
			weak: [{ name: "Stamina", rks: 15.1 }],
		},
		tagMeta: "RKS≥16.3 · Scores 41 · Votes 1234",
		tagPoolNote: "",
	};
	const fc = buildAnalysis(base, "fc30", en)!;
	assert.equal(fc.title, "TOP 27 ANALYSIS");
	assert.equal(fc.average, "15.7530");
	// Two decimals, like the header's ±
	assert.equal(fc.stddev, "±0.82");
	// The meta line fits beside the heading unless both are long
	assert.equal(fc.tagMetaWraps, false);
	const longMeta = buildAnalysis(
		{ ...base, tagMeta: `${base.tagMeta} · ${base.tagMeta}` },
		"b30",
		en,
		"Chart skills",
	)!;
	assert.equal(longMeta.tagMetaWraps, true);
	assert.equal(fc.tagsOk, true);
	assert.deepEqual(fc.strong[0], {
		rank: 1,
		lines: ["Fast tapping"],
		rks: "16.92",
	});
	assert.equal(fc.tagPx, 22);
	assert.equal(fc.tagNote, en.tagsOtherList);
	const b30 = buildAnalysis(
		{ ...base, tagPoolNote: "Pools every score" },
		"b30",
		zh,
	)!;
	assert.equal(b30.title, zh.analysisB30);
	assert.equal(b30.tagNote, "Pools every score");
	const failed = buildAnalysis(
		{ ...base, tagAnalysis: null, tagMessage: "Try again" },
		"b30",
		en,
	)!;
	assert.equal(failed.tagsOk, false);
	assert.equal(failed.tagMessage, "Try again");
});

test("buildTags shares one size and wraps long names onto two lines", () => {
	const short = buildTags([{ name: "Flick", rks: 16.7 }], [{ name: "耐力" }]);
	assert.equal(short.px, 22);
	assert.deepEqual(short.weak[0], { rank: 1, lines: ["耐力"], rks: "—" });
	const long = buildTags(
		[
			{ name: "Flick", rks: 16.7 },
			{ name: "Long holds with drags and flicks", rks: 16.5 },
		],
		null,
	);
	assert.equal(long.px, 20);
	assert.deepEqual(long.strong[0]!.lines, ["Flick"]);
	assert.equal(long.strong[1]!.lines.length, 2);
	for (const line of long.strong[1]!.lines)
		assert.ok(textEm(line) * 20 <= GEOMETRY.tagNameW, line);
	assert.deepEqual(long.weak, []);
	// Pairs keep the n-th strength and weakness level; the taller one sets the row
	assert.deepEqual(
		long.pairs.map((p) => [p.strong?.rank, p.weak?.rank, p.lines]),
		[
			[1, undefined, 1],
			[2, undefined, 2],
		],
	);
	const mixed = buildTags(
		[{ name: "Flash / BPM Change", rks: 16.92 }, { name: "Burst" }],
		[{ name: "Nonlinear" }, { name: "Line noise" }, { name: "Locked finger" }],
	);
	assert.deepEqual(mixed.strong[0]!.lines, ["Flash /", "BPM Change"]);
	assert.deepEqual(
		mixed.pairs.map((p) => p.lines),
		[2, 1, 1],
	);
	assert.equal(mixed.pairs[2]!.strong, null);
	assert.equal(mixed.pairs[0]!.weak!.lines[0], "Nonlinear");
	const many = buildTags(
		Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, rks: i })),
		[],
	);
	assert.equal(many.strong.length, 5);
	const huge = tagNameLines("x".repeat(60), 20);
	assert.equal(huge.length, 2);
	assert.ok(huge[1]!.endsWith("…"));
	const words = tagNameLines("An extremely long tag name for testing", 20);
	assert.equal(words.length, 2);
	assert.equal(words[0], "An extremely");
	assert.ok(!words[0]!.endsWith("…"));
});

test("buildStats keeps the C / FC / Phi grid in column order", () => {
	const stats = buildStats(
		["EZ", "HD", "IN", "AT"].map((title, i) => ({
			title,
			cleared: 10 + i,
			fc: i,
			phi: undefined,
		})),
		en,
	)!;
	assert.deepEqual(
		stats.cols.map((c) => c.cls),
		["ez", "hd", "in", "at"],
	);
	assert.deepEqual(stats.rows[0]!.cells, ["10", "11", "12", "13"]);
	assert.deepEqual(stats.rows[2]!.cells, ["0", "0", "0", "0"]);
	assert.equal(stats.rows[2]!.label, "Phi");
	assert.equal(buildStats(undefined, en), null);
});

test("buildChips fits mode labels to the kicker room and drops empty ones", () => {
	const title = en.kindTitle.fc30;
	assert.deepEqual(buildChips(["1 Good Mode", ""], title), [
		{ lines: ["1 Good Mode"], px: 22 },
	]);
	const full = GEOMETRY.kickerW - GEOMETRY.chipPadW;
	const room = full - kindChipW(title) - GEOMETRY.kickerGap;
	// Uses the whole room beside the title: a fixed 300 px chip would cut this
	const label = "Full Combo Mode · Only full-combo charts";
	assert.ok(textEm(label) * 18 > 300);
	const [beside] = buildChips([label], title);
	assert.deepEqual(beside!.lines, [label]);
	assert.ok(beside!.px >= 18 && textEm(label) * beside!.px <= room);
	assert.equal(kickerHeight(title, [beside!]), 36);
	// Too long for the room: the chip moves to its own line at full width
	const longer = `${label} on this card`;
	const [wrapped] = buildChips([longer], title);
	assert.deepEqual(wrapped!.lines, [longer]);
	assert.ok(textEm(longer) * wrapped!.px > room);
	assert.ok(textEm(longer) * wrapped!.px <= full);
	assert.equal(kickerHeight(title, [wrapped!]), 36 + 10 + 36);
	// Too long for a full line: two lines at that width, nothing cut
	const two = `${longer}, and a second sentence that explains the filter`;
	const [split] = buildChips([two], title);
	assert.equal(split!.lines.length, 2);
	assert.equal(split!.lines.join(" "), two);
	assert.ok(split!.px >= 18);
	for (const line of split!.lines)
		assert.ok(textEm(line) * split!.px <= full, line);
	assert.equal(
		kickerHeight(title, [split!]),
		36 + 10 + 2 * split!.px * 1.2 + 7,
	);
	// Beyond two full lines the second one is ellipsized
	const [cut] = buildChips(["x".repeat(160)], title);
	assert.equal(cut!.px, 18);
	assert.equal(cut!.lines.length, 2);
	assert.ok(cut!.lines[1]!.endsWith("…"));
	for (const line of cut!.lines) assert.ok(textEm(line) * 18 <= full);
	assert.deepEqual(buildChips(undefined, title), []);
});

test("modeChips drops the x30 / fc30 mode labels: the title names the mode", () => {
	assert.deepEqual(modeChips(["FC30", "ACC 限制为 99%", "性30", 5]), [
		"ACC 限制为 99%",
		"5",
	]);
	assert.deepEqual(modeChips(["x30", " "]), []);
	assert.deepEqual(modeChips(null), []);
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

test("buildRows gives rank-mode rows a rank line from accRank, not accAvg", () => {
	const rows = charts(
		buildRows(
			{
				phi: [
					chart(0, {
						acc: 100,
						score: 1e6,
						accRank: badge({ pos: "#1", pct: "AP 2.9%", ap: true }),
					}),
				],
				b19_list: [
					chart(1, {
						accAvg: "#3,611 / 70,388 · Top 5.1%",
						accRank: badge(),
					}),
					chart(2, { accAvg: "Avg: 99.1234%" }),
				],
			},
			"b30",
			en,
		),
	);
	const [p1, b1, b2] = rows;
	assert.equal(p1!.peerRanks[0]?.ap, true);
	assert.equal(p1!.peerRanks[0]?.pct, "AP 2.9%");
	assert.deepEqual(
		b1!.peerRanks.map((r) => [r.pos, r.of, r.pct, r.px, r.showOf]),
		[["#3,611", "/ 70,388", "Top 5.1%", 20, true]],
	);
	// The rank has its own line: no peer badge beside the accuracy
	assert.equal(b1!.peer, "");
	assert.deepEqual(b2!.peerRanks, []);
	assert.equal(b2!.peer, "avg 99.12%");
});

test("buildRows gives a row with both populations two rank lines, the ±0.05 one labelled", () => {
	const all = badge();
	const band = badge({
		pos: "#12",
		of: "/ 400",
		pct: "Top 3.0%",
		tag: "±0.05",
	});
	const [b1] = charts(
		buildRows(
			{
				phi: [],
				b19_list: [chart(1, { accRank: all, accRanks: [all, band] })],
			},
			"b30",
			en,
		),
	);
	assert.deepEqual(
		b1!.peerRanks.map((r) => [r.tag, r.pos, r.showOf]),
		[
			[undefined, "#3,611", true],
			["±0.05", "#12", true],
		],
	);
});

test("fitRank shrinks to 18 px, then drops the record count", () => {
	const lineW = (r: ReturnType<typeof fitRank>) =>
		(textEm(r.pos) * r.px) / 0.88 +
		(r.showOf ? textEm(r.of) * r.px + 6 : 0) +
		14 +
		textEm(r.pct) * r.px;
	const big = {
		pos: "#1,234,567",
		of: "/ 9,876,543",
		pct: "Top 12.5%",
		ap: false,
	};
	assert.equal(fitRank(big).px, 20);
	const wide = fitRank(big, 360);
	assert.equal(wide.px, 18);
	assert.equal(wide.showOf, true);
	assert.ok(lineW(wide) <= 360 * 0.95);
	const narrow = fitRank(big, 250);
	assert.equal(narrow.showOf, false);
	assert.equal(narrow.px, 18);
});

test("portraitTip: two measured lines at most, emoji kept whole", () => {
	const emoji =
		"啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥哎哎🤗哎哦哎嗯😋～哦哎🥳爱爱爱爱爱😍啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥嗯嗯👿滴嘚滴嘚😈唔😱嘟⬅️嘟↖️嘟⬆️嘟↗️嘟➡️嘟↘️嘟⬇️";
	const tip = portraitTip(emoji);
	assert.equal(tip.lines.length, 2);
	assert.equal(tip.px, 18);
	assert.equal(tip.cut, true);
	assert.ok(tip.lines[1]!.endsWith("…"));
	for (const line of tip.lines)
		assert.ok(lineEm(line) * tip.px <= GEOMETRY.tipW * 0.95);
	assert.ok(emoji.startsWith(tip.lines.join("").slice(0, -1)));
	// The shortened review sample fits one line at full size
	assert.deepEqual(portraitTip("啊🤪～啊🤪～啊咦😬…嘟⬇️"), {
		lines: ["啊🤪～啊🤪～啊咦😬…嘟⬇️"],
		px: 22,
		cut: false,
	});
	// No tip given: one from the catalog; none at all: no lines
	assert.deepEqual(portraitTip(undefined, ["Only tip"]).lines, ["Only tip"]);
	assert.deepEqual(portraitTip("", []).lines, []);
});

test("scoreDigits pads to seven digits like the game", () => {
	assert.equal(
		scoreDigits("977992")
			.map((d) => (d.pad ? `(${d.c})` : d.c))
			.join(""),
		"(0)977992",
	);
	assert.equal(scoreDigits("1000000").filter((d) => d.pad).length, 0);
	assert.equal(scoreDigits("0").filter((d) => d.pad).length, 6);
	assert.deepEqual(scoreDigits("—"), []);
	assert.deepEqual(scoreDigits("12345678"), []);
});

test("buildView: header for a normal save", () => {
	const { pv, vt } = buildView(
		{
			gameuser: {
				avatar: "Cipher1",
				ChallengeMode: 5,
				ChallengeModeRank: 51,
				rks: 16.56143,
				data: "600MiB 1012KiB",
				PlayerId: "Mizuki",
			},
			Date: "2026/09/21 09:54:58",
			rksStddev: 0.2283,
			spInfo: [],
			phi: [chart(0, { accAvg: "Avg: 99%" })],
			b19_list: [chart(1)],
			stats: [{ title: "EZ", cleared: 1, fc: 1, phi: 1 }],
		},
		ctx("b30"),
	);
	assert.equal(vt, en);
	assert.equal(pv.title, "BEST 30");
	assert.equal(pv.rks, "16.5614");
	assert.equal(pv.sd, "±0.23");
	assert.deepEqual(pv.challenge, { mode: "5", level: "51" });
	assert.equal(pv.dataSize, "600MiB 1012KiB");
	assert.equal(pv.date, "2026/09/21 09:54:58");
	assert.equal(pv.legendScore, en.legendScorePeer);
	assert.equal(pv.legendRks, en.legendRks);
	assert.ok(pv.stats);
	assert.equal(pv.noCharts, false);
});

test("buildView in rank mode: Rank legend, no population note, a rank line per badge", () => {
	const data = {
		gameuser: { rks: 16, PlayerId: "Mizuki" },
		phi: [chart(0, { accRank: badge({ pos: "#1", ap: true }) })],
		b19_list: [chart(1, { accRank: badge() }), chart(2)],
		tips: "Fixed",
	};
	const { pv } = buildView(data, ctx("b30"));
	assert.equal(pv.legendScore, en.legendScoreRank);
	assert.deepEqual(pv.chips, []);
	assert.equal("rankNote" in pv, false);
	assert.deepEqual(pv.tip.lines, ["Fixed"]);
	const cn = buildView(data, ctx("b30", "zh")).pv;
	assert.equal(cn.legendScore, "分数 · ACC · 名次");
	// Rank lines are counted: 26 px per line
	const bare = buildView(
		{ ...data, phi: [chart(0)], b19_list: [chart(1), chart(2)] },
		ctx("b30"),
	).pv;
	assert.equal(estimateHeight(pv) - estimateHeight(bare), 2 * 26);
	const band = badge({ pos: "#12", tag: "±0.05" });
	const both = buildView(
		{
			...data,
			b19_list: [
				chart(1, { accRank: badge(), accRanks: [badge(), band] }),
				chart(2),
			],
		},
		ctx("b30"),
	).pv;
	assert.equal(estimateHeight(both) - estimateHeight(bare), 3 * 26);
	// Compact one-line rows sit at their 104 px minimum; a rank line makes them
	// 66 + 24 + 32 = 122 px
	assert.equal(
		estimateHeight(pv, true) - estimateHeight(bare, true),
		2 * (122 - 104),
	);
});

test("buildView hides manual-mode noise, record stats and empty lists", () => {
	const { pv } = buildView(
		{
			gameuser: {
				ChallengeMode: 0,
				ChallengeModeRank: 0,
				rks: 12,
				data: "0KiB",
				PlayerId: "",
			},
			hideRecordStats: true,
			stats: [{ title: "EZ" }],
			spInfo: ["1 Good Mode"],
			b19_list: [],
			rksStddev: 1.16,
		},
		ctx("x30", "zh"),
	);
	assert.equal(pv.title, zh.kindTitle.x30);
	assert.equal(pv.challenge, null);
	assert.equal(pv.dataSize, "");
	// The x30 list's spread is not the spread behind the player's RKS
	assert.equal(pv.sd, "");
	assert.equal(pv.stats, null);
	assert.equal(pv.nameHtml, "—");
	const cut = buildView(
		{ gameuser: { PlayerId: `<b>${"&lt;&amp;&gt;_".repeat(40)}</b>` } },
		ctx("b30"),
	).pv;
	assert.ok(cut.nameHtml.startsWith("&lt;&amp;&gt;_"));
	assert.ok(!cut.nameHtml.includes("<b>"));
	assert.equal(cut.nameMulti, true);
	assert.equal(pv.noCharts, true);
	assert.equal(pv.legendRks, zh.legendRksOnly);
	// The mode label is dropped: the title ("性30") already names the filter
	assert.deepEqual(pv.chips, []);
	assert.equal(pv.analysis, null);
});

function b30Save(count: number, song: (i: number) => string, tags = false) {
	const slots = Array.from({ length: 30 }, (_, i) => ({
		label: i < 3 ? `P${i + 1}` : `B${i - 2}`,
		kind: i < 3 ? "phi" : "best",
		height: 50,
	}));
	const tag = (name: string, i: number) => ({ name: `${name} ${i}`, rks: 16 });
	return {
		gameuser: {
			avatar: "Cipher1",
			ChallengeMode: 5,
			ChallengeModeRank: 51,
			rks: 16.56,
			data: "600MiB 1012KiB",
			PlayerId: "Mizuki",
		},
		Date: "2026/09/21 09:54:58",
		stats: ["EZ", "HD", "IN", "AT"].map((title) => ({ title, cleared: 1 })),
		phi: [0, 1, 2].map((i) => chart(i, { song: song(i) })),
		b19_list: Array.from({ length: count }, (_, i) =>
			chart(i + 3, { song: song(i + 3) }),
		),
		b30Analysis: {
			histogram: { count: 30, average: 16, stddev: 0.2, slots, ticks: [] },
			showTags: tags,
			tagMeta: tags ? "RKS≥16.3 · Scores 41 · Votes 1234" : "",
			tagPoolNote: tags ? "Pools every score with chart RKS ≥ 16.3." : "",
			tagAnalysis: tags
				? {
						strong: [1, 2, 3, 4, 5].map((i) => tag("Strong", i)),
						weak: [1, 2, 3, 4, 5].map((i) => tag("Weak", i)),
					}
				: null,
		},
	};
}

test("estimateHeight matches the measured layout; compact only rescues 2x paint", () => {
	const wrapped = "Retribution ~ Cycle of Redemption ~";
	assert.equal(fitTitle(wrapped).px, 30);
	// The default render of data/raw-save.json: 3 P + 33 B rows, 4 of them on two
	// lines, the histogram, no tags: 5656 px measured, 24 px of it engine slack
	const real = buildView(
		b30Save(33, (i) => ([5, 18, 20, 23].includes(i) ? wrapped : `Song ${i}`)),
		ctx("b30"),
	).pv;
	assert.ok(
		Math.abs(estimateHeight(real) - 5632) <= 8,
		`${estimateHeight(real)}`,
	);
	assert.equal(real.compact, false);
	assert.ok(estimateHeight(real, true) < estimateHeight(real));
	// Every title on two lines plus the tag panel would paint at 1x without it
	const tall = buildView(
		b30Save(33, () => wrapped, true),
		ctx("b30"),
	).pv;
	assert.ok(estimateHeight(tall) > 6460);
	assert.ok(estimateHeight(tall, true) <= 6460);
	// 36 two-line rows: 80 + 2 × 33 px normal, 66 + 2 × 32 px compact; the gap shrinks 3 px per row and divider
	assert.equal(
		estimateHeight(tall) - estimateHeight(tall, true),
		36 * (146 - 130) + 37 * 3,
	);
	assert.equal(wantsCompact(tall), true);
	assert.equal(tall.compact, true);
	// Count 99 is far past the budget either way: normal spacing
	const huge = buildView(
		b30Save(99, (i) => `Song ${i}`),
		ctx("b30"),
	).pv;
	assert.ok(estimateHeight(huge, true) > 6460);
	assert.equal(huge.compact, false);
	// A long spInfo label that wraps the kicker adds a line, a two-line chip more
	const plain = buildView(
		b30Save(2, (i) => `Song ${i}`),
		ctx("fc30"),
	).pv;
	const withChip = (label: string) =>
		buildView(
			{ ...b30Save(2, (i) => `Song ${i}`), spInfo: [label] },
			ctx("fc30"),
		).pv;
	const own = withChip("Full Combo Mode · Only full-combo charts on this card");
	assert.equal(estimateHeight(own) - estimateHeight(plain), 46);
	const twoLines = withChip("x ".repeat(120));
	assert.equal(twoLines.chips[0]!.lines.length, 2);
	assert.equal(estimateHeight(twoLines) - estimateHeight(plain), 60);
	// A wrapped rich-text name outgrows the avatar (measured: id block 156 px)
	const named = b30Save(2, (i) => `Song ${i}`);
	named.gameuser.PlayerId =
		'<span style="color:#ff7b9c">Rainbow</span><b>SuperLongPlayerName</b>_<i>9876543210</i>';
	const rich = buildView(named, ctx("fc30")).pv;
	assert.equal(rich.nameMulti, true);
	assert.equal(estimateHeight(rich) - estimateHeight(plain), 156 - 132);
});

test("variant.prepare merges the view into the template data", async () => {
	assert.equal(variant.tpl, "b19-portrait");
	assert.equal(variant.width, GEOMETRY.cardW);
	const out = (await variant.prepare!({ tips: "hi" }, ctx("fc30"))) as Record<
		string,
		unknown
	>;
	assert.equal(out.tips, "hi");
	assert.ok(out.pv && out.vt);
});
