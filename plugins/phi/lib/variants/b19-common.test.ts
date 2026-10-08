import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { textEm } from "../text-fit.ts";
import {
	clipLine,
	fitTip,
	graphemeEm,
	graphemes,
	isEmojiImage,
	lineEm,
	pickTip,
	rankLines,
	rankParts,
	wrapLines,
} from "./b19-common.ts";

const EMOJI_TIP =
	"啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥哎哎🤗哎哦哎嗯😋～哦哎🥳爱爱爱爱爱😍啊🤪～啊🤪～啊咦😬啊咦😬啊→啊↑啊↓😨啊😰～嗯💥嗯嗯👿滴嘚滴嘚😈唔😱嘟⬅️嘟↖️嘟⬆️嘟↗️嘟➡️嘟↘️嘟⬇️";

test("graphemes keep emoji sequences whole", () => {
	assert.deepEqual(graphemes("嘟⬇\uFE0F嘟"), ["嘟", "⬇\uFE0F", "嘟"]);
	assert.equal(graphemes("👍🏽").length, 1);
	assert.equal(graphemes("👨\u200D👩\u200D👧").length, 1);
	assert.equal(graphemes("🇯🇵").length, 1);
});

test("isEmojiImage follows Takumi's extractEmojis test", () => {
	for (const g of [
		"🤪",
		"⬇\uFE0F",
		"↗\uFE0F",
		"👍🏽",
		"🇯🇵",
		"1\uFE0F\u20E3",
		"👨\u200D👩\u200D👧",
	])
		assert.equal(isEmojiImage(g), true, g);
	// Text-style pictographs stay glyphs: no emoji presentation, or U+FE0E
	for (const g of ["♪", "↗", "©", "⬇\uFE0E", "→", "啊", "a"])
		assert.equal(isEmojiImage(g), false, g);
});

test("lineEm counts emoji as 1.15 em images and selectors as nothing", () => {
	assert.equal(graphemeEm("🤪"), 1.15);
	assert.equal(graphemeEm("⬇\uFE0F"), 1.15);
	assert.equal(graphemeEm("♪"), 1);
	assert.equal(lineEm("abc"), textEm("abc"));
	assert.ok(Math.abs(lineEm("啊🤪") - 2.15) < 1e-9);
	// text-fit alone counts the variation selector as a full em
	assert.ok(textEm("⬇\uFE0F") > lineEm("⬇\uFE0F"));
});

test("wrapLines breaks at spaces and around CJK / emoji, never before closers", () => {
	assert.deepEqual(wrapLines("alpha beta gamma", 4, 3).lines, [
		"alpha",
		"beta",
		"gamma",
	]);
	// CJK breaks anywhere, but "，" never starts a line
	const cjk = wrapLines("一二三四，五六七八", 4, 3).lines;
	assert.ok(
		cjk.every((line) => !line.startsWith("，")),
		cjk.join("|"),
	);
	assert.equal(cjk.join(""), "一二三四，五六七八");
	// A word wider than the line is cut mid-word
	assert.deepEqual(
		wrapLines("abcdefghijkl", 3, 9).lines.join(""),
		"abcdefghijkl",
	);
	// Emoji are never split from their selectors
	const emoji = wrapLines(EMOJI_TIP, 10, 99).lines;
	assert.equal(emoji.join(""), EMOJI_TIP);
	for (const line of emoji) {
		assert.ok(lineEm(line) <= 10, line);
		assert.ok(!/^[\uFE0F\u200D]/u.test(line), line);
	}
	// Runs of spaces collapse like HTML does
	assert.deepEqual(wrapLines("a      b", 20, 2).lines, ["a b"]);
	assert.deepEqual(wrapLines("", 20, 2), { lines: [], cut: false });
});

test("wrapLines ellipsizes the last line, keeping it in the width", () => {
	const out = wrapLines("word ".repeat(40), 12, 2);
	assert.equal(out.cut, true);
	assert.equal(out.lines.length, 2);
	assert.ok(out.lines[1]!.endsWith("…"));
	for (const line of out.lines) assert.ok(lineEm(line) <= 12, line);
	assert.deepEqual(clipLine("short", 10), { text: "short", cut: false });
	const clipped = clipLine(EMOJI_TIP, 8);
	assert.ok(clipped.cut && lineEm(clipped.text) <= 8);
});

test("fitTip picks the largest size that shows the tip whole", () => {
	assert.deepEqual(fitTip("Hi", 400, [22, 20], 2), {
		lines: ["Hi"],
		px: 22,
		cut: false,
	});
	const text = "x ".repeat(50).trim();
	const fit = fitTip(text, 400, [22, 20, 18], 2);
	assert.equal(fit.cut, false);
	assert.ok(fit.px < 22);
	assert.equal(fit.lines.join(" "), text);
	for (const line of fit.lines) assert.ok(lineEm(line) * fit.px <= 400);
	assert.equal(fitTip("   ", 400, [22], 2).lines.length, 0);
});

test("every catalog tip fits both footers in two lines", () => {
	const tips = readFileSync(
		join(process.cwd(), "phi-assets/info/tips.txt"),
		"utf8",
	)
		.split(/\r?\n/)
		.filter((t) => t.trim());
	assert.ok(tips.length > 200);
	for (const tip of tips) {
		for (const [w, sizes] of [
			[456, [22, 20, 18]],
			[800, [15, 14, 13]],
		] as const) {
			const fit = fitTip(tip, w, [...sizes], 2);
			assert.ok(fit.lines.length >= 1 && fit.lines.length <= 2, tip);
			for (const line of fit.lines)
				assert.ok(lineEm(line) * fit.px <= w + 1e-6, `${w}: ${line}`);
		}
	}
	// The Table footer shows every catalog tip whole
	assert.ok(tips.every((tip) => !fitTip(tip, 800, [15, 14, 13], 2).cut));
});

test("pickTip prefers the given tip, else draws from the catalog", () => {
	assert.equal(pickTip("given", ["a"]), "given");
	assert.equal(pickTip(" ", ["only"]), "only");
	assert.equal(pickTip(undefined, undefined), "");
});

test("rankParts reads accRank strings, else formats its numbers", () => {
	assert.deepEqual(
		rankParts({
			pos: "#3,611",
			of: "/ 70,388",
			pct: "Top 5.1%",
			rank: 3611,
			total: 70388,
			percent: 5.13,
			tied: 0,
			ap: false,
		}),
		{ pos: "#3,611", of: "/ 70,388", pct: "Top 5.1%", ap: false },
	);
	assert.deepEqual(
		rankParts({ rank: 1, total: 70388, percent: 2.94, ap: true }),
		{
			pos: "#1",
			of: "/ 70,388",
			pct: "AP 2.9%",
			ap: true,
		},
	);
	assert.equal(
		rankParts({ rank: 12, total: 100, percent: 0.5 })?.pct,
		"Top 0.50%",
	);
	for (const junk of [null, undefined, "#3 / 5 · Top 1%", 5, {}, { pos: "#1" }])
		assert.equal(rankParts(junk), null);
});

test("rankLines reads every badge of a row (accRanks), else its single accRank", () => {
	const all = { pos: "#3,611", of: "/ 70,388", pct: "Top 5.1%", ap: false };
	const band = { ...all, pos: "#12", of: "/ 400", tag: "±0.05" };
	assert.deepEqual(rankLines({ accRank: all, accRanks: [all, band] }), [
		all,
		band,
	]);
	assert.deepEqual(rankLines({ accRank: all }), [all]);
	assert.deepEqual(rankLines({ accRanks: [band, null] }), [band]);
	assert.deepEqual(rankLines({}), []);
});

test("a ±0.05 badge set to the place or the share keeps only that half", () => {
	const band = {
		pos: "#12",
		of: "/ 400",
		pct: "Top 3.0%",
		ap: false,
		tag: "±0.05",
	};
	assert.deepEqual(rankParts({ ...band, show: "place" }), {
		...band,
		pct: "",
	});
	assert.deepEqual(rankParts({ ...band, show: "percent" }), {
		...band,
		pos: "",
		of: "",
	});
});
