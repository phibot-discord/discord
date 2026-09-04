import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
	buildTagAnalysis,
	buildTagRadar,
	type ChartTagTreeNode,
} from "./b30-analysis.ts"
import { tagRadarHtml, tagRadarPlotPng, tagRadarPlotSvg } from "./charts.ts"

const rec = (id: string, rank: string, rks: number) => ({
	id,
	rank,
	rks,
	kind: "best" as const,
	slot: "B1",
});

const tree: ChartTagTreeNode[] = [
	{
		name: "读谱",
		children: [{ name: "面海" }, { name: "脑裂" }],
	},
	{
		name: "硬抗",
		children: [{ name: "快交互" }],
	},
];

test("radar uses a top-starting pentagon matching the B30 panel viewBox", () => {
	const radar = buildTagRadar([
		{ name: "读谱", rks: 15.72, votes: 10, hasVotes: true },
		{ name: "硬抗", rks: 15.94, votes: 10, hasVotes: true },
		{ name: "拆谱", rks: 15.38, votes: 10, hasVotes: true },
		{ name: "定位", rks: 15.51, votes: 10, hasVotes: true },
		{ name: "多指", rks: 15.12, votes: 10, hasVotes: true },
	]);
	assert.equal(radar.axes.length, 5);
	assert.equal(radar.grids.length, 4);
	assert.equal(radar.categories.length, 5);
	assert.ok(Math.abs(radar.axes[0]!.x - 100) < 0.05);
	assert.ok(Math.abs(radar.axes[0]!.y - 37) < 0.05);
	assert.ok(Math.abs(radar.axes[1]!.x - 152.3) < 0.2);
	assert.ok(Math.abs(radar.axes[1]!.y - 75) < 0.2);
	const high = radar.categories[1]!;
	const low = radar.categories[4]!;
	const dist = (c: { pointX: number; pointY: number }) =>
		Math.hypot(c.pointX - 100, c.pointY - 92);
	assert.ok(dist(high) > dist(low));
	assert.equal(high.displayRks, "15.94");
});

test("radar uses a fixed 0-17 rks radius instead of min-max stretching", () => {
	const radar = buildTagRadar([
		{ name: "读谱", rks: 16.27, votes: 10, hasVotes: true },
		{ name: "硬抗", rks: 16.34, votes: 10, hasVotes: true },
		{ name: "拆谱", rks: 16.28, votes: 10, hasVotes: true },
		{ name: "定位", rks: 16.33, votes: 10, hasVotes: true },
		{ name: "多指", rks: 6.34, votes: 10, hasVotes: true },
	]);
	const dist = (c: { pointX: number; pointY: number }) =>
		Math.hypot(c.pointX - 100, c.pointY - 92);
	const high = radar.categories[1]!;
	const near = radar.categories[0]!;
	const low = radar.categories[4]!;
	assert.ok(Math.abs(dist(high) / 55 - 16.34 / 17) < 0.03);
	assert.ok(Math.abs(dist(low) / 55 - 6.34 / 17) < 0.03);
	assert.ok(Math.abs(dist(high) - dist(near)) < 2);
	assert.ok(dist(low) > 18 && dist(low) < 28);
});

test("weights B30 rks by community tag votes and splits strong vs weak", () => {
	const analysis = buildTagAnalysis(
		[
			rec("song-a", "IN", 16),
			rec("song-b", "IN", 14),
			rec("song-c", "AT", 15),
			rec("song-d", "HD", 15.4),
		],
		tree,
		{
			"song-a": { IN: { 面海: 10, 快交互: 5 } },
			"song-b": { IN: { 面海: 10, 脑裂: 8 } },
			"song-c": { AT: { 快交互: 20 } },
			"song-d": { HD: { 快交互: 4, 脑裂: 6 } },
		},
	);
	assert.equal(analysis.insufficient, false);
	assert.ok(analysis.totalVotes > 0);
	const ranked = [...analysis.strong, ...analysis.weak];
	const mianhai = ranked.find((tag) => tag.name === "面海");
	assert.ok(mianhai);
	assert.ok(Math.abs(mianhai.rks - 15) < 1e-9);
	assert.equal(analysis.strong[0]!.name, "快交互");
	assert.equal(analysis.weak[0]!.name, "脑裂");
	const reading = analysis.radar.categories.find((c) => c.name === "读谱");
	assert.ok(reading?.hasVotes);
	assert.ok(reading!.rks < 15.5);
});

test("radar plot is a white PNG, not a black Takumi SVG/clip-path fill", async () => {
	const radar = buildTagRadar([
		{ name: "读谱", rks: 16.28, votes: 10, hasVotes: true },
		{ name: "硬抗", rks: 16.34, votes: 10, hasVotes: true },
		{ name: "拆谱", rks: 15.4, votes: 10, hasVotes: true },
		{ name: "定位", rks: 15.5, votes: 10, hasVotes: true },
		{ name: "多指", rks: 15.1, votes: 10, hasVotes: true },
	]);
	const svg = tagRadarPlotSvg(radar);
	assert.match(svg, /fill="none"/);
	assert.match(svg, /fill="#ffffff"/);
	assert.match(svg, /fill-opacity="0\.92"/);
	assert.doesNotMatch(svg, /<text\b/);

	const plotPng = await tagRadarPlotPng(radar);
	const plotMeta = await sharp(plotPng).metadata();
	assert.equal(plotMeta.width, 400);
	assert.equal(plotMeta.height, 368);

	const png = await sharp(Buffer.from(svg)).png().toBuffer();
	const { data } = await sharp(png).raw().ensureAlpha().toBuffer({
		resolveWithObject: true,
	});
	let white = 0;
	let black = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]!;
		const g = data[i + 1]!;
		const b = data[i + 2]!;
		const a = data[i + 3]!;
		if (a < 8) continue;
		if (r > 200 && g > 200 && b > 200 && a > 80) white++;
		if (r < 20 && g < 20 && b < 20 && a > 200) black++;
	}
	assert.ok(white > 500, `expected white fill, got ${white} white pixels`);
	assert.equal(black, 0);

	const html = await tagRadarHtml(radar);
	assert.match(html, /class="tag-radar-plot"/);
	assert.match(html, /src="file:\/\//);
	assert.match(html, /读谱/);
	assert.match(html, /16\.34/);
	assert.doesNotMatch(html, /<svg\b/i);
	assert.doesNotMatch(html, /clip-path/);
	assert.doesNotMatch(html, /data:image\/png;base64,/);
});

test("marks analysis insufficient when B30 charts have no tag votes", () => {
	const analysis = buildTagAnalysis([rec("song-a", "IN", 16)], tree, {
		"song-a": { IN: { 面海: 0, 快交互: 0 } },
	});
	assert.equal(analysis.insufficient, true);
	assert.equal(analysis.totalVotes, 0);
	assert.equal(analysis.strong.length, 0);
	assert.equal(analysis.weak.length, 0);
});
