import { extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import template from "art-template/lib/index.js";
import { artFactories } from "../../plugins/phi/art-compiled.ts";
import { exists, readFile } from "../vfs.ts";
import {
	type ArtFactory,
	type ArtRenderOptions,
	artImports,
	artKey,
	resolveArtPath,
} from "./art-runtime.ts";
import { readAssetCached } from "./asset-cache.ts";

type ArtCompile = (opts: Record<string, unknown>) => (data: object) => string;
type ArtEngine = ((file: string, data: object) => string) & {
	compile: ArtCompile;
	defaults?: Record<string, unknown>;
};

const factories = artFactories as Record<string, ArtFactory>;

function artEngine(): ArtEngine {
	const mod = template as unknown as { default?: unknown };
	const engine = (
		typeof template === "function" ? template : mod.default
	) as ArtEngine;
	if (typeof engine !== "function" || typeof engine.compile !== "function") {
		throw new Error("art-template compile is missing");
	}
	return engine;
}

function loadArt(filename: string) {
	return readFile(filename, "utf8");
}

function configureArt() {
	const origWarn = console.warn.bind(console);
	console.warn = (...args: unknown[]) => {
		const text = args
			.map((a) => (typeof a === "string" ? a : String(a)))
			.join(" ");
		if (text.includes("Template upgrade:")) return;
		origWarn(...(args as Parameters<typeof origWarn>));
	};
	try {
		const defaults = artEngine().defaults;
		if (!defaults) return;
		defaults.escape = true;
		defaults.cache = true;
		defaults.debug = false;
		defaults.minimize = false;
		defaults.loader = loadArt;
	} catch {}
}

configureArt();

function renderOptions(filename: string): ArtRenderOptions {
	const options: ArtRenderOptions = {
		filename,
		resolveFilename: (src, opts) => resolveArtPath(src, opts.filename),
		include: (src, data, blocks, opts) => {
			const resolved = opts.resolveFilename(src, opts);
			const key = artKey(resolved);
			const factory = factories[key];
			if (!factory) throw new Error(`template not found: ${resolved}`);
			return factory(artImports, renderOptions(resolved))(
				data,
				blocks as object | undefined,
			);
		},
	};
	return options;
}

function renderPrecompiled(
	file: string,
	data: Record<string, unknown>,
): string {
	const key = artKey(file);
	const factory = factories[key];
	if (!factory) throw new Error(`precompiled art missing: ${key}`);
	return factory(artImports, renderOptions(file))(data);
}

export function compileArt(
	file: string,
	data: Record<string, unknown>,
): string {
	if (!exists(file)) throw new Error(`template not found: ${file}`);
	if (factories[artKey(file)]) return renderPrecompiled(file, data);
	return artEngine().compile({
		filename: file,
		source: loadArt(file),
		loader: loadArt,
		escape: true,
		cache: true,
		debug: false,
		minimize: false,
		bail: true,
	})(data);
}

const SRC_RE = /\b(?:src|href)=["']([^"']+)["']/gi;

export type ImageAsset = { src: string; data: Buffer };

function localFileFromSpec(spec: string, baseDir: string): string | undefined {
	if (/^(data:|https?:|cid:|#|phi-css:)/i.test(spec)) return undefined;
	let file = spec.startsWith("file://")
		? decodeURIComponent(spec.replace(/^file:\/\//, ""))
		: spec;
	if (!isAbsolute(file) && !file.startsWith("phi-css://"))
		file = resolve(baseDir, file);
	return file;
}

export function collectLocalAssetPaths(
	html: string,
	baseDir: string,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const m of html.matchAll(SRC_RE)) {
		const spec = m[1];
		if (!spec) continue;
		const file = localFileFromSpec(spec, baseDir);
		if (!file || seen.has(file)) continue;
		seen.add(file);
		out.push(file);
	}
	return out;
}

export function rewriteLocalUrls(
	html: string,
	baseDir: string,
): { html: string; images: ImageAsset[] } {
	SRC_RE.lastIndex = 0;
	const images: ImageAsset[] = [];
	const seen = new Set<string>();
	const html2 = html.replace(SRC_RE, (m, spec: string) => {
		if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(spec)) {
			if (!seen.has(spec)) {
				seen.add(spec);
				images.push({
					src: spec,
					data: Buffer.from(spec.slice(spec.indexOf(",") + 1), "base64"),
				});
			}
			return m;
		}
		if (/^(data:|https?:|cid:|#|phi-css:)/i.test(spec)) return m;
		let file = spec.startsWith("file://")
			? decodeURIComponent(spec.replace(/^file:\/\//, ""))
			: spec;
		if (!isAbsolute(file) && !file.startsWith("phi-css://"))
			file = resolve(baseDir, file);
		if (!exists(file)) return m;
		const url = file.startsWith("phi-css://") ? file : pathToFileURL(file).href;
		if (!seen.has(url) && isImage(file)) {
			seen.add(url);
			images.push({ src: url, data: readAssetCached(file) });
		}
		return m.replace(spec, url);
	});
	return { html: html2, images };
}

function isImage(file: string) {
	return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"].includes(
		extname(file).toLowerCase(),
	);
}
