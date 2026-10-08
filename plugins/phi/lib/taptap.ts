import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { logger } from "../../../src/logger.ts";
import { TAPAPI_QR_POLL_TIMEOUT_MS, tapFetch } from "./tapapi.ts";

type PartialQR = {
	deviceId?: string;
	data?: {
		device_code?: string;
		expires_in?: number;
		qrcode_url?: string;
		interval?: number;
	};
	global?: boolean;
};

class CompleteQRCodeData {
	deviceID: string;
	deviceCode: string;
	expiresInSeconds?: number;
	url?: string;
	interval?: number;

	constructor(code: PartialQR) {
		this.deviceID = code.deviceId || "";
		this.deviceCode = code.data?.device_code || "";
		this.expiresInSeconds = code.data?.expires_in;
		this.url = code.data?.qrcode_url;
		this.interval = code.data?.interval;
	}
}

const TapSDKVersion = "2.1";

type TapLoginRegion = {
	clientId: string;
	appKey: string;
	webHost: string;
	apiHost: string;
	lcBase: string;
};

const CN_LOGIN: TapLoginRegion = {
	clientId: "rAK3FfdieFob2Nn8Am",
	appKey: "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0",
	webHost: "https://accounts.tapapis.cn",
	apiHost: "https://open.tapapis.cn",
	lcBase: "https://rak3ffdi.cloud.tds1.tapapis.cn/1.1",
};

const GB_LOGIN: TapLoginRegion = {
	clientId: "kviehleldgxsagpozb",
	appKey: "tG9CTm0LDD736k9HMM9lBZrbeBGRmUkjSfNLDNib",
	webHost: "https://accounts.tapapis.com",
	apiHost: "https://open.tapapis.com",
	lcBase: "https://kviehlel.cloud.ap-sg.tapapis.com/1.1",
};

export function isGlobalTapLogin(
	request?: PartialQR,
	useGlobal = false,
): boolean {
	const url = request?.data?.qrcode_url || "";
	if (/taptap\.io|tapapis\.com/i.test(url)) return true;
	if (/taptap\.cn|tapapis\.cn/i.test(url)) return false;
	if (typeof request?.global === "boolean") return request.global;
	return useGlobal;
}

function tapLogin(useGlobal: boolean): TapLoginRegion {
	return useGlobal ? GB_LOGIN : CN_LOGIN;
}

function authorization(
	requestUrl: string,
	method: string,
	keyId: string,
	macKey: string,
) {
	const url = new URL(requestUrl);
	const time = Math.floor(Date.now() / 1000)
		.toString()
		.padStart(10, "0");
	const randomStr = randomBytes(16).toString("base64");
	const host = url.hostname;
	const uri = url.pathname + url.search;
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	const sign = createHmac("sha1", macKey)
		.update(`${time}\n${randomStr}\n${method}\n${uri}\n${host}\n${port}\n\n`)
		.digest("base64");
	return `MAC id="${keyId}", ts="${time}", nonce="${randomStr}", mac="${sign}"`;
}

async function requestLoginQrCode(
	permissions = ["public_profile"],
	useGlobal = false,
) {
	const tap = tapLogin(useGlobal);
	const deviceId = randomUUID().replace(/-/g, "");
	const params = new URLSearchParams({
		client_id: tap.clientId,
		response_type: "device_code",
		scope: permissions.join(","),
		version: TapSDKVersion,
		platform: "unity",
		info: JSON.stringify({ device_id: deviceId }),
	});
	const endpoint = `${tap.webHost}/oauth2/v1/device/code`;
	const response = await tapFetch(endpoint, { method: "POST", body: params });
	const data = (await response.json()) as Record<string, unknown>;
	const nested =
		data.data && typeof data.data === "object"
			? (data.data as PartialQR["data"])
			: (data as PartialQR["data"]);
	return { deviceId, data: nested };
}

async function checkQRCodeResult(data: PartialQR, useGlobal = false) {
	const tap = tapLogin(isGlobalTapLogin(data, useGlobal));
	const qr = new CompleteQRCodeData(data);
	const params = new URLSearchParams({
		grant_type: "device_token",
		client_id: tap.clientId,
		secret_type: "hmac-sha-1",
		code: qr.deviceCode,
		version: "1.0",
		platform: "unity",
		info: JSON.stringify({ device_id: qr.deviceID }),
	});
	const endpoint = `${tap.webHost}/oauth2/v1/token`;
	try {
		const response = await tapFetch(
			endpoint,
			{ method: "POST", body: params },
			TAPAPI_QR_POLL_TIMEOUT_MS,
		);
		const data = (await response.json()) as Record<string, unknown>;
		if (data?.kid && data?.access_token && !data.data)
			return {
				success: true,
				data: data as { kid: string; access_token: string },
			};
		return data as {
			success?: boolean;
			data?: { error?: string; kid?: string; access_token?: string };
		};
	} catch (err) {
		logger.warn(
			`qr poll fail ${err instanceof Error ? `${err.name} ${err.message}` : err}`,
		);
		return null;
	}
}

export function taptapProfile(
	raw: unknown,
): Record<string, unknown> | undefined {
	let cur: unknown = raw;
	for (let i = 0; i < 3; i++) {
		if (!cur || typeof cur !== "object") return;
		const row = cur as Record<string, unknown>;
		if (typeof row.openid === "string" && row.openid) return row;
		cur = row.data;
	}
}

async function getProfile(
	token: { scope?: string; kid: string; mac_key: string },
	useGlobal = false,
) {
	if (!token.scope?.includes("public_profile"))
		throw new Error("Public profile permission is required.");
	const tap = tapLogin(useGlobal);
	const url = `${tap.apiHost}/account/profile/v1?client_id=${tap.clientId}`;
	const response = await tapFetch(url, {
		method: "GET",
		headers: {
			Authorization: authorization(url, "GET", token.kid, token.mac_key),
		},
	});
	const body: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		throw new Error(`TapTap profile ${response.status}`);
	}
	const profile = taptapProfile(body);
	if (!profile) throw new Error("TapTap profile missing openid");
	return profile;
}

async function loginAndGetToken(
	data: Record<string, unknown>,
	withGlobal = false,
) {
	if (typeof data.openid !== "string" || !data.openid) {
		throw new Error("TapTap profile missing openid");
	}
	const tap = tapLogin(withGlobal);
	const url = `${tap.lcBase}/users`;
	const timestamp = Math.floor(Date.now() / 1000);
	const sign = `${createHash("md5").update(`${timestamp}${tap.appKey}`).digest("hex")},${timestamp}`;
	const response = await tapFetch(url, {
		method: "POST",
		headers: {
			"X-LC-Id": tap.clientId,
			"Content-Type": "application/json",
			"X-LC-Sign": sign,
		},
		body: JSON.stringify({ authData: { taptap: data } }),
	});
	const body = (await response.json()) as {
		sessionToken?: string;
		objectId?: string;
	};
	if (!response.ok) {
		throw new Error(`Phigros cloud ${response.status}`);
	}
	return body;
}

/** A finished TapTap QR login: the Phigros cloud account and the TapTap profile it came from */
export type TapLogin = {
	sessionToken?: string;
	/** Phigros cloud (LeanCloud) user id: the same account on every login */
	objectId?: string;
	name?: string;
	avatar?: string;
};

type QrTokenResult = {
	data?: {
		kid?: string;
		access_token?: string;
		mac_key?: string;
		scope?: string;
	};
};

function profileText(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

export const getQRcode = {
	getRequest(useGlobal = false) {
		return requestLoginQrCode(undefined, useGlobal);
	},
	getQRcode(url: string, _useGlobal = false) {
		return QRCode.toBuffer(url, {
			scale: 10,
			margin: 2,
			color: { dark: "#000000ff", light: "#ffffffff" },
		});
	},
	checkQRCodeResult(request: PartialQR, useGlobal = false) {
		return checkQRCodeResult(request, useGlobal);
	},
	async login(result: QrTokenResult, useGlobal = false): Promise<TapLogin> {
		const token = result.data as {
			kid: string;
			mac_key: string;
			scope?: string;
			access_token?: string;
		};
		const profile = await getProfile(token, useGlobal);
		const cloud = await loginAndGetToken({ ...token, ...profile }, useGlobal);
		return {
			sessionToken: cloud.sessionToken,
			objectId: profileText(cloud.objectId),
			name: profileText(profile.name),
			avatar: profileText(profile.avatar),
		};
	},
	async getSessionToken(result: QrTokenResult, useGlobal = false) {
		return (await getQRcode.login(result, useGlobal)).sessionToken;
	},
};
