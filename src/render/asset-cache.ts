import { readFile, stat } from "../vfs.ts";

/** Raw image bytes by path, saving a /tmp read per image per render */
const MAX_BYTES = 64 * 1024 * 1024;

const cache = new Map<string, { stamp: string; data: Buffer }>();
let totalBytes = 0;

export function readAssetCached(path: string): Buffer {
	const s = stat(path);
	const stamp = `${s.mtimeMs}|${s.size}`;
	const hit = cache.get(path);
	if (hit && hit.stamp === stamp) {
		cache.delete(path);
		cache.set(path, hit);
		return hit.data;
	}
	const data = readFile(path);
	if (hit) totalBytes -= hit.data.byteLength;
	cache.set(path, { stamp, data });
	totalBytes += data.byteLength;
	while (totalBytes > MAX_BYTES && cache.size > 1) {
		const oldest = cache.keys().next().value as string;
		const evicted = cache.get(oldest);
		cache.delete(oldest);
		if (evicted) totalBytes -= evicted.data.byteLength;
	}
	return data;
}
