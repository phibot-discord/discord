import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Renderer } from "@takumi-rs/core";
import sharp from "sharp";
import { render } from "takumi-js";
import { fromHtml } from "takumi-js/helpers/html";
import { loadFontsFromDir, PHI_FONT_FILES } from "../../../src/render/fonts.ts";
import { layoutHistogram } from "./histogram.ts";

const art = `<div class="histogram-summary">
<p class="histogram-avg-label">Average RKS</p>
<p>16.3335</p>
</div>
<div class="histogram-chart">
<div class="histogram-plot">
<div class="histogram-y-ticks">
<p class="histogram-y-tick" style="bottom: 0%;">16.00</p>
<p class="histogram-y-tick" style="bottom: 50%;">16.25</p>
<p class="histogram-y-tick" style="bottom: 100%;">16.50</p>
</div>
<div class="histogram-y-label">Per-chart RKS</div>
<div class="histogram-scale">
<div class="histogram-grid-line" style="bottom: 0%;"></div>
<div class="histogram-grid-line" style="bottom: 50%;"></div>
<div class="histogram-grid-line" style="bottom: 100%;"></div>
<div class="average-marker" style="bottom: 66%;"><p>AVG 16.3335</p></div>
</div>
<div class="histogram-bars">
<div class="histogram-slot"><div class="histogram-bar-area"><div class="histogram-bar phi-bar" style="height: 90%;"></div></div><p class="histogram-slot-label">P1</p></div>
<div class="histogram-slot"><div class="histogram-bar-area"><div class="histogram-bar best-bar" style="height: 80%;"></div></div><p class="histogram-slot-label">B12</p></div>
</div>
</div>
</div>`;

test("layoutHistogram keeps ticks in-flow and stacks slot labels", () => {
	const out = layoutHistogram(art);
	assert.match(out, /class="histogram-y-tick" style="[^"]*bottom:0px/);
	assert.match(out, /class="histogram-y-tick" style="[^"]*bottom:68px/);
	assert.match(out, /class="histogram-y-tick" style="[^"]*bottom:136px/);
	assert.match(out, /left:40px/);
	assert.match(out, /<span>Per-chart<\/span><span>RKS<\/span>/);
	assert.match(out, /<span>P<\/span><span>1<\/span>/);
	assert.match(out, /<span>B<\/span><span>12<\/span>/);
	assert.doesNotMatch(out, /left:-36px/);
	assert.doesNotMatch(out, /rotate\(-90deg\)/);
	assert.doesNotMatch(out, /margin-left:42px/);
	assert.match(out, /class="histogram-bar phi-bar" style="height:122px;/);
	assert.match(out, /AVG 16.3335/);
});

function fixtureHtml(laidOut: string): string {
	return (
		`<div style="width:489px;height:340px;background:#071018;padding:15px 28px 22px;box-sizing:border-box;">` +
		`<div class="analysis-panel-head">` +
		`<div><p class="analysis-kicker">RKS DISTRIBUTION</p>` +
		`<p class="analysis-title" style="font-size:16px;white-space:nowrap;color:#fff;">Equivalent RKS histogram</p></div>` +
		laidOut.slice(0, laidOut.indexOf('<div class="histogram-chart"')) +
		`</div>` +
		laidOut.slice(laidOut.indexOf('<div class="histogram-chart"')) +
		`<div class="histogram-legend"><p>30 slots</p></div>` +
		`</div>`
	);
}

async function renderTakumi(
	html: string,
	width: number,
	height: number,
): Promise<Buffer> {
	const renderer = new Renderer();
	const fonts = await loadFontsFromDir(
		fileURLToPath(
			new URL("../../../phi-assets/html/common/font", import.meta.url),
		),
		PHI_FONT_FILES,
	);
	for (const f of fonts) {
		await renderer.registerFont({
			name: f.name,
			data: f.data,
			weight: f.weight ?? 400,
			style: f.style ?? "normal",
			generic: f.generic,
		});
	}
	return Buffer.from(
		await render(fromHtml(html).node, {
			renderer,
			width,
			height,
			format: "png",
			fontFamilies: fonts.map((f) => f.name),
			css: [
				readFileSync(
					new URL("../../../phi-assets/html/b19/b19.css", import.meta.url),
					"utf8",
				),
				readFileSync(new URL("../css/takumi.css", import.meta.url), "utf8"),
			],
		} as never),
	);
}

async function pixels(bytes: Buffer) {
	const painted = await sharp(bytes).raw().ensureAlpha().toBuffer({
		resolveWithObject: true,
	});
	const w = painted.info.width;
	const h = painted.info.height;
	const at = (x: number, y: number) => {
		const i = (y * w + x) * 4;
		return [
			painted.data[i]!,
			painted.data[i + 1]!,
			painted.data[i + 2]!,
		] as const;
	};
	return { w, h, at };
}

const isCyan = (r: number, g: number, b: number) =>
	b > 140 && g > 90 && r < 80 && b > r + 40;

test("Takumi paints a single histogram with a left RKS gutter", async () => {
	const slots = [
		...[1, 2, 3].map((n) => ({
			label: `P${n}`,
			kind: "phi",
			height: 92 - n * 4,
		})),
		...Array.from({ length: 27 }, (_, i) => ({
			label: `B${i + 1}`,
			kind: "best",
			height: 80 - i * 1.6,
		})),
	];
	const ticks = [0, 25, 50, 75, 100].map((p, i) => ({
		position: p,
		label: (16 + i * 0.25).toFixed(2),
	}));
	const raw =
		`<div class="histogram-summary"><p class="histogram-avg-label">Average RKS</p><p>16.3335</p></div>` +
		`<div class="histogram-chart"><div class="histogram-plot">` +
		`<div class="histogram-y-ticks">` +
		ticks
			.map(
				(t) =>
					`<p class="histogram-y-tick" style="bottom: ${t.position}%;">${t.label}</p>`,
			)
			.join("") +
		`</div><div class="histogram-y-label">Per-chart RKS</div>` +
		`<div class="histogram-scale">` +
		ticks
			.map(
				(t) =>
					`<div class="histogram-grid-line" style="bottom: ${t.position}%;"></div>`,
			)
			.join("") +
		`<div class="average-marker" style="bottom: 66%;"><p>AVG 16.3335</p></div></div>` +
		`<div class="histogram-bars">` +
		slots
			.map(
				(s) =>
					`<div class="histogram-slot"><div class="histogram-bar-area">` +
					`<div class="histogram-bar ${s.kind}-bar" style="height: ${s.height}%;"></div>` +
					`</div><p class="histogram-slot-label">${s.label}</p></div>`,
			)
			.join("") +
		`</div></div></div>`;
	const html = fixtureHtml(layoutHistogram(raw));
	const bytes = await renderTakumi(html, 489, 340);
	writeFileSync("/tmp/phi-histogram-fix.png", bytes);
	const { w, h, at } = await pixels(bytes);
	const isWhiteBar = (r: number, g: number, b: number) =>
		r > 180 && g > 180 && b > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 40;

	let titleCyan = 0;
	for (let y = 0; y < Math.min(52, h); y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b] = at(x, y);
			if (isCyan(r, g, b)) titleCyan++;
		}
	}
	let gutterCyan = 0;
	let gutterLight = 0;
	let plotCyan = 0;
	let plotWhite = 0;
	for (let y = 80; y < Math.min(230, h); y++) {
		for (let x = 0; x < Math.min(40, w); x++) {
			const [r, g, b] = at(x, y);
			if (isCyan(r, g, b)) gutterCyan++;
			if (r > 140 && g > 140 && b > 140) gutterLight++;
		}
		for (let x = 48; x < w; x++) {
			const [r, g, b] = at(x, y);
			if (isCyan(r, g, b)) plotCyan++;
			if (isWhiteBar(r, g, b)) plotWhite++;
		}
	}
	assert.ok(titleCyan < 80, `title overlapped bars: titleCyan=${titleCyan}`);
	assert.ok(
		gutterCyan < 40 && gutterLight > 20,
		`gutter broken: cyan=${gutterCyan} light=${gutterLight}`,
	);
	assert.ok(
		plotCyan > 400 && plotWhite > 80,
		`plot missing bars: cyan=${plotCyan} white=${plotWhite}`,
	);
	let firstCyanX = w;
	for (let y = 160; y < Math.min(250, h); y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b] = at(x, y);
			if (isCyan(r, g, b) && x < firstCyanX) firstCyanX = x;
		}
	}
	assert.ok(
		firstCyanX > 90,
		`cyan bars started too far left: firstCyanX=${firstCyanX}`,
	);
});

test("a bar at a tick's value reaches that grid line, and every bar stands on the axis", async () => {
	// 15.50-17.50 axis with a 17.0043 best: the bar used to stop 1px under the 17.00 line
	const raw =
		`<div class="histogram-chart"><div class="histogram-plot">` +
		`<div class="histogram-scale">` +
		[0, 25, 50, 75, 100]
			.map(
				(p) => `<div class="histogram-grid-line" style="bottom: ${p}%;"></div>`,
			)
			.join("") +
		`</div><div class="histogram-bars">` +
		`<div class="histogram-slot"><div class="histogram-bar-area">` +
		`<div class="histogram-bar best-bar" style="height: 75.215%;"></div>` +
		`</div><p class="histogram-slot-label">B1</p></div>` +
		`</div></div></div>`;
	const bytes = await renderTakumi(
		`<div style="width:240px;height:200px;background:#000;">${layoutHistogram(raw)}</div>`,
		240,
		200,
	);
	const { h, at } = await pixels(bytes);
	// The bar spans x 68-209; grid lines are dashed, so look along the gap beside it
	const barX = 140;
	const lightRows: number[] = [];
	let barTop = -1;
	let barBottom = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 44; x < 62; x++) {
			const [r, g, b] = at(x, y);
			if (r > 40 && g > 40 && b > 40) {
				lightRows.push(y);
				break;
			}
		}
		if (isCyan(...at(barX, y))) {
			if (barTop < 0) barTop = y;
			barBottom = y;
		}
	}
	// Lines at 17.00 / 16.50 / 16.00 / 15.50 and the axis border; 17.50 sits on the clip edge
	const axis = lightRows[lightRows.length - 1]!;
	const line1700 = lightRows[lightRows.length - 5]!;
	assert.equal(
		barTop,
		line1700 + 1,
		`bar top ${barTop}, 17.00 line ${line1700}`,
	);
	assert.equal(barBottom, axis - 1, `bar bottom ${barBottom}, axis ${axis}`);
});
