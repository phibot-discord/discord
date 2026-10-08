import type { KvStore } from "../../../src/kv.ts";
import { logger } from "../../../src/logger.ts";
import type { App } from "../../../src/sdk/index.ts";
import { ensureSongInfo } from "../../../src/song-info.ts";
import { initCredentials } from "./credentials.ts";
import { fCompute } from "./fcompute.ts";
import { getInfo } from "./get-info.ts";
import { PhigrosUser } from "./phigros.ts";
import { Save } from "./save.ts";
import { getQRcode, type TapLogin } from "./taptap.ts";

export type PhiRuntime = {
	getInfo: typeof getInfo;
	PhigrosUser: typeof PhigrosUser;
	Save: typeof Save;
	fCompute: typeof fCompute;
	store: ReturnType<typeof initCredentials>;
	getQRcode: {
		getRequest: (useGlobal?: boolean) => Promise<{
			deviceId?: string;
			data?: {
				device_code?: string;
				expires_in?: number;
				qrcode_url?: string;
				interval?: number;
			};
		}>;
		getQRcode: (url: string, useGlobal?: boolean) => Promise<Buffer>;
		checkQRCodeResult: (
			request: unknown,
			useGlobal?: boolean,
		) => Promise<{
			success?: boolean;
			data?: { error?: string; kid?: string; access_token?: string };
		} | null>;
		getSessionToken: (
			result: unknown,
			useGlobal?: boolean,
		) => Promise<string | undefined>;
		login: (result: unknown, useGlobal?: boolean) => Promise<TapLogin>;
	};
};

export async function bootPhiRuntime(
	app: App,
	opts: { loadInfo?: boolean } = {},
): Promise<PhiRuntime> {
	const kv = app.getService<KvStore>("kv");
	if (opts.loadInfo !== false) await ensureSongInfo();
	const store = initCredentials(kv);
	logger.ok("phi runtime (getInfo + Save + TapTap) attached to KV");
	return {
		getInfo,
		PhigrosUser,
		Save,
		fCompute,
		store,
		getQRcode: getQRcode as PhiRuntime["getQRcode"],
	};
}
