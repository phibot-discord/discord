import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exists, readFile, stat } from "../vfs.ts";

const flattenCache = new Map<string, { stamp: string; css: string }>();
const FLATTEN_CACHE_MAX = 64;

const IMPORT_RE = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi;
const URL_RE = /url\((['"]?)([^'")]+)\1\)/gi;

function flattenCss(
	source: string,
	fromFile: string,
	seen = new Set<string>(),
): string {
	const abs = fromFile.startsWith("phi-css://") ? fromFile : resolve(fromFile);
	if (seen.has(abs)) return "";
	seen.add(abs);
	let css = source;
	css = css.replace(IMPORT_RE, (_m, spec: string) => {
		const target = resolveCssPath(abs, spec.trim());
		if (!exists(target)) return `/* missing import ${spec} */`;
		return flattenCss(readFile(target, "utf8"), target, seen);
	});
	css = css.replace(URL_RE, (m, _q: string, url: string) => {
		if (/^(data:|https?:|file:|phi-css:)/i.test(url)) return m;
		const file = resolveCssPath(abs, url);
		if (!exists(file)) return m;
		if (file.startsWith("phi-css://")) return `url("${file}")`;
		return `url("${pathToFileURL(file).href}")`;
	});
	css = css.replace(/@font-face\s*\{[^}]*\}/gi, "");
	return css;
}

function resolveCssPath(fromFile: string, spec: string): string {
	if (spec.startsWith("phi-css://") || fromFile.startsWith("phi-css://")) {
		if (spec.startsWith("phi-css://")) return spec;
		return `phi-css://${spec.replace(/^\.\//, "")}`;
	}
	return resolve(dirname(fromFile), spec);
}

export function stripUnsupportedCss(css: string) {
	return css
		.replace(/backdrop-filter\s*:[^;{}]+;?/gi, "")
		.replace(/(?<![-a-z])filter\s*:[^;{}]+;?/gi, "")
		.replace(/transform\s*:[^;{}]*perspective[^;{}]*;?/gi, "transform: none;")
		.replace(/transform\s*:[^;{}]*rotate[3YXZ][^;{}]*;?/gi, "transform: none;")
		.replace(/transform\s*:[^;{}]*rotate3d[^;{}]*;?/gi, "transform: none;")
		.replace(/transform\s*:[^;{}]*skew[^;{}]*;?/gi, "transform: none;")
		.replace(/transform\s*:[^;{}]*scaleY[^;{}]*;?/gi, "transform: none;");
}

export function collectRootVars(
	css: string,
	into = new Map<string, string>(),
): Map<string, string> {
	const blocks = css.matchAll(/(?::root|html)\s*\{([^{}]*)\}/gi);
	for (const block of blocks) {
		const body = block[1];
		if (!body) continue;
		for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
			const name = m[1];
			const value = m[2];
			if (!name || !value) continue;
			into.set(`--${name}`, value.trim());
		}
	}
	return into;
}

/** Expand var(--x) / var(--x, fallback) */
export function resolveCssVars(css: string, vars: Map<string, string>): string {
	let out = css;
	for (let i = 0; i < 8; i++) {
		const next = out.replace(
			/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*((?:[^()]+|\([^()]*\))*))?\)/gi,
			(_m, name: string, fallback?: string) =>
				vars.get(name) ?? fallback?.trim() ?? _m,
		);
		if (next === out) break;
		out = next;
	}
	return out;
}

function hrefToPath(href: string, htmlDir: string): string {
	if (href.startsWith("phi-css://")) return href;
	if (href.startsWith("file:")) {
		try {
			return fileURLToPath(href);
		} catch {
			return decodeURIComponent(href.replace(/^file:\/\//, ""));
		}
	}
	if (isAbsolute(href)) return href;
	return resolve(htmlDir, href);
}

export function collectStylesheets(
	html: string,
	htmlDir: string,
): { html: string; sheets: string[] } {
	const sheets: string[] = [];
	const stripped = html.replace(
		/<link[^>]+rel=["']stylesheet["'][^>]*>/gi,
		(tag) => {
			const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
			if (!href) return "";
			const path = hrefToPath(href, htmlDir);
			if (exists(path)) sheets.push(flattenCssCached(path));
			return "";
		},
	);
	return { html: stripped, sheets };
}

function flattenCssCached(path: string): string {
	let stamp = "phi-css";
	try {
		const s = stat(path);
		stamp = `${s.mtimeMs}|${s.size}`;
	} catch {}
	const hit = flattenCache.get(path);
	if (hit && hit.stamp === stamp) return hit.css;
	const css = flattenCss(readFile(path, "utf8"), path);
	if (flattenCache.size >= FLATTEN_CACHE_MAX) {
		const oldest = flattenCache.keys().next().value;
		if (oldest !== undefined) flattenCache.delete(oldest);
	}
	flattenCache.set(path, { stamp, css });
	return css;
}

export function stripScripts(html: string): string {
	return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}
