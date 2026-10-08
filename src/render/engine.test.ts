import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Renderer } from "@takumi-rs/core";
import sharp from "sharp";
import { renderLock } from "../render-lock.ts";
import { MEASURE_SLACK_PX, RenderEngine } from "./engine.ts";
import { fitPaint, PIXEL_RATIO } from "./paint-budget.ts";
import { clearRemoteImageCache, remoteImageBytes } from "./remote-images.ts";

test("html cards rasterize at 2x while keeping CSS layout size", async () => {
	const warns: string[] = [];
	const origWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warns.push(args.map(String).join(" "));
		origWarn.apply(console, args);
	};
	try {
		const engine = new RenderEngine();
		await engine.init();
		const img = await engine.renderHtml(
			`<!DOCTYPE html><html><body style="margin:0"><div style="width:100%;height:80px;background:#ff0000"></div></body></html>`,
			{ width: 400, height: 80, format: "png", id: "dpr-smoke" },
		);
		const painted = await sharp(img.bytes).raw().ensureAlpha().toBuffer({
			resolveWithObject: true,
		});
		assert.equal(img.width, 400);
		assert.equal(img.height, 80);
		assert.equal(painted.info.width, 800);
		assert.equal(painted.info.height, 160);
		const at = (x: number, y: number) => {
			const i = (y * painted.info.width + x) * 4;
			return [
				painted.data[i] ?? 0,
				painted.data[i + 1] ?? 0,
				painted.data[i + 2] ?? 0,
			];
		};
		assert.deepEqual(at(10, 10), [255, 0, 0]);
		assert.deepEqual(at(410, 10), [255, 0, 0]);
		assert.deepEqual(at(790, 10), [255, 0, 0]);
		assert.equal(
			warns.filter((w) => /stylesheets/i.test(w)).length,
			0,
			warns.join("\n"),
		);
		await engine.close();
	} finally {
		console.warn = origWarn;
	}
});

test("over-budget paint keeps the right and bottom edges", async () => {
	const engine = new RenderEngine();
	await engine.init();
	const cssW = 1200;
	const cssH = 4000;
	const img = await engine.renderHtml(
		`<!DOCTYPE html><html><body style="margin:0"><div style="position:relative;width:100%;height:4000px;background:#00ff00"><div style="position:absolute;right:0;bottom:0;width:24px;height:24px;background:#ff0000"></div></div></body></html>`,
		{ width: cssW, height: cssH, format: "png", id: "crop-smoke" },
	);
	const painted = await sharp(img.bytes).raw().ensureAlpha().toBuffer({
		resolveWithObject: true,
	});
	const paint = fitPaint(cssW, cssH);
	assert.ok(paint.ratio < PIXEL_RATIO);
	assert.equal(paint.ratio, 1);
	assert.equal(painted.info.width, 1200);
	assert.equal(painted.info.height, 4000);
	const at = (x: number, y: number) => {
		const i = (y * painted.info.width + x) * 4;
		return [
			painted.data[i] ?? 0,
			painted.data[i + 1] ?? 0,
			painted.data[i + 2] ?? 0,
		];
	};
	assert.deepEqual(at(10, 10), [0, 255, 0]);
	assert.deepEqual(
		at(painted.info.width - 6, painted.info.height - 6),
		[255, 0, 0],
	);
	await engine.close();
});

test("high-quality over-budget paint fills the cap and keeps the edges", async () => {
	const engine = new RenderEngine();
	await engine.init();
	const cssW = 1200;
	const cssH = 4000;
	const img = await engine.renderHtml(
		`<!DOCTYPE html><html><body style="margin:0"><div style="position:relative;width:100%;height:4000px;background:#00ff00"><div style="position:absolute;right:0;bottom:0;width:24px;height:24px;background:#ff0000"></div></div></body></html>`,
		{
			width: cssW,
			height: cssH,
			format: "png",
			id: "crop-high",
			paintQuality: "high",
		},
	);
	const painted = await sharp(img.bytes).raw().ensureAlpha().toBuffer({
		resolveWithObject: true,
	});
	const paint = fitPaint(cssW, cssH, PIXEL_RATIO, "high");
	assert.ok(paint.ratio > 1);
	assert.ok(paint.ratio < PIXEL_RATIO);
	assert.equal(painted.info.width, paint.width);
	assert.equal(painted.info.height, paint.height);
	const at = (x: number, y: number) => {
		const i = (y * painted.info.width + x) * 4;
		return [
			painted.data[i] ?? 0,
			painted.data[i + 1] ?? 0,
			painted.data[i + 2] ?? 0,
		];
	};
	assert.deepEqual(at(10, 10), [0, 255, 0]);
	assert.deepEqual(
		at(painted.info.width - 6, painted.info.height - 6),
		[255, 0, 0],
	);
	await engine.close();
});

function painted(bytes: Buffer) {
	return sharp(bytes)
		.raw()
		.ensureAlpha()
		.toBuffer({ resolveWithObject: true })
		.then(({ data, info }) => ({
			info,
			at: (x: number, y: number) => {
				const i = (y * info.width + x) * 4;
				return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
			},
		}));
}

test("measured cards paint the bottom rows with the body background", async () => {
	const engine = new RenderEngine();
	const img = await engine.renderHtml(
		`<!DOCTYPE html><html><body style="margin:0;background:#123456;padding-bottom:40px"><div style="height:100px;background:#00ff00"></div></body></html>`,
		{ width: 200, format: "png", id: "strip-body" },
	);
	assert.equal(img.height, 100 + 40 + MEASURE_SLACK_PX);
	const px = await painted(img.bytes);
	assert.equal(px.info.height, img.height * 2);
	const last = px.info.height - 1;
	assert.deepEqual(px.at(10, 10), [0, 255, 0]);
	assert.deepEqual(px.at(390, 190), [0, 255, 0]);
	for (const x of [0, 200, 399])
		assert.deepEqual(px.at(x, last), [0x12, 0x34, 0x56]);
	assert.deepEqual(px.at(399, 250), [0x12, 0x34, 0x56]);
	await engine.close();
});

test("an absolute card background stretches to the last device row", async () => {
	const engine = new RenderEngine();
	const img = await engine.renderHtml(
		`<!DOCTYPE html><html><body style="margin:0;background:#000080;padding-bottom:40px"><div class="background" style="position:absolute;top:0;left:0;right:0;bottom:0;background:#ff0000"></div><div style="position:relative;height:100px"></div></body></html>`,
		{ width: 200, format: "png", id: "strip-classic" },
	);
	const px = await painted(img.bytes);
	const last = px.info.height - 1;
	assert.deepEqual(px.at(10, 10), [255, 0, 0]);
	assert.deepEqual(px.at(10, last), [255, 0, 0]);
	assert.deepEqual(px.at(399, last), [255, 0, 0]);
	await engine.close();
});

test("a centred flex body keeps the card at the left edge", async () => {
	const engine = new RenderEngine();
	const img = await engine.renderHtml(
		`<!DOCTYPE html><html><body style="margin:0;display:flex;flex-direction:column;align-items:center;background:#000080"><div style="width:200px;height:50px;background:#00ff00"></div></body></html>`,
		{ width: 200, format: "png", id: "strip-flex" },
	);
	const px = await painted(img.bytes);
	assert.deepEqual(px.at(2, 2), [0, 255, 0]);
	assert.deepEqual(px.at(397, 2), [0, 255, 0]);
	assert.deepEqual(px.at(200, px.info.height - 1), [0, 0, 128]);
	await engine.close();
});

test("an aborted render rejects and leaves the raster lock free", async () => {
	const engine = new RenderEngine();
	const ac = new AbortController();
	ac.abort(new Error("card timed out"));
	await assert.rejects(
		engine.renderHtml(`<html><body><div>x</div></body></html>`, {
			width: 100,
			height: 100,
			signal: ac.signal,
		}),
		/card timed out/,
	);
	// Both slots busy: a render queued behind them leaves the queue on abort
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const slots = [renderLock.run(() => held), renderLock.run(() => held)];
	const queued = new AbortController();
	const waiting = engine.renderHtml(`<html><body><div>x</div></body></html>`, {
		width: 100,
		height: 100,
		signal: queued.signal,
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(renderLock.queued, 1);
	queued.abort(new Error("queued render timed out"));
	await assert.rejects(waiting, /queued render timed out/);
	assert.equal(renderLock.queued, 0);
	release();
	await Promise.all(slots);
	assert.equal(renderLock.busy, 0);
	await engine.close();
});

const GRIN =
	"https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.051/svg/emoji_u1f600.svg";

test("emoji paint from the prefetched image and never fail the render", async () => {
	const engine = new RenderEngine();
	const html = `<html><body style="margin:0;background:#ffffff"><p style="margin:0;font-size:40px;line-height:40px">😀</p></body></html>`;
	clearRemoteImageCache();
	await remoteImageBytes(GRIN, async () =>
		new TextEncoder().encode(
			`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff0000"/></svg>`,
		),
	);
	const shown = await painted(
		(await engine.renderHtml(html, { width: 100, height: 50, format: "png" }))
			.bytes,
	);
	assert.deepEqual(shown.at(20, 40), [255, 0, 0]);

	clearRemoteImageCache();
	await remoteImageBytes(GRIN, async () => undefined);
	const missing = await painted(
		(await engine.renderHtml(html, { width: 100, height: 50, format: "png" }))
			.bytes,
	);
	assert.deepEqual(missing.at(20, 40), [255, 255, 255]);
	clearRemoteImageCache();
	await engine.close();
});

test("an emoji served as an error page is dropped, not a failed render", async () => {
	const engine = new RenderEngine();
	const html = `<html><body style="margin:0;background:#ffffff"><p style="margin:0;font-size:40px;line-height:40px">😀</p></body></html>`;
	clearRemoteImageCache();
	await remoteImageBytes(GRIN, async () =>
		new TextEncoder().encode(
			"<!DOCTYPE html><html><body>Service Unavailable</body></html>",
		),
	);
	for (let i = 0; i < 2; i++) {
		const img = await engine.renderHtml(html, {
			width: 100,
			height: 50,
			format: "png",
		});
		assert.deepEqual((await painted(img.bytes)).at(20, 40), [255, 255, 255]);
	}
	clearRemoteImageCache();
	await engine.close();
});

test("an emoji Takumi cannot decode is dropped and not tried again", async () => {
	const engine = new RenderEngine();
	const html = `<html><body style="margin:0;background:#ffffff"><p style="margin:0;font-size:40px;line-height:40px">😀</p></body></html>`;
	clearRemoteImageCache();
	// Passes the byte sniff (starts with <svg, ends with </svg>) but is not XML
	await remoteImageBytes(GRIN, async () =>
		new TextEncoder().encode(
			`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16"</svg>`,
		),
	);
	for (const height of [50, undefined]) {
		const img = await engine.renderHtml(html, {
			width: 100,
			height,
			format: "png",
		});
		assert.deepEqual((await painted(img.bytes)).at(20, 40), [255, 255, 255]);
	}
	let refetched = 0;
	assert.equal(
		await remoteImageBytes(GRIN, async () => {
			refetched += 1;
			return undefined;
		}),
		undefined,
	);
	assert.equal(refetched, 0);
	clearRemoteImageCache();
	await engine.close();
});

test("fonts register once however many renders start together", async () => {
	const orig = Renderer.prototype.registerFont;
	let calls = 0;
	Renderer.prototype.registerFont = function (
		this: Renderer,
		...args: Parameters<typeof orig>
	) {
		calls += 1;
		return orig.apply(this, args);
	};
	try {
		const engine = new RenderEngine();
		const fontDir = join(process.cwd(), "phi-assets/html/common/font");
		engine.registerFont({
			name: "Aldrich",
			data: readFileSync(join(fontDir, "Aldrich-Regular.woff2")),
		});
		const html = `<html><body><p style="font-family:Aldrich">12</p></body></html>`;
		await Promise.all([
			engine.warmFonts(),
			engine.renderHtml(html, { width: 50, height: 20 }),
			engine.renderHtml(html, { width: 50, height: 20 }),
			engine.warmFonts(),
		]);
		assert.equal(calls, 1);
		engine.registerFont({
			name: "NOTO",
			data: readFileSync(join(fontDir, "NotoSans-Regular.woff2")),
		});
		await engine.renderHtml(html, { width: 50, height: 20 });
		await engine.warmFonts();
		assert.equal(calls, 2);
		await engine.close();
	} finally {
		Renderer.prototype.registerFont = orig;
	}
});
