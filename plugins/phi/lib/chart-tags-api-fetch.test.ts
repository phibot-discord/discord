import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

// A local stand-in for phib19: the API base is read when const.ts loads
const bodies: Array<"cut" | "ok"> = [];
let hits = 0;
const server = createServer((req, res) => {
	req.resume();
	req.on("end", () => {
		const mode = bodies[hits++] ?? "ok";
		const json = JSON.stringify({ data: { ok: true } });
		if (mode === "cut") {
			// Headers and half the body, then the socket dies (Worker abort mid-stream)
			res.writeHead(200, {
				"content-type": "application/json",
				"content-length": String(json.length),
			});
			res.write(json.slice(0, 5));
			setTimeout(() => res.socket?.destroy(), 10);
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(json);
	});
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.PHI_CHART_TAG_API = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { chartTagJsonFetch, chartTagJsonFetchOnce } = await import(
	"./chart-tags-api.ts"
);

test.after(() => server.close());

test("a body cut off mid-stream is retried, not leaked past the retry loop", async () => {
	hits = 0;
	bodies.splice(0, bodies.length, "cut", "ok");
	const got = await chartTagJsonFetch("/chartsTag/get/b30Analysis", {
		method: "POST",
		body: "{}",
	});
	assert.deepEqual(got, { data: { ok: true } });
	assert.equal(hits, 2);
});

test("the one-shot fetch makes a single attempt", async () => {
	hits = 0;
	bodies.splice(0, bodies.length, "cut", "ok");
	await assert.rejects(
		chartTagJsonFetchOnce("/chartsTag/get/b30Analysis", {
			method: "POST",
			body: "{}",
		}),
	);
	assert.equal(hits, 1);
});
