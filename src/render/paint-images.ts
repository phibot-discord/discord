import sharp from "sharp";

/** Song tiles are ~95px CSS (~190px at 2×). 640px is still oversampled */
export const TILE_MAX_EDGE = 640;
/** Blurred backgrounds already sit around 1800px and cover the full card */
export const BG_MAX_EDGE = 2048;
const BG_SRC = /illBlur|phi-web-ill-blur|phi-ill-blur|Star[12]\.png/i;

export type PaintImage = {
	src: string;
	data: Uint8Array;
	cache?: "auto" | "none";
};

export function maxEdgeFor(src: string) {
	return BG_SRC.test(src) ? BG_MAX_EDGE : TILE_MAX_EDGE;
}

/**
 * Jackets are shared by every card, so the decode + downscale result is kept
 * per source. Keyed by src + byte length (disk assets are immutable per stamp)
 */
const fitted = new Map<string, Uint8Array>();
const FITTED_MAX_BYTES = 64 * 1024 * 1024;
let fittedBytes = 0;

/** Inline `data:` images are unique per card (radar plot); only file-backed sources are worth keeping */
function fitKey(image: PaintImage): string | undefined {
	if (/^data:/i.test(image.src)) return;
	return `${image.src}|${image.data.byteLength}`;
}

function rememberFitted(key: string, data: Uint8Array) {
	const prev = fitted.get(key);
	if (prev) fittedBytes -= prev.byteLength;
	fitted.delete(key);
	fitted.set(key, data);
	fittedBytes += data.byteLength;
	while (fittedBytes > FITTED_MAX_BYTES && fitted.size > 1) {
		const oldest = fitted.keys().next().value;
		if (oldest === undefined) break;
		const evicted = fitted.get(oldest);
		fitted.delete(oldest);
		if (evicted) fittedBytes -= evicted.byteLength;
	}
}

export async function fitPaintImages(
	images: PaintImage[],
): Promise<PaintImage[]> {
	if (!images.length) return images;
	const out = new Array<PaintImage>(images.length);
	let next = 0;
	const workers = Math.min(8, images.length);
	await Promise.all(
		Array.from({ length: workers }, async () => {
			for (;;) {
				const i = next++;
				const image = images[i];
				if (!image) return;
				const key = fitKey(image);
				const hot = key ? fitted.get(key) : undefined;
				if (key && hot) {
					fitted.delete(key);
					fitted.set(key, hot);
					out[i] = hot === image.data ? image : { ...image, data: hot };
					continue;
				}
				const done = await fitOne(image);
				if (key) rememberFitted(key, done.data);
				out[i] = done;
			}
		}),
	);
	return out;
}

async function fitOne(image: PaintImage): Promise<PaintImage> {
	const maxEdge = maxEdgeFor(image.src);
	try {
		const meta = await sharp(image.data, { failOn: "none" }).metadata();
		if (meta.format === "svg" || meta.format === "gif") return image;
		const w = meta.width ?? 0;
		const h = meta.height ?? 0;
		if (!w || !h || Math.max(w, h) <= maxEdge) return image;
		const data = new Uint8Array(
			await sharp(image.data, { failOn: "none" })
				.rotate()
				.resize({
					width: maxEdge,
					height: maxEdge,
					fit: "inside",
					withoutEnlargement: true,
				})
				.png({ compressionLevel: 1 })
				.toBuffer(),
		);
		return { ...image, data };
	} catch {
		return image;
	}
}
