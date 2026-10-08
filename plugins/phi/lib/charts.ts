/** Static SVG charts */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

export type LineSeg = [number, number, number, number];

function n(v: number, d = 2) {
	return Number.isFinite(v) ? v.toFixed(d) : "0";
}

function esc(s: string) {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] || c,
	);
}

function percentLineChartSvg(
	segs: LineSeg[],
	opts: { stroke?: string; width?: number; height?: number } = {},
) {
	const stroke = opts.stroke || "#ffffff";
	const w = opts.width ?? 100;
	const h = opts.height ?? 100;
	const parts: string[] = [];
	const pts = new Map<string, { x: number; y: number }>();
	for (const [x1, y1, x2, y2] of segs) {
		const a = { x: x1, y: 100 - y1 };
		const b = { x: x2, y: 100 - y2 };
		parts.push(`M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}`);
		pts.set(`${n(a.x)}:${n(a.y)}`, a);
		pts.set(`${n(b.x)}:${n(b.y)}`, b);
	}
	const circles = [...pts.values()]
		.map(
			(p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="1.5" fill="${stroke}"/>`,
		)
		.join("");
	return (
		`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ` +
		`style="width:100%;height:100%;overflow:visible;display:block;transform:none;">` +
		`<path d="${parts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="1.8" ` +
		`stroke-linejoin="round" stroke-linecap="round"/>${circles}</svg>`
	);
}

type TagRadarPlot = {
	grids: string[];
	axes: { x: number; y: number }[];
	points: string;
	categories: {
		name: string;
		displayRks: string;
		pointX: number;
		pointY: number;
		labelX: number;
		labelY: number;
		anchor: "start" | "middle" | "end";
	}[];
};

function labelShift(anchor: "start" | "middle" | "end") {
	if (anchor === "end") return "translate(-100%, -10px)";
	if (anchor === "start") return "translate(0, -10px)";
	return "translate(-50%, -10px)";
}

function radarNameAlign(anchor: "start" | "middle" | "end") {
	if (anchor === "end") return "right";
	if (anchor === "start") return "left";
	return "center";
}

/** Keep the hyphen on the first line so "Multi-Finger" stacks as Multi- / Finger */
function splitRadarName(name: string): string[] {
	const cut = name.indexOf("-");
	if (cut <= 0 || cut >= name.length - 1) return [name];
	return [name.slice(0, cut + 1), name.slice(cut + 1)];
}

function radarNameHtml(
	name: string,
	anchor: "start" | "middle" | "end",
): string {
	const align = radarNameAlign(anchor);
	return splitRadarName(name)
		.map(
			(line) =>
				`<p class="tag-radar-html-name" style="margin:0;color:#ffffff;font-size:10px;line-height:1.15;white-space:nowrap;text-align:${align};">${esc(line)}</p>`,
		)
		.join("");
}

function radarLabels(radar: TagRadarPlot) {
	return radar.categories
		.map((category) => {
			const score = esc(category.displayRks);
			return (
				`<div class="tag-radar-html-label is-${category.anchor}" style="position:absolute;left:${category.labelX}px;top:${category.labelY}px;transform:${labelShift(category.anchor)};text-align:${radarNameAlign(category.anchor)};">` +
				radarNameHtml(category.name, category.anchor) +
				`<p class="tag-radar-html-score" style="margin:2px 0 0;color:#00b7f0;font-size:8px;line-height:1;white-space:nowrap;">${score}</p>` +
				`</div>`
			);
		})
		.join("");
}

export function tagRadarPlotSvg(radar: TagRadarPlot, scale = 1) {
	const grids = radar.grids
		.map(
			(grid) =>
				`<polygon points="${grid}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>`,
		)
		.join("");
	const axes = radar.axes
		.map(
			(axis) =>
				`<line x1="100" y1="92" x2="${axis.x}" y2="${axis.y}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1"/>`,
		)
		.join("");
	const shape = radar.points
		? `<polygon points="${radar.points}" fill="#ffffff" fill-opacity="0.92" stroke="#ffffff" stroke-width="2"/>`
		: "";
	const dots = radar.categories
		.map(
			(category) =>
				`<circle cx="${category.pointX}" cy="${category.pointY}" r="3.2" fill="#ffffff" stroke="#ffffff" stroke-width="1"/>`,
		)
		.join("");
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${200 * scale}" height="${184 * scale}" viewBox="0 0 200 184">` +
		`${grids}${axes}${shape}${dots}</svg>`
	);
}

export async function tagRadarPlotPng(radar: TagRadarPlot) {
	return sharp(Buffer.from(tagRadarPlotSvg(radar, 2)))
		.png({ compressionLevel: 1 })
		.toBuffer();
}

/** Keyed by the SVG source, so an already-plotted radar skips the rasterisation */
async function radarPlotFileSrc(radar: TagRadarPlot) {
	const svg = tagRadarPlotSvg(radar, 2);
	const dir = join(tmpdir(), "phi-tag-radar");
	const file = join(
		dir,
		`${createHash("sha1").update(svg).digest("hex").slice(0, 20)}.png`,
	);
	if (!existsSync(file)) {
		mkdirSync(dir, { recursive: true });
		const png = await sharp(Buffer.from(svg))
			.png({ compressionLevel: 1 })
			.toBuffer();
		const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
		writeFileSync(tmp, png);
		renameSync(tmp, file);
	}
	return pathToFileURL(file).href;
}

/** Plot is a PNG file so Takumi uses the same image path as song ills */
export async function tagRadarHtml(radar: TagRadarPlot) {
	const src = await radarPlotFileSrc(radar);
	return (
		`<div class="tag-radar" style="width:200px;height:184px;position:relative;flex:none;overflow:visible;margin-left:16px;">` +
		`<img class="tag-radar-plot" width="200" height="184" src="${src}" style="width:200px;height:184px;max-width:200px;max-height:184px;display:block;flex:none;padding:0;margin:0;object-fit:fill;position:relative;z-index:2;top:auto;right:auto;bottom:auto;left:auto;transform:none;min-width:200px;min-height:184px;"/>` +
		radarLabels(radar) +
		`</div>`
	);
}

function paintTagRadarSvg(html: string) {
	if (!html.includes("tag-radar")) return html;
	return html.replace(
		/<svg\b[^>]*class="[^"]*\btag-radar\b[^"]*"[^>]*>[\s\S]*?<\/svg>/i,
		"",
	);
}

/** userinfo.art draws its rks/acc lines as percent-coordinate <line>s; Takumi wants paths */
export function polishSvgCharts(html: string) {
	return paintTagRadarSvg(replacePercentSvgLines(html));
}

function replacePercentSvgLines(html: string) {
	return html.replace(
		/<svg\b[^>]*>([\s\S]*?)<\/svg>/g,
		(full, inner: string) => {
			const hits = [
				...inner.matchAll(
					/<line\b[^>]*x1="([\d.]+)%"[^>]*y1="([\d.]+)%"[^>]*x2="([\d.]+)%"[^>]*y2="([\d.]+)%"[^>]*\/?\s*>/g,
				),
			];
			if (!hits.length) return full;
			const segs: LineSeg[] = hits.map((h) => [
				Number(h[1]),
				Number(h[2]),
				Number(h[3]),
				Number(h[4]),
			]);
			return percentLineChartSvg(segs);
		},
	);
}
