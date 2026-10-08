import type { KvBundle } from "./kv.ts";

let bundle: KvBundle | undefined;

/** `createHost` registers the KV connection here so shared modules (song-info) can reach it. */
export function attachDataHost(kv: KvBundle) {
	bundle = kv;
}

/** Same shape the WebUI's data host exposes; only `store` is used by shared code. */
export async function getDataHost(): Promise<KvBundle> {
	if (!bundle) throw new Error("KV is not connected yet");
	return bundle;
}
