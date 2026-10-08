import assert from "node:assert/strict";
import test from "node:test";
import { r2BucketName } from "./r2.ts";

test("R2 bucket falls back when vercel env pull leaves a placeholder", () => {
	assert.equal(r2BucketName("phi-web-assets"), "phi-web-assets");
	assert.equal(r2BucketName(""), "phi-web-assets");
	assert.equal(r2BucketName("  "), "phi-web-assets");
	assert.equal(r2BucketName("[SENSITIVE]"), "phi-web-assets");
	assert.equal(r2BucketName(undefined), "phi-web-assets");
});

test("CLOUDFLARE_R2_BUCKET=off turns R2 off instead of using the default bucket", () => {
	assert.equal(r2BucketName("off"), "");
	assert.equal(r2BucketName(""), "phi-web-assets");
});

test("streamR2Object pipes the public object and remembers a 404", async () => {
	const { createServer } = await import("node:http");
	const { streamR2Object } = await import("./r2.ts");
	let hits = 0;
	const server = createServer((req, res) => {
		hits += 1;
		if (req.url === "/phira/AT/a-AT.pez") {
			res.setHeader("content-length", "5");
			res.end("hello");
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	const env = { ...process.env };
	process.env.CLOUDFLARE_R2_PUBLIC_BASE = `http://127.0.0.1:${port}`;
	process.env.CLOUDFLARE_R2_BUCKET = "off";
	try {
		const got = await streamR2Object("phira/AT/a-AT.pez");
		assert.ok(got);
		assert.equal(got.length, 5);
		assert.equal(await new Response(got.body).text(), "hello");
		assert.equal(await streamR2Object("phira/AT/none.pez"), undefined);
		assert.equal(await streamR2Object("phira/AT/none.pez"), undefined);
		assert.equal(
			hits,
			2,
			"the second miss is answered from the negative cache",
		);
	} finally {
		process.env = env;
		server.closeAllConnections();
		server.close();
	}
});

test("streamR2Object asks for unencoded bytes and drops the length of an encoded body", async () => {
	const { createServer } = await import("node:http");
	const { gzipSync } = await import("node:zlib");
	const { streamR2Object } = await import("./r2.ts");
	const asked: Array<string | undefined> = [];
	const packed = gzipSync(Buffer.from("hello hello hello"));
	const server = createServer((req, res) => {
		asked.push(req.headers["accept-encoding"]);
		if (req.url === "/phira/AT/plain-AT.pez") {
			res.setHeader("content-length", "5");
			res.end("hello");
			return;
		}
		// A server that compresses anyway: the declared length is the gzip size
		res.setHeader("content-encoding", "gzip");
		res.setHeader("content-length", String(packed.byteLength));
		res.end(packed);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	const env = { ...process.env };
	process.env.CLOUDFLARE_R2_PUBLIC_BASE = `http://127.0.0.1:${port}`;
	process.env.CLOUDFLARE_R2_BUCKET = "off";
	try {
		const plain = await streamR2Object("phira/AT/plain-AT.pez");
		assert.equal(plain?.length, 5);
		await plain?.body.cancel();
		const encoded = await streamR2Object("phira/AT/gz-AT.pez");
		assert.ok(encoded);
		assert.equal(encoded.length, undefined, "no Content-Length to forward");
		assert.equal(await new Response(encoded.body).text(), "hello hello hello");
		assert.deepEqual(asked, ["identity", "identity"]);
	} finally {
		process.env = env;
		server.closeAllConnections();
		server.close();
	}
});
