export const ALL_LEVEL = ["EZ", "HD", "IN", "AT", "LEGACY"] as const;
export const LEVEL = ["EZ", "HD", "IN", "AT"] as const;
export type LevelKind = (typeof LEVEL)[number];

export const LEVEL_NUM: Record<string, number> = {
	EZ: 0,
	HD: 1,
	IN: 2,
	AT: 3,
	LEGACY: 4,
};

export const PHI_KV = "phi";

export function kvKey(...parts: Array<string | number>) {
	return `${PHI_KV}:${parts.map(String).join(":")}`;
}

export const PHI_CHART_TAG_API = (
	process.env.PHI_CHART_TAG_API || "https://phi-ill-sync.ymyk.workers.dev"
).replace(/\/+$/, "");

export const PHI_PROXY_KEY = process.env.PHI_PROXY_KEY?.trim() || "";
export const PROXY_KEY_HEADER = "x-phi-proxy-key";

export function isProxyHost(url: string | URL): boolean {
	try {
		const host = (typeof url === "string" ? new URL(url) : url).hostname;
		return !/(^|\.)(phib19\.top|tapapis\.cn|tapfiles\.cn|tapapis\.com)$/i.test(
			host,
		);
	} catch {
		return false;
	}
}
