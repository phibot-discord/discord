import { createHash } from "node:crypto";
import sharp from "sharp";
import {
	exists,
	mkdirp,
	readdir,
	remove,
	rename,
	stat,
	touch,
} from "../../../src/vfs.ts";

const cacheDir = "/tmp/phi-web-ill-blur";
/** Blurred backgrounds are 5–9 MB: keep 24 files (~220 MB of /tmp), least recently used first */
const BLUR_CACHE_FILES = 24;
/**
 * A hit bumps the mtime at most this often: the render's asset cache keys on
 * mtime, so bumping it on every hit re-read the 5–9 MB PNG on every render
 */
const BLUR_TOUCH_MS = 60 * 60_000;

/**
 * Marks a cached blur as recently used, unless it already was within
 * BLUR_TOUCH_MS. Returns whether the mtime moved
 */
export function markBlurUsed(path: string, now = Date.now()): boolean {
	try {
		if (now - stat(path).mtimeMs < BLUR_TOUCH_MS) return false;
		touch(path);
		return true;
	} catch {
		return false;
	}
}

/** Keeps the `keep` most recently used PNGs in `dir` */
export function pruneBlurCache(dir = cacheDir, keep = BLUR_CACHE_FILES) {
	const files: { path: string; at: number }[] = [];
	for (const name of readdir(dir)) {
		if (!name.endsWith(".png")) continue;
		const path = `${dir}/${name}`;
		try {
			files.push({ path, at: stat(path).mtimeMs });
		} catch {}
	}
	if (files.length <= keep) return;
	files.sort((a, b) => b.at - a.at);
	for (const file of files.slice(keep)) remove(file.path);
}

function localFile(src: string): string | undefined {
	if (!src || /^(https?:|data:|cid:)/i.test(src)) return undefined;
	const file = src.startsWith("file://")
		? decodeURIComponent(src.replace(/^file:\/\//, ""))
		: src;
	if (!exists(file)) return undefined;
	return file;
}

async function blurredFile(src: string, fallbackSigma = 10): Promise<string> {
	const file = localFile(src);
	if (!file) return src;
	if (/[/\\]illBlur[/\\]/.test(file)) return file;
	if (/Star[12]\.png$/i.test(file)) return file;
	const sigma = fallbackSigma;
	mkdirp(cacheDir);
	const st = stat(file);
	const key = createHash("sha1")
		.update(`${file}:${st.mtimeMs}:${st.size}:${sigma}:cover`)
		.digest("hex");
	const out = `${cacheDir}/${key}.png`;
	if (exists(out)) {
		markBlurUsed(out);
		return out;
	}
	// Written aside and renamed, so a concurrent render never reads half a PNG
	const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	await sharp(file)
		.rotate()
		.resize({ width: 1800, height: 1800, fit: "cover" })
		.blur(sigma)
		.modulate({ brightness: 0.62 })
		.png({ compressionLevel: 1 })
		.toFile(tmp);
	rename(tmp, out);
	try {
		pruneBlurCache();
	} catch {}
	return out;
}

export async function blurCardBackgrounds(html: string): Promise<string> {
	const blockRe =
		/<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
	const srcs = new Set<string>();
	for (const m of html.matchAll(blockRe)) {
		for (const im of m[0].matchAll(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi)) {
			if (im[2]) srcs.add(im[2]);
		}
	}
	const blurred = new Map<string, string>();
	await Promise.all(
		[...srcs].map(async (src) => {
			blurred.set(src, await blurredFile(src));
		}),
	);
	let out = "";
	let last = 0;
	for (const m of html.matchAll(blockRe)) {
		const start = m.index ?? 0;
		out += html.slice(last, start);
		let block = m[0];
		const imgs = [...block.matchAll(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi)];
		for (let i = imgs.length - 1; i >= 0; i--) {
			const im = imgs[i]!;
			const at = im.index ?? 0;
			const next = blurred.get(im[2]!) ?? im[2]!;
			block = `${block.slice(0, at)}${im[1]}${next}${im[3]}${block.slice(at + im[0].length)}`;
		}
		out += block;
		last = start + m[0].length;
	}
	return out + html.slice(last);
}

/** Blurred ills are darkened ~0.62; 0.40 still treats navy as dark */
const LIGHT_LUMA = 0.4;
type Luma = { top: number; bottom: number };
/** Keyed by path + stamp; holds the in-flight sample so concurrent renders decode once */
const lumaCache = new Map<string, Promise<Luma>>();
const LUMA_CACHE_MAX = 256;
/** Sample grid: 48 columns, 100 rows, so a 12% band is 12 rows (576 pixels) */
const SAMPLE_W = 48;
const SAMPLE_H = 100;
const BAND_ROWS = 12;

function ink(lightBg: boolean) {
	return lightBg
		? {
				color: "#000000",
				shadow: "0 0 6px rgba(255,255,255,0.85)",
			}
		: {
				color: "#ffffff",
				shadow: "0 0 6px rgba(0,0,0,0.75)",
			};
}

function bandMedian(
	data: Uint8Array,
	channels: number,
	width: number,
	row0: number,
	rows: number,
) {
	const values: number[] = [];
	const end = (row0 + rows) * width * channels;
	for (let i = row0 * width * channels; i < end; i += channels) {
		values.push(
			0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!,
		);
	}
	if (!values.length) return 0.25;
	values.sort((a, b) => a - b);
	return (values[Math.floor(values.length / 2)] ?? 64) / 255;
}

/**
 * Median luma of the top and bottom 12% of an image, from one small resize
 * (a single decode of the background instead of two full decodes)
 */
export async function sampleLuma(file: string): Promise<Luma> {
	const { data, info } = await sharp(file)
		.rotate()
		.resize(SAMPLE_W, SAMPLE_H, { fit: "fill" })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		top: bandMedian(data, info.channels, info.width, 0, BAND_ROWS),
		bottom: bandMedian(
			data,
			info.channels,
			info.width,
			info.height - BAND_ROWS,
			BAND_ROWS,
		),
	};
}

/** `sampleLuma` once per file: blur cache paths are content-hashed, so the path is the version */
export function backgroundLuma(
	file: string,
	blurDir: string = cacheDir,
): Promise<Luma> {
	let key = file;
	if (!file.startsWith(`${blurDir}/`)) {
		const st = stat(file);
		key = `${file}|${st.mtimeMs}|${st.size}`;
	}
	const hit = lumaCache.get(key);
	if (hit) return hit;
	const job = sampleLuma(file);
	job.catch(() => lumaCache.delete(key));
	if (lumaCache.size >= LUMA_CACHE_MAX) {
		const oldest = lumaCache.keys().next().value;
		if (oldest !== undefined) lumaCache.delete(oldest);
	}
	lumaCache.set(key, job);
	return job;
}

function backgroundSrc(html: string) {
	const star = /<img class="star-base"[^>]*src="([^"]+)"/i.exec(html)?.[1];
	if (star) return star;
	const block =
		/<div\b[^>]*class="[^"]*\bbackground\b[^"]*"[^>]*>[\s\S]*?<\/div>/i.exec(
			html,
		)?.[0];
	const bg = block ? /<img\b[^>]*\bsrc="([^"]+)"/i.exec(block)?.[1] : undefined;
	if (bg) return bg;
	return /<div class="ill">\s*<img\b[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1];
}

function inkCss(sel: string, lightBg: boolean) {
	const { color, shadow } = ink(lightBg);
	return `${sel} { color: ${color} !important; text-shadow: ${shadow} !important; }`;
}

function stampInk(html: string, re: RegExp, light: boolean) {
	const { color, shadow } = ink(light);
	const extra = `color:${color};text-shadow:${shadow};`;
	return html.replace(re, (_full, open: string, rest: string) => {
		if (/\sstyle="/i.test(rest)) {
			return `${open}${rest.replace(/style="/i, `style="${extra}`)}`;
		}
		return `${open}${rest.replace(/>$/, ` style="${extra}">`)}`;
	});
}

export async function contrastOverBackground(html: string): Promise<string> {
	const src = backgroundSrc(html);
	const file = src ? localFile(src) : undefined;
	let topLight = false;
	let bottomLight = false;
	if (file) {
		try {
			const luma = await backgroundLuma(file);
			topLight = luma.top >= LIGHT_LUMA;
			bottomLight = luma.bottom >= LIGHT_LUMA;
		} catch {
			topLight = false;
			bottomLight = false;
		}
	}
	let out = html;
	out = stampInk(out, /(<div class="date">\s*<p)([^>]*>)/i, topLight);
	out = stampInk(
		out,
		/(<div class="tips(?:-abs)?"[^>]*>\s*<p)([^>]*>)/gi,
		bottomLight,
	);
	const css = `<style>
    ${inkCss(".playerInfo .date p, .date p, .row-date p, .descTip p", topLight)}
    ${inkCss(".tips p, .tips-abs p", bottomLight)}
  </style>`;
	if (out.includes("</head>")) return out.replace("</head>", `${css}</head>`);
	return css + out;
}
