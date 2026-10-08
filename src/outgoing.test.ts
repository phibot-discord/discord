import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { cfAgent, isNoResponseError } from "./cf-fetch.ts";
import {
	outgoingAgent,
	outgoingAgentDefaults,
	outgoingFetch,
	REQUEST_TIMEOUT_MS,
	RETRY_AFTER_CAP_MS,
	socketTimeouts,
} from "./outgoing.ts";

test("outgoing sockets wait 30s to connect, not undici's 10s default", () => {
	assert.equal(REQUEST_TIMEOUT_MS, 30_000);
	const t = socketTimeouts();
	assert.equal(t.connectTimeout, 30_000);
	assert.equal(t.connect.timeout, 30_000);
});

test("Cloudflare gives up on a silent socket early and retries once instead", () => {
	assert.equal(cfAgent.connectTimeout, 12_000);
	assert.equal(cfAgent.connect.timeout, 12_000);
	assert.equal(cfAgent.headersTimeout, 12_000);
	assert.equal(isNoResponseError(new DOMException("t", "TimeoutError")), true);
	assert.equal(
		isNoResponseError(
			Object.assign(new Error("fetch failed"), {
				cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
			}),
		),
		true,
	);
	assert.equal(isNoResponseError(new Error("KV GET x failed: 500")), false);
});

test("outgoing requests stay on HTTP/1.1 so TapTap does not NGHTTP2_PROTOCOL_ERROR", () => {
	assert.equal(outgoingAgentDefaults.allowH2, false);
});

test("urlencoded bodies keep oauth fields; Node FormData does not", async () => {
	const seen: { ct?: string; body: string }[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			seen.push({
				ct: req.headers["content-type"],
				body: Buffer.concat(chunks).toString(),
			});
			res.end("ok");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	const url = `http://127.0.0.1:${port}/`;
	try {
		const form = new FormData();
		form.append("client_id", "rAK3FfdieFob2Nn8Am");
		await outgoingFetch(url, { method: "POST", body: form });
		await outgoingFetch(url, {
			method: "POST",
			body: new URLSearchParams({ client_id: "rAK3FfdieFob2Nn8Am" }),
		});
		assert.equal(seen[0]!.body, "[object FormData]");
		assert.match(seen[1]!.body, /client_id=rAK3FfdieFob2Nn8Am/);
		assert.match(seen[1]!.ct || "", /application\/x-www-form-urlencoded/);
	} finally {
		server.close();
	}
});

test("the retry interceptor waits at most the cap for Retry-After", async () => {
	let n = 0;
	const server = createServer((_req, res) => {
		n += 1;
		if (n === 1) {
			res.writeHead(429, { "retry-after": "120" });
			res.end();
			return;
		}
		res.end("ok");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	try {
		const t0 = performance.now();
		const res = await outgoingFetch(`http://127.0.0.1:${port}/`, {
			dispatcher: outgoingAgent(),
		});
		const waited = performance.now() - t0;
		assert.equal(res.status, 200);
		assert.equal(n, 2);
		assert.ok(
			waited >= RETRY_AFTER_CAP_MS - 50 && waited < RETRY_AFTER_CAP_MS + 1_500,
			`waited ${Math.round(waited)}ms`,
		);
	} finally {
		server.closeAllConnections();
		server.close();
	}
});
