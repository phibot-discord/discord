import { infoView } from "./info-common.ts";
import type { CardVariant } from "./types.ts";

/** Player info in one tall column, sized to be read on a phone unzoomed */
export const variant: CardVariant = {
	tpl: "info-portrait",
	width: 720,
	prepare: (data, ctx) => ({
		...data,
		iv: infoView(data, ctx.locale, {
			nameW: 470,
			nameMax: 48,
			nameMin: 28,
			introW: 624,
			introMaxLines: 5,
			introMax: 28,
			introMin: 22,
			rks: { w: 624, h: 200 },
			data: { w: 624, h: 200 },
			acc: { w: 624, h: 200 },
		}),
	}),
};
