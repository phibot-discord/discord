import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Node } from "@takumi-rs/core";
import { fromHtml } from "takumi-js/helpers/html";
import {
	clearRemoteImageCache,
	fetchImage,
	looksLikeImage,
	markRemoteImagesFailed,
	mayHaveEmoji,
	remoteImageBytes,
	remoteImageCacheSize,
	remoteImageUrls,
	withRemoteImages,
} from "./remote-images.ts";

const GRIN =
	"https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.051/svg/emoji_u1f600.svg";
const SVG = new TextEncoder().encode(
	`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#f00"/></svg>`,
);

function tree(html: string): Node {
	return fromHtml(`<html><body>${html}</body></html>`).node;
}

test("a remote image is fetched once and shared", async () => {
	clearRemoteImageCache();
	let calls = 0;
	const fetchOne = async () => {
		calls += 1;
		return SVG;
	};
	const [a, b] = await Promise.all([
		remoteImageBytes("https://x.test/a.svg", fetchOne),
		remoteImageBytes("https://x.test/a.svg", fetchOne),
	]);
	assert.equal(calls, 1);
	assert.equal(a, SVG);
	assert.equal(b, SVG);
	await remoteImageBytes("https://x.test/a.svg", fetchOne);
	assert.equal(calls, 1);
});

test("a failed fetch is not retried on every render, only after a while", async () => {
	clearRemoteImageCache();
	let calls = 0;
	const fail = async () => {
		calls += 1;
		throw new Error("offline");
	};
	const t0 = 1_000_000;
	assert.equal(
		await remoteImageBytes("https://x.test/b.svg", fail, t0),
		undefined,
	);
	assert.equal(
		await remoteImageBytes("https://x.test/b.svg", fail, t0 + 60_000),
		undefined,
	);
	assert.equal(calls, 1);
	await remoteImageBytes("https://x.test/b.svg", fail, t0 + 11 * 60_000);
	assert.equal(calls, 2);
});

test("emoji become fetched Noto images", async () => {
	clearRemoteImageCache();
	const asked: string[] = [];
	const out = await withRemoteImages(tree(`<p>hi 😀 there</p>`), {
		fetchOne: async (url) => {
			asked.push(url);
			return SVG;
		},
	});
	assert.deepEqual(asked, [GRIN]);
	assert.deepEqual(remoteImageUrls(out.node), [GRIN]);
	assert.equal(out.images.length, 1);
	assert.equal(out.images[0]?.src, GRIN);
});

test("an emoji that cannot be fetched is dropped instead of failing the render", async () => {
	clearRemoteImageCache();
	const out = await withRemoteImages(tree(`<p>hi 😀 there</p>`), {
		fetchOne: async () => undefined,
	});
	assert.deepEqual(out.images, []);
	assert.deepEqual(remoteImageUrls(out.node), []);
	assert.match(JSON.stringify(out.node), /hi /);
	assert.match(JSON.stringify(out.node), / there/);
});

test("text without emoji is left alone and nothing is fetched", async () => {
	clearRemoteImageCache();
	const html = `<p>Tip: 曲名 ©2026</p>`;
	assert.equal(mayHaveEmoji(`<p>plain text</p>`), false);
	assert.equal(mayHaveEmoji(`<p>hi 😀</p>`), true);
	const node = tree(html);
	const out = await withRemoteImages(node, {
		emoji: mayHaveEmoji(html),
		fetchOne: async () => {
			throw new Error("must not fetch");
		},
	});
	assert.deepEqual(out.images, []);
	assert.deepEqual(remoteImageUrls(out.node), []);
});

const text = (s: string) => new TextEncoder().encode(s);

test("only image bytes count as an image", () => {
	assert.equal(looksLikeImage(SVG), true);
	assert.equal(
		looksLikeImage(
			text(`\uFEFF<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>\n`),
		),
		true,
	);
	assert.equal(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), true);
	assert.equal(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
	assert.equal(looksLikeImage(text("GIF89a")), true);
	assert.equal(looksLikeImage(text("RIFF\0\0\0\0WEBPVP8 ")), true);
	assert.equal(
		looksLikeImage(
			text("<!DOCTYPE html><html><body>Bad gateway</body></html>"),
		),
		false,
	);
	assert.equal(looksLikeImage(text(`<svg width="16"><rect width="16"`)), false);
	assert.equal(looksLikeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), false);
	assert.equal(looksLikeImage(new Uint8Array()), false);
});

test("bytes that are not an image are a failed fetch, not a cached image", async () => {
	clearRemoteImageCache();
	let calls = 0;
	const errorPage = async () => {
		calls += 1;
		return text("<html><body>Service Unavailable</body></html>");
	};
	const t0 = 1_000_000;
	assert.equal(
		await remoteImageBytes("https://x.test/c.svg", errorPage, t0),
		undefined,
	);
	assert.equal(
		await remoteImageBytes("https://x.test/c.svg", errorPage, t0 + 60_000),
		undefined,
	);
	assert.equal(calls, 1);
	assert.equal(remoteImageCacheSize().bytes, 0);
});

test("a URL marked failed is skipped until the retry window passes", async () => {
	clearRemoteImageCache();
	let calls = 0;
	const ok = async () => {
		calls += 1;
		return SVG;
	};
	const t0 = 1_000_000;
	assert.equal(await remoteImageBytes("https://x.test/d.svg", ok, t0), SVG);
	markRemoteImagesFailed(["https://x.test/d.svg"], t0);
	assert.equal(
		await remoteImageBytes("https://x.test/d.svg", ok, t0 + 60_000),
		undefined,
	);
	assert.equal(calls, 1);
	assert.equal(remoteImageCacheSize().bytes, 0);
	assert.equal(
		await remoteImageBytes("https://x.test/d.svg", ok, t0 + 11 * 60_000),
		SVG,
	);
	assert.equal(calls, 2);
});

test("the cache keeps a byte budget, dropping the oldest images", async () => {
	clearRemoteImageCache();
	const big = new Uint8Array(100 * 1024);
	big.set([0x89, 0x50, 0x4e, 0x47]);
	for (let i = 0; i < 120; i++)
		await remoteImageBytes(`https://x.test/big-${i}.png`, async () => big);
	const { entries, bytes } = remoteImageCacheSize();
	assert.ok(bytes <= 8 * 1024 * 1024, `${bytes}`);
	assert.ok(entries < 120);
	assert.equal(bytes, entries * big.byteLength);
	let calls = 0;
	await remoteImageBytes("https://x.test/big-119.png", async () => {
		calls += 1;
		return big;
	});
	assert.equal(calls, 0);
	clearRemoteImageCache();
});

test("fetchImage accepts only image responses within the size cap", async (t) => {
	const server = createServer((req, res) => {
		if (req.url === "/ok.svg") {
			res.writeHead(200, { "content-type": "image/svg+xml" });
			res.end(SVG);
		} else if (req.url === "/page.svg") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<html><body>Service Unavailable</body></html>");
		} else if (req.url === "/declared-big.svg") {
			res.writeHead(200, {
				"content-type": "image/svg+xml",
				"content-length": String(1024 * 1024),
			});
			res.end();
		} else if (req.url === "/streamed-big.svg") {
			res.writeHead(200, { "content-type": "image/svg+xml" });
			const chunk = Buffer.alloc(64 * 1024, 0x20);
			for (let i = 0; i < 4; i++) res.write(chunk);
			res.end("<svg></svg>");
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	assert.deepEqual(await fetchImage(`${base}/ok.svg`), SVG);
	assert.equal(await fetchImage(`${base}/page.svg`), undefined);
	assert.equal(await fetchImage(`${base}/declared-big.svg`), undefined);
	assert.equal(await fetchImage(`${base}/streamed-big.svg`), undefined);
	assert.equal(await fetchImage(`${base}/missing.svg`), undefined);
});
