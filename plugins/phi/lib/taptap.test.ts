import assert from "node:assert/strict";
import test from "node:test";
import { setTapHttpForTest } from "./tapapi.ts";
import { getQRcode, taptapProfile } from "./taptap.ts";

const GB_CLIENT = "kviehleldgxsagpozb";
const GB_LC = "https://kviehlel.cloud.ap-sg.tapapis.com/1.1/users";

type Capture = {
	url: string;
	clientId?: string;
	lcId?: string;
	urlencoded?: boolean;
	openid?: string;
};

async function withFetch<T>(
	fn: (calls: Capture[]) => Promise<T>,
	respond: (url: string) => unknown = () => ({
		data: { error: "authorization_pending" },
	}),
): Promise<T> {
	const calls: Capture[] = [];
	setTapHttpForTest(async (url, init) => {
		const href = String(url);
		const cap: Capture = { url: href };
		const body = init?.body;
		if (body instanceof URLSearchParams) {
			cap.clientId = body.get("client_id") || undefined;
			cap.urlencoded = true;
		}
		const headers = new Headers(
			init?.headers as ConstructorParameters<typeof Headers>[0],
		);
		cap.lcId = headers.get("X-LC-Id") || undefined;
		if (typeof body === "string") {
			try {
				cap.openid = (
					JSON.parse(body) as {
						authData?: { taptap?: { openid?: string } };
					}
				).authData?.taptap?.openid;
			} catch {
				/* not json */
			}
		}
		calls.push(cap);
		return new Response(JSON.stringify(respond(href)), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
	try {
		return await fn(calls);
	} finally {
		setTapHttpForTest();
	}
}

test("global QR token poll uses tapapis.com even if useGlobal is omitted", async () => {
	await withFetch(async (calls) => {
		await getQRcode.checkQRCodeResult({
			deviceId: "dev",
			data: {
				device_code: "issued-on-com",
				qrcode_url: "https://accounts.taptap.io/device?qrcode=1&user_code=abcd",
			},
			global: false,
		});
		assert.equal(calls.length, 1);
		assert.match(calls[0]!.url, /accounts\.tapapis\.com\/oauth2\/v1\/token/);
		assert.doesNotMatch(calls[0]!.url, /tapapis\.cn/);
		assert.equal(calls[0]!.clientId, GB_CLIENT);
		assert.equal(calls[0]!.urlencoded, true);
	});
});

test("global device code request uses international host and GB client id", async () => {
	await withFetch(
		async (calls) => {
			await getQRcode.getRequest(true);
			assert.equal(calls.length, 1);
			assert.match(
				calls[0]!.url,
				/accounts\.tapapis\.com\/oauth2\/v1\/device\/code/,
			);
			assert.equal(calls[0]!.clientId, GB_CLIENT);
			assert.equal(calls[0]!.urlencoded, true);
		},
		() => ({
			data: {
				device_code: "x",
				expires_in: 300,
				qrcode_url: "https://accounts.taptap.io/device?qrcode=1&user_code=x",
				interval: 1,
			},
		}),
	);
});

test("CN QR token poll stays on tapapis.cn", async () => {
	await withFetch(async (calls) => {
		await getQRcode.checkQRCodeResult(
			{
				deviceId: "dev",
				data: {
					device_code: "issued-on-cn",
					qrcode_url:
						"https://accounts.taptap.cn/device?qrcode=1&user_code=abcd",
				},
			},
			true,
		);
		assert.equal(calls.length, 1);
		assert.match(calls[0]!.url, /accounts\.tapapis\.cn\/oauth2\/v1\/token/);
		assert.equal(calls[0]!.clientId, "rAK3FfdieFob2Nn8Am");
		assert.equal(calls[0]!.urlencoded, true);
	});
});

test("global session login uses GB LeanCloud id and host", async () => {
	await withFetch(
		async (calls) => {
			const token = await getQRcode.getSessionToken(
				{
					data: {
						kid: "kid",
						access_token: "access",
						mac_key: "mac",
						scope: "public_profile",
					},
				},
				true,
			);
			assert.equal(token, "abcdefghijklmnopqrstuvwxy");
			const profile = calls.find((c) => c.url.includes("/account/profile/"));
			const login = calls.find((c) => c.url.includes("/users"));
			assert.ok(profile);
			assert.match(profile!.url, /open\.tapapis\.com/);
			assert.match(profile!.url, new RegExp(`client_id=${GB_CLIENT}`));
			assert.ok(login);
			assert.equal(login!.url, GB_LC);
			assert.equal(login!.lcId, GB_CLIENT);
			assert.equal(login!.openid, "o");
		},
		(url) => {
			if (url.includes("/account/profile/")) {
				return { data: { openid: "o", name: "n" } };
			}
			return { sessionToken: "abcdefghijklmnopqrstuvwxy" };
		},
	);
});

test("taptapProfile unwraps nested data", () => {
	assert.equal(taptapProfile({ openid: "x" })?.openid, "x");
	assert.equal(taptapProfile({ data: { openid: "y" } })?.openid, "y");
	assert.equal(taptapProfile({ data: { data: { openid: "z" } } })?.openid, "z");
	assert.equal(taptapProfile({ error: "Unauthorized" }), undefined);
});

test("session login does not POST /users without openid", async () => {
	await withFetch(
		async (calls) => {
			await assert.rejects(
				() =>
					getQRcode.getSessionToken(
						{
							data: {
								kid: "kid",
								access_token: "access",
								mac_key: "mac",
								scope: "public_profile",
							},
						},
						false,
					),
				/openid|profile/i,
			);
			assert.equal(calls.filter((c) => c.url.includes("/users")).length, 0);
		},
		() => ({}),
	);
});
