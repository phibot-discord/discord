import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
	BG_MAX_EDGE,
	fitPaintImages,
	maxEdgeFor,
	TILE_MAX_EDGE,
} from "./paint-images.ts";

test("tile images larger than the paint budget are downscaled", async () => {
	const src = await sharp({
		create: {
			width: 1600,
			height: 900,
			channels: 3,
			background: { r: 255, g: 0, b: 0 },
		},
	})
		.png()
		.toBuffer();
	const [out] = await fitPaintImages([
		{ src: "file:///tmp/ill/song.png", data: new Uint8Array(src) },
	]);
	assert.ok(out);
	const meta = await sharp(out.data).metadata();
	assert.ok((meta.width ?? 0) <= TILE_MAX_EDGE);
	assert.ok((meta.height ?? 0) <= TILE_MAX_EDGE);
});

test("blurred backgrounds keep a larger max edge", async () => {
	assert.equal(maxEdgeFor("/tmp/phi-web-ill-blur/abc.png"), BG_MAX_EDGE);
	assert.equal(maxEdgeFor("file:///ill/song.png"), TILE_MAX_EDGE);
	const src = await sharp({
		create: {
			width: 1800,
			height: 1800,
			channels: 3,
			background: { r: 0, g: 0, b: 255 },
		},
	})
		.png()
		.toBuffer();
	const [out] = await fitPaintImages([
		{
			src: "file:///tmp/phi-web-ill-blur/abc.png",
			data: new Uint8Array(src),
		},
	]);
	assert.ok(out);
	const meta = await sharp(out.data).metadata();
	assert.equal(meta.width, 1800);
	assert.equal(meta.height, 1800);
});
