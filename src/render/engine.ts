import { createHash } from "node:crypto";
import {
	type ImageSource,
	type Node,
	Renderer,
	setGlyphCacheMaxBytes,
} from "@takumi-rs/core";
import sharp from "sharp";
import { fromHtml } from "takumi-js/helpers/html";
import { logger } from "../logger.ts";
import { renderLock } from "../render-lock.ts";
import type {
	FontEntry,
	RenderedImage,
	RenderFormat,
	TemplateDefinition,
} from "../sdk/index.ts";
import { exists } from "../vfs.ts";
import { readAssetCached } from "./asset-cache.ts";
import {
	collectRootVars,
	collectStylesheets,
	resolveCssVars,
	stripScripts,
	stripUnsupportedCss,
} from "./css.ts";
import { PHI_FONT_FAMILIES } from "./fonts.ts";
import { type ImageAsset, rewriteLocalUrls } from "./html.ts";
import {
	fitPaint,
	type PaintQuality,
	type PaintSize,
	PIXEL_RATIO,
} from "./paint-budget.ts";
import { fitPaintImages } from "./paint-images.ts";
import {
	dropRemoteImages,
	markRemoteImagesFailed,
	mayHaveEmoji,
	withRemoteImages,
} from "./remote-images.ts";

/**
 * Memory budget for two rasters in flight: 160 MB of decoded images, 32 MB of glyphs
 * and one pixmap per raster; ~1 GB with the other caches
 */
const RENDERER_CACHE_BYTES = 160 * 1024 * 1024;
const GLYPH_CACHE_BYTES = 32 * 1024 * 1024;
setGlyphCacheMaxBytes(GLYPH_CACHE_BYTES);

const MEASURE_VIEWPORT_H = 16_000;
/** Slack added to a measured height for a random tip's extra line */
export const MEASURE_SLACK_PX = 24;
const heightCache = new Map<string, number>();
const HEIGHT_CACHE_MAX = 200;

/** Scaling wrapper and canvas filler; both passes style them, so they share one parsed tree */
function wrapPixelRoot(html: string) {
	const root = `<div class="phi-pixel-fill"></div><div class="phi-pixel-root">`;
	if (/<body\b/i.test(html)) {
		const opened = html.replace(/<body\b([^>]*)>/i, `<body$1>${root}`);
		return /<\/body>/i.test(opened)
			? opened.replace(/<\/body>/i, "</div></body>")
			: `${opened}</div>`;
	}
	return `${root}${html}</div>`;
}

function rootBoxCss(cssWidth: number) {
	return `html, body { position: relative !important; width: ${cssWidth}px !important; height: auto !important; min-height: min-content !important; overflow: visible !important; transform: none !important; }`;
}

function measureRootCss(cssWidth: number) {
	return `.phi-pixel-fill { display: none !important; }
.phi-pixel-root { width: ${cssWidth}px !important; transform: none !important; transform-origin: 0 0 !important; overflow: visible !important; }`;
}

/**
 * Paint every device pixel with the card's background: a filler behind the scaled root, and a
 * root min-height so `.background` covers the card (Takumi ignores scale !important)
 */
function paintRootCss(cssWidth: number, paint: PaintSize) {
	const cover = Math.ceil(paint.height / paint.ratio);
	const scale = paint.ratio === 1 ? "none" : `scale(${paint.ratio})`;
	return `.phi-pixel-fill { display: block !important; position: absolute !important; left: 0 !important; top: 0 !important; width: ${paint.width}px !important; height: ${paint.height}px !important; margin: 0 !important; background: inherit !important; }
.phi-pixel-root { width: ${cssWidth}px !important; min-height: ${cover}px !important; transform: ${scale}; transform-origin: 0 0 !important; overflow: visible !important; }`;
}

function rememberHeight(key: string, height: number) {
	if (heightCache.size >= HEIGHT_CACHE_MAX) {
		const oldest = heightCache.keys().next().value;
		if (oldest !== undefined) heightCache.delete(oldest);
	}
	heightCache.set(key, height);
}

const cssTransformCache = new Map<string, string>();
const CSS_CACHE_MAX = 256;

function transformSheet(
	sheet: string,
	vars: Map<string, string>,
	varsKey: string,
): string {
	const key = createHash("sha1")
		.update(varsKey)
		.update("\0")
		.update(sheet)
		.digest("hex");
	const hit = cssTransformCache.get(key);
	if (hit !== undefined) {
		cssTransformCache.delete(key);
		cssTransformCache.set(key, hit);
		return hit;
	}
	const out = stripUnsupportedCss(resolveCssVars(sheet, vars));
	if (cssTransformCache.size >= CSS_CACHE_MAX) {
		const oldest = cssTransformCache.keys().next().value;
		if (oldest !== undefined) cssTransformCache.delete(oldest);
	}
	cssTransformCache.set(key, out);
	return out;
}

function fmtMs(ms: number) {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function withHtmlMs(img: RenderedImage, htmlMs: number): RenderedImage {
	return { ...img, timings: { ...img.timings, htmlMs } };
}

function mime(format: RenderFormat) {
	return format === "jpeg"
		? "image/jpeg"
		: format === "webp"
			? "image/webp"
			: "image/png";
}

function ext(format: RenderFormat) {
	return format === "jpeg" ? "jpg" : format;
}

function collectCssImages(css: string): ImageAsset[] {
	const out: ImageAsset[] = [];
	const re = /url\("?(file:[^")]+|phi-css:[^")]+)"?\)/gi;
	const seen = new Set<string>();
	let m = re.exec(css);
	while (m) {
		const src = m[1];
		if (!src || seen.has(src)) {
			m = re.exec(css);
			continue;
		}
		seen.add(src);
		const file = src.startsWith("file:")
			? decodeURIComponent(src.replace(/^file:\/\//, ""))
			: src;
		if (exists(file)) out.push({ src, data: readAssetCached(file) });
		m = re.exec(css);
	}
	return out;
}

function contentExtent(n: {
	height: number;
	transform?: number[];
	children?: unknown[];
}): number {
	const ty = n.transform?.[5] ?? 0;
	let max = ty + (n.height || 0);
	for (const c of (n.children || []) as (typeof n)[])
		max = Math.max(max, contentExtent(c));
	return max;
}

export type RenderHtmlOptions = {
	width?: number;
	height?: number;
	format?: RenderFormat;
	quality?: number;
	baseDir?: string;
	id?: string;
	heightKey?: string;
	paintQuality?: PaintQuality;
	maxRatio?: number;
	/** Stops the render before its next stage (queued for the lock, measure, raster, encode) */
	signal?: AbortSignal;
};

export class RenderEngine {
	private renderer: Renderer | undefined;
	private fonts: FontEntry[] = [];
	private fontQueue: FontEntry[] = [];
	private fontsReady: Promise<Renderer> | undefined;

	async init() {
		this.renderer = new Renderer({ cacheMaxBytes: RENDERER_CACHE_BYTES });
		logger.ok("takumi renderer");
	}

	registerFont(entry: FontEntry) {
		this.fonts.push(entry);
		this.fontQueue.push(entry);
	}

	private async getRenderer(): Promise<Renderer> {
		if (!this.renderer) await this.init();
		if (!this.renderer) throw new Error("takumi renderer not initialized");
		return this.renderer;
	}

	/** Registers queued fonts once per process; started at boot to overlap data loading */
	warmFonts(): Promise<Renderer> {
		if (this.fontsReady && !this.fontQueue.length) return this.fontsReady;
		const batch = this.fontQueue.splice(0);
		const before = this.fontsReady ?? this.getRenderer();
		const ready = before.then(async (renderer) => {
			const started = performance.now();
			const results = await Promise.allSettled(
				batch.map((f) =>
					renderer.registerFont({
						name: f.name,
						data: f.data,
						weight: f.weight ?? 400,
						style: f.style ?? "normal",
						generic: f.generic,
					}),
				),
			);
			results.forEach((r, i) => {
				if (r.status === "rejected") {
					logger.error(
						`font ${batch[i]?.name} not registered: ${r.reason instanceof Error ? r.reason.message : r.reason}`,
					);
				}
			});
			if (batch.length) {
				logger.ok(
					`fonts registered (${batch.length}) in ${fmtMs(performance.now() - started)}`,
				);
			}
			return renderer;
		});
		this.fontsReady = ready;
		ready.catch(() => {
			this.fontQueue.unshift(...batch);
			if (this.fontsReady === ready) this.fontsReady = undefined;
		});
		return ready;
	}

	async renderHtml(
		rawHtml: string,
		opts: RenderHtmlOptions = {},
	): Promise<RenderedImage> {
		const started = performance.now();
		const signal = opts.signal;
		signal?.throwIfAborted();
		const fontsReady = this.warmFonts();
		const width = opts.width ?? 1200;
		const format = opts.format ?? "png";
		const quality = opts.quality ?? 90;
		const maxRatio = opts.maxRatio ?? PIXEL_RATIO;
		const baseDir = opts.baseDir ?? process.cwd();
		const id = opts.id || "html";

		// Jackets were already hydrated by the template's html() step
		let html = stripScripts(rawHtml);
		const sheets = collectStylesheets(html, baseDir);
		html = sheets.html;
		const rewritten = rewriteLocalUrls(html, baseDir);
		html = rewritten.html;
		const inline: string[] = [];
		html = html.replace(
			/<style\b[^>]*>([\s\S]*?)<\/style>/gi,
			(_m, css: string) => {
				inline.push(css);
				return "";
			},
		);

		const prepared = html;
		// `<style>` blocks were pulled into `inline` above, so fromHtml() has no CSS to add
		const rawSheets = [
			...sheets.sheets,
			`.help_box, .line { overflow: visible !important; max-height: none !important; }`,
			...inline,
		];
		const vars = new Map<string, string>();
		for (const s of rawSheets) collectRootVars(s, vars);
		const varsKey = createHash("sha1")
			.update([...vars].flat().join("\0"))
			.digest("hex");
		const sharedSheets = rawSheets.map((s) => transformSheet(s, vars, varsKey));
		const tAssets = performance.now();
		const local = await fitPaintImages(
			[...rewritten.images, ...sharedSheets.flatMap(collectCssImages)].map(
				(i) => ({
					src: i.src,
					data: i.data instanceof Uint8Array ? i.data : new Uint8Array(i.data),
					cache: "auto" as const,
				}),
			),
		);
		// One tree for both passes (the root's scale lives in the per-pass CSS)
		// Emoji images are fetched here, before the raster lock
		const remote = await withRemoteImages(
			fromHtml(wrapPixelRoot(prepared)).node,
			{ emoji: mayHaveEmoji(prepared) },
		);
		const assetsMs = performance.now() - tAssets;

		const paintQuality = opts.paintQuality ?? "fast";
		let height = opts.height;
		const heightKey = opts.heightKey
			? `${opts.heightKey}|w${width}`
			: undefined;
		let heightCached: "hit" | "miss" | undefined;
		if (height && height > 64 && heightKey) {
			heightCached = "hit";
			rememberHeight(heightKey, height);
			logger.info(`height cache hit ${heightKey} → ${height}`);
		} else if (!height && heightKey) {
			const cached = heightCache.get(heightKey);
			if (cached && cached > 64) {
				height = cached;
				heightCached = "hit";
				logger.info(`height cache hit ${heightKey} → ${cached}`);
			}
		}

		const renderer = await fontsReady;
		const fontFamilies = [...PHI_FONT_FAMILIES];
		const paintLocked = (node: Node, images: ImageSource[]) =>
			renderLock.run(async () => {
				let measureMs: number | undefined;
				if (!height) {
					signal?.throwIfAborted();
					const tMeasure = performance.now();
					const measured = await renderer.measure(node, {
						width,
						height: MEASURE_VIEWPORT_H,
						css: [...sharedSheets, rootBoxCss(width), measureRootCss(width)],
						images,
						fontFamilies,
						lang: "zh-CN",
						signal,
					});
					const boxH = measured.height || 0;
					const extent = Math.max(1, Math.ceil(contentExtent(measured)));
					let raw = Math.max(boxH, extent);
					if (
						extent >= MEASURE_VIEWPORT_H - 1 &&
						boxH > 64 &&
						boxH + MEASURE_SLACK_PX < extent
					) {
						raw = boxH;
					}
					height = Math.min(
						MEASURE_VIEWPORT_H,
						Math.max(1, Math.ceil(raw) + MEASURE_SLACK_PX),
					);
					measureMs = performance.now() - tMeasure;
					if (heightKey) heightCached = "miss";
					logger.info(
						`measured box ${measured.width}x${measured.height} content ${extent} using ${height}`,
					);
					if (heightKey && height > 64) rememberHeight(heightKey, height);
				}

				const paint = fitPaint(
					width,
					height,
					PIXEL_RATIO,
					paintQuality,
					maxRatio,
				);
				if (paint.ratio < PIXEL_RATIO) {
					logger.warn(
						`paint ${id} ${width}x${height} ratio ${paint.ratio.toFixed(3)} (Takumi ${paint.width}x${paint.height})`,
					);
				}
				signal?.throwIfAborted();
				const t0 = performance.now();
				const raw = await renderer.render(node, {
					width: paint.width,
					height: paint.height,
					format: "raw",
					css: [...sharedSheets, rootBoxCss(width), paintRootCss(width, paint)],
					images,
					fontFamilies,
					lang: "zh-CN",
					signal,
				});
				const rasterMs = performance.now() - t0;
				signal?.throwIfAborted();
				const encoded = await encodeRaw(raw, {
					width: paint.width,
					height: paint.height,
					format,
					quality,
				});
				return {
					encoded: { ...encoded, rasterMs },
					height,
					ratio: paint.ratio,
					measureMs,
				};
			}, signal);

		let painted: Awaited<ReturnType<typeof paintLocked>>;
		try {
			painted = await paintLocked(remote.node, [...local, ...remote.images]);
		} catch (err) {
			// A remote image that passed the byte sniff but that Takumi cannot
			// decode must not fail the card: find it, forget it, paint without it
			const broken =
				signal?.aborted || !remote.images.length
					? []
					: await undecodableImages(renderer, remote.images);
			if (!broken.length) throw err;
			logger.warn(
				`card ${id}: dropped undecodable remote images ${broken.join(", ")}`,
			);
			markRemoteImagesFailed(broken);
			const gone = new Set(broken);
			painted = await paintLocked(dropRemoteImages(remote.node, gone), [
				...local,
				...remote.images.filter((i) => !gone.has(i.src)),
			]);
		}
		const { encoded, ratio, measureMs } = painted;
		height = painted.height;

		const ms = performance.now() - started;
		const ratioLabel = Number.isInteger(ratio)
			? String(ratio)
			: ratio.toFixed(3);
		logger.ok(
			`card ${id} ${width}x${height} @${ratioLabel}x ${paintQuality} ${encoded.ext} ${encoded.bytes.length}B in ${Math.round(ms)}ms (raster ${fmtMs(encoded.rasterMs)} ${encoded.ext} ${fmtMs(encoded.encodeMs)})`,
		);
		return {
			bytes: encoded.bytes,
			mime: encoded.mime,
			ext: encoded.ext,
			width,
			height,
			timings: {
				assetsMs,
				measureMs,
				rasterMs: encoded.rasterMs,
				encodeMs: encoded.encodeMs,
				paintMs: ms,
				heightCache: heightCached,
			},
		};
	}

	async renderTemplate(
		def: TemplateDefinition,
		data: Record<string, unknown>,
		helpers: {
			compileArt: (page: string, data: Record<string, unknown>) => string;
			resources: string;
		},
		opts: {
			heightKey?: string;
			height?: number;
			paintQuality?: PaintQuality;
			signal?: AbortSignal;
		} = {},
	): Promise<RenderedImage> {
		const started = performance.now();
		opts.signal?.throwIfAborted();
		const tHtml = performance.now();
		const html = await def.html(data, helpers);
		const htmlMs = performance.now() - tHtml;
		const img = await this.renderHtml(html, {
			width: def.width,
			height: opts.height ?? def.height,
			format: def.format,
			quality: def.quality,
			baseDir: helpers.resources,
			id: def.id,
			heightKey: opts.heightKey,
			paintQuality: opts.paintQuality,
			maxRatio: def.maxRatio,
			signal: opts.signal,
		});
		logger.info(
			`renderTemplate ${def.id} total ${fmtMs(performance.now() - started)}`,
		);
		return withHtmlMs(img, htmlMs);
	}

	async close() {
		this.renderer = undefined;
		this.fontsReady = undefined;
		this.fontQueue = [...this.fonts];
	}
}

/** Remote images Takumi fails to decode, each tried alone on a 1×1 canvas */
async function undecodableImages(
	renderer: Renderer,
	images: ImageSource[],
): Promise<string[]> {
	const out: string[] = [];
	for (const image of images) {
		try {
			await renderer.render(
				{ type: "image", src: image.src, width: 1, height: 1 },
				{
					width: 1,
					height: 1,
					format: "raw",
					images: [{ ...image, cache: "none" }],
				},
			);
		} catch {
			out.push(image.src);
		}
	}
	return out;
}

/** Takumi's raw RGBA pixmap → the template's format. The pixmap is passed as-is (no copy) */
async function encodeRaw(
	raw: Buffer,
	opts: {
		width: number;
		height: number;
		format: RenderFormat;
		quality: number;
	},
): Promise<{ bytes: Buffer; mime: string; ext: string; encodeMs: number }> {
	const expected = opts.width * opts.height * 4;
	if (raw.byteLength !== expected) {
		throw new Error(
			`raw pixmap ${raw.byteLength}B != ${opts.width}x${opts.height}x4 (${expected}B)`,
		);
	}
	const t1 = performance.now();
	const pipeline = sharp(raw, {
		raw: { width: opts.width, height: opts.height, channels: 4 },
	});
	const bytes =
		opts.format === "jpeg"
			? await pipeline.jpeg({ quality: opts.quality }).toBuffer()
			: opts.format === "webp"
				? await pipeline.webp({ quality: opts.quality }).toBuffer()
				: await pipeline.png({ compressionLevel: 1 }).toBuffer();
	return {
		bytes,
		mime: mime(opts.format),
		ext: ext(opts.format),
		encodeMs: performance.now() - t1,
	};
}
