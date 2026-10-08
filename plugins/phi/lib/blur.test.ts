import assert from "node:assert/strict";
import {
	mkdtempSync,
	readdirSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
	backgroundLuma,
	contrastOverBackground,
	markBlurUsed,
	pruneBlurCache,
	sampleLuma,
} from "./blur.ts";

async function swatch(file: string, hex: string) {
	await sharp({
		create: {
			width: 64,
			height: 64,
			channels: 3,
			background: hex,
		},
	})
		.png()
		.toFile(file);
}

function cardHtml(bg: string, ill: string) {
	return (
		`<html><head></head><body>` +
		`<div class="background"><img src="${bg}" alt=""></div>` +
		`<div class="ill"><img src="${ill}" alt=""></div>` +
		`<div class="playerInfo"><div class="date"><p>2026-09-04</p></div></div>` +
		`<div class="tips"><p>Tip: hello</p></div>` +
		`</body></html>`
	);
}

test("date and tip use black on a light card background", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-ink-"));
	const light = join(dir, "light.png");
	const darkIll = join(dir, "dark-ill.png");
	await swatch(light, "#e8e8e8");
	await swatch(darkIll, "#111111");
	const html = await contrastOverBackground(cardHtml(light, darkIll));
	assert.match(html, /color: #000000/);
	assert.match(html, /style="color:#000000/);
	assert.doesNotMatch(html, /color: #ffffff/);
});

test("date and tip use white on a dark card background", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-ink-"));
	const dark = join(dir, "dark.png");
	const lightIll = join(dir, "light-ill.png");
	await swatch(dark, "#141414");
	await swatch(lightIll, "#f0f0f0");
	const html = await contrastOverBackground(cardHtml(dark, lightIll));
	assert.match(html, /color: #ffffff/);
	assert.match(html, /style="color:#ffffff/);
	assert.doesNotMatch(html, /color: #000000/);
});

test("one small sample gives the top and bottom band luma", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-ink-"));
	const file = join(dir, "split.png");
	// Light top 10%, dark rest: the top band is light, the bottom band dark
	await sharp({
		create: { width: 300, height: 1000, channels: 3, background: "#101010" },
	})
		.composite([
			{
				input: {
					create: {
						width: 300,
						height: 100,
						channels: 3,
						background: "#f0f0f0",
					},
				},
				top: 0,
				left: 0,
			},
		])
		.png()
		.toFile(file);
	const luma = await sampleLuma(file);
	assert.ok(luma.top > 0.8, `top ${luma.top}`);
	assert.ok(luma.bottom < 0.1, `bottom ${luma.bottom}`);
});

test("a background is sampled once while renders share it", async () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-ink-"));
	const file = join(dir, "bg.png");
	await swatch(file, "#808080");
	const a = backgroundLuma(file);
	const b = backgroundLuma(file);
	assert.equal(a, b);
	assert.deepEqual(await a, await backgroundLuma(file));
});

test("the blur cache keeps only the most recently used backgrounds", () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-blur-"));
	for (let i = 0; i < 30; i++) {
		const file = join(dir, `${String(i).padStart(2, "0")}.png`);
		writeFileSync(file, "png");
		const at = new Date(1_700_000_000_000 + i * 1000);
		utimesSync(file, at, at);
	}
	writeFileSync(join(dir, "in-flight.png.1.x.tmp"), "partial");
	pruneBlurCache(dir, 24);
	const left = readdirSync(dir).sort();
	assert.equal(left.length, 25);
	assert.equal(left[0], "06.png");
	assert.ok(left.includes("29.png"));
	assert.ok(left.includes("in-flight.png.1.x.tmp"));
	pruneBlurCache(dir, 24);
	assert.equal(readdirSync(dir).length, 25);
});

test("a blur-cache hit moves the mtime at most once an hour", () => {
	const dir = mkdtempSync(join(tmpdir(), "phi-blur-"));
	const file = join(dir, "hit.png");
	writeFileSync(file, "png");
	const now = Math.floor(Date.now() / 1000) * 1000;
	const recent = new Date(now - 10 * 60_000);
	utimesSync(file, recent, recent);
	// The asset and luma caches key on mtime: a hit must not change it every render
	assert.equal(markBlurUsed(file, now), false);
	assert.equal(Math.round(statSync(file).mtimeMs), recent.getTime());
	const old = new Date(now - 2 * 60 * 60_000);
	utimesSync(file, old, old);
	assert.equal(markBlurUsed(file, now), true);
	assert.ok(statSync(file).mtimeMs > old.getTime());
	assert.equal(markBlurUsed(join(dir, "gone.png"), now), false);
});

test("a blurred background keeps its luma sample when a hit touches it", async () => {
	// Blur-cache files are named by content hash: the path alone is the version
	// A scratch blur dir, so the dev server's pruning never races this test
	const dir = mkdtempSync(join(tmpdir(), "phi-blur-"));
	const cached = join(dir, "luma-test.png");
	const plain = join(mkdtempSync(join(tmpdir(), "phi-ink-")), "bg.png");
	await swatch(cached, "#808080");
	await swatch(plain, "#808080");
	const a = backgroundLuma(cached, dir);
	const p = backgroundLuma(plain, dir);
	await Promise.all([a, p]);
	const later = new Date(Date.now() + 5_000);
	utimesSync(cached, later, later);
	utimesSync(plain, later, later);
	assert.equal(backgroundLuma(cached, dir), a);
	assert.notEqual(
		backgroundLuma(plain, dir),
		p,
		"other files still key on mtime",
	);
});
