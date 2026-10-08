import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { ScoreAvgSong } from "./score-avg.ts";

// The real fetch path (memo + chartTagJsonFetchOnce) against a local stand-in for
// phib19; PHI_CHART_TAG_API is read at import, so score-avg is imported after it
test("a peer-average lookup answered with HTTP 200 {error} is a failure, and not retried on every render", async () => {
	let hits = 0;
	const server = http.createServer((req, res) => {
		hits++;
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "服务繁忙" }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	process.env.PHI_CHART_TAG_API = `http://127.0.0.1:${port}`;
	const { attachB19AccAvg } = await import("./score-avg.ts");
	try {
		const payload = () => ({
			phi: [],
			b19_list: [{ id: "A.0", rank: "IN", acc: 98 }] as ScoreAvgSong[],
			com_rks: 15,
		});
		const first = payload();
		assert.deepEqual(await attachB19AccAvg(first, { avgType: "all" }), {
			partial: true,
			missing: true,
		});
		assert.equal(first.b19_list[0]?.accAvg, undefined);
		assert.deepEqual(await attachB19AccAvg(payload(), { avgType: "all" }), {
			partial: true,
			missing: true,
		});
		assert.equal(hits, 1);
	} finally {
		server.close();
	}
});
