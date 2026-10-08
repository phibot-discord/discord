import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import test from "node:test";
import { CF_RETRY_CAP_MS, cfFetch, retryDelayMs } from "./cf-fetch.ts";

async function withServer(
	handle: (n: number, res: ServerResponse) => void,
	fn: (url: string, hits: () => number) => Promise<void>,
) {
	let n = 0;
	const server = createServer((req, res) => {
		req.resume();
		n += 1;
		handle(n, res);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	try {
		await fn(`http://127.0.0.1:${port}/`, () => n);
	} finally {
		server.closeAllConnections();
		server.close();
	}
}

test("retryDelayMs honours Retry-After but never waits past the cap", () => {
	assert.equal(retryDelayMs("1", 0), 1_000);
	assert.equal(retryDelayMs("0", 3), 0);
	assert.equal(retryDelayMs("120", 0), CF_RETRY_CAP_MS);
	const now = Date.parse("2026-01-01T00:00:00Z");
	assert.equal(retryDelayMs("Thu, 01 Jan 2026 00:00:01 GMT", 0, now), 1_000);
	assert.equal(retryDelayMs(null, 0), 250);
	assert.equal(retryDelayMs("junk", 1), 500);
	assert.equal(retryDelayMs(undefined, 9), CF_RETRY_CAP_MS);
});

test("a 5xx is retried twice in total, by cfFetch alone", async () => {
	await withServer(
		(_n, res) => {
			res.writeHead(503, { "retry-after": "0" });
			res.end("busy");
		},
		async (url, hits) => {
			const res = await cfFetch(url);
			assert.equal(res.status, 503);
			assert.equal(
				hits(),
				3,
				"one try plus two retries, no interceptor on top",
			);
		},
	);
});

test("429 then success returns the success", async () => {
	await withServer(
		(n, res) => {
			if (n === 1) {
				res.writeHead(429, { "retry-after": "0" });
				res.end();
				return;
			}
			res.end("ok");
		},
		async (url, hits) => {
			const res = await cfFetch(url, { method: "PUT", body: "x" });
			assert.equal(res.status, 200);
			assert.equal(await res.text(), "ok");
			assert.equal(hits(), 2);
		},
	);
});

test("background writes fail fast on 429", async () => {
	await withServer(
		(_n, res) => {
			res.writeHead(429, { "retry-after": "0" });
			res.end();
		},
		async (url, hits) => {
			const res = await cfFetch(url, {
				method: "PUT",
				body: "x",
				background: true,
			});
			assert.equal(res.status, 429);
			assert.equal(hits(), 1);
		},
	);
});

test("stream mode hands back an unread body", async () => {
	await withServer(
		(_n, res) => {
			res.end("streamed");
		},
		async (url) => {
			const res = await cfFetch(url, { stream: true });
			assert.ok(res.body);
			assert.equal(await new Response(res.body).text(), "streamed");
		},
	);
});
