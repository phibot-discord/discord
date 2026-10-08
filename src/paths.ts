import { join, resolve } from "node:path";

function appRoot(): string {
	const fromEnv = process.env.PHI_APP_ROOT?.trim();
	if (fromEnv) return resolve(fromEnv);
	return process.cwd();
}

export function assetsDir(): string {
	const fromEnv = process.env.PHI_ASSETS?.trim();
	if (fromEnv) return resolve(fromEnv);
	return join(appRoot(), "phi-assets");
}

export function illDir(): string {
	const fromEnv = process.env.PHI_ILL?.trim();
	if (fromEnv) return resolve(fromEnv);
	return join(assetsDir(), "original_ill");
}

export function phiCssHref(file: string): string {
	return `phi-css://${file}`;
}
