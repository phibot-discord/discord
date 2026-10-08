import assert from "node:assert/strict";
import test from "node:test";
import {
	cardDownloadFilename,
	cardEtag,
	cardFilenameFromCacheKey,
} from "./cache.ts";
import {
	type CardImageCacheInput,
	cardCacheInput,
	cardCacheParts,
	parseCachedHeight,
} from "./card-image-cache.ts";
import { publicObjectUrl } from "./r2.ts";

function sample(over: Partial<CardImageCacheInput> = {}): CardImageCacheInput {
	return {
		kind: "b30",
		userId: "user",
		saveRevision: "save-a",
		locale: "locale:zh",
		quality: "fast",
		epoch: "0",
		count: "33",
		theme: "default",
		analysisFlag: "a1",
		tagFlag: "t1",
		statsFlag: "s1",
		avgFlag: "avg:all:blue",
		background: "random",
		style: "classic",
		renderVersion: "v32",
		...over,
	};
}

test("same save + language + quality + bust epoch reuse the JPEG cache id", () => {
	const a = cardEtag(cardCacheParts(sample(), "jpeg"));
	const b = cardEtag(cardCacheParts(sample(), "jpeg"));
	assert.equal(a, b);
});

test("save, language, quality, or cache bypass each get a new JPEG cache id", () => {
	const base = cardEtag(cardCacheParts(sample(), "jpeg"));
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ saveRevision: "save-b" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ locale: "locale:en" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ quality: "high" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ epoch: "123" }), "jpeg")),
	);
});

test("same save + language + quality reuse the height cache id", () => {
	const a = cardEtag(cardCacheParts(sample(), "height"));
	const b = cardEtag(cardCacheParts(sample(), "height"));
	assert.equal(a, b);
	assert.notEqual(a, cardEtag(cardCacheParts(sample(), "jpeg")));
});

test("save, language, or quality each get a new height cache id", () => {
	const base = cardEtag(cardCacheParts(sample(), "height"));
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ saveRevision: "save-b" }), "height")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ locale: "locale:en" }), "height")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ quality: "high" }), "height")),
	);
});

test("cache bypass keeps the height id when save language and quality stay", () => {
	assert.equal(
		cardEtag(cardCacheParts(sample(), "height")),
		cardEtag(cardCacheParts(sample({ epoch: "123" }), "height")),
	);
});

test("enabling tags after a t0 render must not reuse the t0 etag", () => {
	const off = cardEtag(cardCacheParts(sample({ tagFlag: "t0" }), "jpeg"));
	const on = cardEtag(cardCacheParts(sample({ tagFlag: "t1" }), "jpeg"));
	assert.notEqual(on, off);
});

test("hiding the C / FC / AP counts gets a new JPEG cache id", () => {
	const shown = cardEtag(cardCacheParts(sample({ statsFlag: "s1" }), "jpeg"));
	const hidden = cardEtag(cardCacheParts(sample({ statsFlag: "s0" }), "jpeg"));
	assert.notEqual(shown, hidden);
});

test("theme or analysis changes get a new JPEG cache id", () => {
	const base = cardEtag(cardCacheParts(sample(), "jpeg"));
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ theme: "dark" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ analysisFlag: "a0" }), "jpeg")),
	);
});

test("b30 avg bar setting changes get a new JPEG cache id", () => {
	const base = cardEtag(cardCacheParts(sample(), "jpeg"));
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ avgFlag: "avg:none" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ avgFlag: "avg:b30:red" }), "jpeg")),
	);
	assert.notEqual(
		base,
		cardEtag(cardCacheParts(sample({ background: "Song.0" }), "jpeg")),
	);
});

test("parseCachedHeight keeps measured pixel heights", () => {
	assert.equal(parseCachedHeight(4320), 4320);
	assert.equal(parseCachedHeight("4320"), 4320);
	assert.equal(parseCachedHeight(64), undefined);
	assert.equal(parseCachedHeight("nope"), undefined);
});

test("download filename comes from the card kind in the cache key", () => {
	assert.equal(cardDownloadFilename("b30"), "b30.jpg");
	assert.equal(
		cardFilenameFromCacheKey("phi:webCard:png:x30:user:abcdef"),
		"x30.jpg",
	);
});

test("public object URL is the R2 custom domain plus key", () => {
	assert.equal(
		publicObjectUrl("web-cards/phi:webCard:png:b30:u:etag.jpg", {
			accountId: "a",
			apiToken: "t",
			bucket: "phi-web-assets",
			prefix: "original_ill",
			htmlPrefix: "html",
			publicBase: "https://r2.example.test",
		}),
		"https://r2.example.test/web-cards/phi%3AwebCard%3Apng%3Ab30%3Au%3Aetag.jpg",
	);
});

test("classic style adds no key part; other styles get their own JPEG and height ids", () => {
	const classic = cardCacheParts(sample(), "jpeg");
	assert.ok(!classic.some((p) => p.startsWith("style:")));
	assert.deepEqual(classic, cardCacheParts(sample({ style: "" }), "jpeg"));
	for (const suffix of ["jpeg", "height"] as const) {
		const a = cardEtag(cardCacheParts(sample(), suffix));
		const b = cardEtag(cardCacheParts(sample({ style: "table" }), suffix));
		const c = cardEtag(cardCacheParts(sample({ style: "portrait" }), suffix));
		assert.notEqual(a, b);
		assert.notEqual(b, c);
	}
});

test("the avg key follows the badge mode the card draws", () => {
	const flag = (notes: {
		allowApiUsage?: boolean;
		b30AvgKind?: string;
		b30AvgColor?: "red" | "gold" | "blue" | "green";
		rankScope?: "all" | "band" | "both";
		rankBandShow?: "place" | "percent";
	}) =>
		cardCacheInput({
			kind: "b30",
			userId: "u",
			saveRevision: "s",
			locale: "en",
			paintQuality: "fast",
			epoch: "",
			count: 33,
			notes: {
				theme: "default",
				showB30Analysis: true,
				allowApiUsage: notes.allowApiUsage ?? true,
				b30AvgKind: notes.b30AvgKind ?? "all",
				b30AvgColor: notes.b30AvgColor ?? "blue",
				rankScope: notes.rankScope,
				rankBandShow: notes.rankBandShow,
			},
			tagOn: true,
			statsOn: true,
		}).avgFlag;
	assert.equal(flag({}), "avg:all:blue");
	// A mode only the Discord bot knows is drawn as "all", so it shares that key
	assert.equal(flag({ b30AvgKind: "botOnly" }), "avg:all:blue");
	assert.equal(flag({ b30AvgKind: "" }), "avg:all:blue");
	assert.equal(flag({ b30AvgKind: "rank" }), "avg:rank:blue");
	// Rank's population: "all" keeps the old key; the others draw other numbers
	assert.equal(flag({ b30AvgKind: "rank", rankScope: "all" }), "avg:rank:blue");
	assert.equal(
		flag({ b30AvgKind: "rank", rankScope: "band" }),
		"avg:rank-band:blue",
	);
	assert.equal(
		flag({ b30AvgKind: "rank", rankScope: "both" }),
		"avg:rank-both:blue",
	);
	assert.equal(flag({ b30AvgKind: "top", rankScope: "both" }), "avg:top:blue");
	// What the ±0.05 badge shows: the place keeps the key, the share gets its own
	assert.equal(
		flag({ b30AvgKind: "rank", rankScope: "band", rankBandShow: "place" }),
		"avg:rank-band:blue",
	);
	assert.equal(
		flag({ b30AvgKind: "rank", rankScope: "both", rankBandShow: "percent" }),
		"avg:rank-both-pct:blue",
	);
	assert.equal(
		flag({ b30AvgKind: "rank", rankScope: "all", rankBandShow: "percent" }),
		"avg:rank:blue",
	);
	// B30 average is no longer offered: a stored one draws as Average
	assert.equal(flag({ b30AvgKind: "b30", b30AvgColor: "red" }), "avg:all:red");
	assert.equal(flag({ b30AvgKind: "none" }), "avg:none:blue");
	assert.equal(flag({ allowApiUsage: false, b30AvgKind: "rank" }), "avg:none");
	// API usage off also hides the tag radar and live lookups, and nothing else
	// in the key records it: it must never share a key with kind "none"
	assert.notEqual(
		flag({ allowApiUsage: false, b30AvgKind: "all" }),
		flag({ b30AvgKind: "none" }),
	);
});
