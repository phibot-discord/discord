import assert from "node:assert/strict";
import test from "node:test";
import {
	cardCopy,
	localizeChartTagDescription,
	localizeChartTagLabels,
	localizeChartTagName,
	resolvePhiLocale,
	tagAnalysisMeta,
	tagPoolNote,
} from "./card-i18n.ts";

test("card render locale prefers the request over stored notes", () => {
	assert.equal(resolvePhiLocale("en", "zh"), "en");
	assert.equal(resolvePhiLocale("zh", "en"), "zh");
	assert.equal(resolvePhiLocale(undefined, "zh"), "zh");
	assert.equal(resolvePhiLocale("en", undefined), "en");
});

test("chart tag glossary localizes names and official descriptions", () => {
	assert.equal(localizeChartTagName("差速", "en"), "Mixed speed");
	assert.equal(
		localizeChartTagDescription("差速", "同一时刻的Note的下落速度不同", "en"),
		"Notes at the same time drop at different speeds (e.g. Temporal Shifting)",
	);
	assert.equal(
		localizeChartTagDescription("差速", "同一时刻的Note的下落速度不同", "zh"),
		"同一时刻的Note的下落速度不同",
	);
	assert.equal(localizeChartTagDescription("慢流速", "", "en"), "");
});

test("tag meta line follows upstream f908bb31: pool, records, ballots", () => {
	const zh = cardCopy("zh");
	const en = cardCopy("en");
	const pool = { threshold: 15.9, recordCount: 20, totalVotes: 499 };
	assert.equal(tagAnalysisMeta(pool, zh), "RKS≥15.9 · 成绩 20 · 选票 499");
	assert.equal(tagAnalysisMeta(pool, en), "RKS≥15.9 · Scores 20 · Votes 499");
	assert.equal(
		tagAnalysisMeta({ ...pool, threshold: 16 }, zh),
		"RKS≥16.0 · 成绩 20 · 选票 499",
	);
	// Older server (no threshold): valid votes only
	assert.equal(tagAnalysisMeta({ totalVotes: 12 }, zh), "有效票 12");
	assert.equal(tagAnalysisMeta({ totalVotes: 12 }, en), "Valid votes 12");
	// Failed lookup: no data, never "0 votes"
	assert.equal(tagAnalysisMeta(null, zh), "暂无数据");
	assert.equal(tagAnalysisMeta(undefined, en), "No data");
});

test("tag pool note says the server pools every score at the threshold", () => {
	const pool = { threshold: 15.9, recordCount: 20, totalVotes: 499 };
	assert.equal(
		tagPoolNote(pool, cardCopy("zh")),
		"统计全部单曲 RKS≥15.9 的成绩，而非 B30 槽位",
	);
	assert.match(
		tagPoolNote(pool, cardCopy("en")),
		/every score with chart RKS ≥ 15\.9, not the B30 slots/,
	);
	assert.equal(tagPoolNote({ totalVotes: 3 }, cardCopy("en")), "");
	assert.equal(tagPoolNote(null, cardCopy("zh")), "");
});

test("tag panel wording matches upstream f908bb31 without /settag", () => {
	const zh = cardCopy("zh");
	const en = cardCopy("en");
	assert.equal(zh.tagAbility, "谱面实力分析");
	assert.match(zh.tagInsufficient, /^有效选票或逐标签成绩样本不足/);
	assert.equal(zh.tagTip, "谱面投票可前往 https://www.phib19.top 提交");
	assert.match(en.tagInsufficient, /votes or per-tag score samples/);
	for (const copy of [zh, en]) {
		for (const text of [copy.tagInsufficient, copy.tagTip]) {
			assert.match(text, /https:\/\/www\.phib19\.top/);
			assert.doesNotMatch(text, /settag/);
		}
		assert.notEqual(copy.tagUnavailable, copy.tagInsufficient);
	}
});

test("localized tag labels keep the pool fields", () => {
	const out = localizeChartTagLabels(
		{
			threshold: 15.9,
			recordCount: 20,
			categories: [{ name: "读谱" }],
			radar: { categories: [{ name: "多指" }] },
			strong: [{ name: "差速" }],
			weak: [],
		},
		"en",
	);
	assert.equal(out.threshold, 15.9);
	assert.equal(out.recordCount, 20);
	assert.equal(out.categories[0]?.name, "Reading");
	assert.equal(out.strong[0]?.name, "Mixed speed");
});

test("the classic card's mode chips are the short card titles", () => {
	const zh = cardCopy("zh");
	const en = cardCopy("en");
	assert.equal(zh.x30Mode, "性30");
	assert.equal(zh.fcMode, "FC30");
	assert.equal(en.x30Mode, "x30");
	assert.equal(en.fcMode, "FC30");
	assert.equal(zh.apMode, "All Perfect 模式");
});
