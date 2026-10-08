import { join, resolve } from "node:path";
import { exists, readFileAsync } from "../vfs.ts";
import { logger } from "../logger.ts";
import type { FontEntry } from "../sdk/index.ts";

/** Map bundled font filenames to CSS font-family names in common.css */
export const PHI_FONT_FILES: Record<string, string> = {
	"phi.woff2": "PHI",
	"吞弥恰俊.woff2": "吞弥恰俊",
	"HIMALAYA.woff2": "HIMALAYA",
	"NotoSans-Regular.woff2": "NOTO",
	"NotoSansSymbols2.woff2": "NotoSansSymbols2",
	"NotoSansArabic.woff2": "NotoSansArabic",
	"NotoSansJP.woff2": "NotoSansJP",
	"Aldrich-Regular.woff2": "Aldrich",
	"NotoSansKannada.woff2": "NotoSansKannada",
	"NotoSansCanadianAboriginal.woff2": "NotoSansCanadianAboriginal",
	"NotoSansMath-Regular.woff2": "NotoSansMath-Regular",
	"noto-sans-sc-400.woff2": "NotoSansSC",
};

/** Faces shipped from src/fonts (traced by next.config.ts) */
const APP_FONTS = new Set(["noto-sans-sc-400.woff2"]);

/** Default Takumi fallback after CSS `font-family`. NotoSansSC before PHI so CJK never tofus */
export const PHI_FONT_FAMILIES = [
	"NotoSansSC",
	"PHI",
	"Aldrich",
	"NotoSansJP",
	"NOTO",
	"NotoSansArabic",
	"NotoSansSymbols2",
	"NotoSansKannada",
	"NotoSansCanadianAboriginal",
	"HIMALAYA",
	"吞弥恰俊",
	"NotoSansMath-Regular",
] as const;

/** `<app root>/src/fonts`, ignored by the tracer; next.config.ts lists the file */
export function appFontDir(): string {
	const root = process.env.PHI_APP_ROOT?.trim();
	const base = root ? resolve(root) : process.cwd();
	return join(/*turbopackIgnore: true*/ base, "src/fonts");
}

async function readFont(
	dirs: string[],
	name: string,
): Promise<Buffer | undefined> {
	for (const dir of dirs) {
		const file = join(dir, name);
		try {
			if (exists(file)) return await readFileAsync(file);
		} catch {}
	}
	return undefined;
}

export async function loadFontsFromDir(
	dir: string,
	map: Record<string, string> = PHI_FONT_FILES,
	appDir = appFontDir(),
): Promise<FontEntry[]> {
	const entries = Object.entries(map);
	// ~11 MB of woff2, read in parallel off the event loop
	const data = await Promise.all(
		entries.map(([name]) =>
			readFont(APP_FONTS.has(name) ? [appDir, dir] : [dir, appDir], name),
		),
	);
	const out: FontEntry[] = [];
	entries.forEach(([name, family], i) => {
		const bytes = data[i];
		if (!bytes) {
			logger.warn(`font miss ${name}`);
			return;
		}
		out.push({
			name: family,
			data: bytes,
			weight: 400,
			style: "normal",
			generic:
				family === "PHI" || family === "NotoSansSC" ? "sans-serif" : undefined,
		});
	});
	if (!out.some((f) => f.name === "PHI")) {
		logger.error("PHI font missing — CJK will render as missing glyphs");
	} else {
		logger.ok(`fonts ${out.map((f) => f.name).join(", ")}`);
	}
	return out;
}
