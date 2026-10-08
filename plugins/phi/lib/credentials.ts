import type { KvStore } from "../../../src/kv.ts";
import { PHI_KV } from "./const.ts";

function credentialKey(kind: string, value: string | number) {
	return `${PHI_KV}:${kind}:${String(value)}`;
}

class CredentialStore {
	constructor(private kv: KvStore) {}

	getSessionToken(userId: string | number) {
		return this.kv.get(credentialKey("userToken", userId));
	}

	setSessionToken(userId: string | number, sessionToken: string) {
		return this.kv.set(credentialKey("userToken", userId), sessionToken);
	}

	clearLocalCredentials(userId: string | number) {
		return this.kv.del(
			credentialKey("userToken", userId),
			credentialKey("userApiId", userId),
		);
	}

	/**
	 * Deletes `phi:save:<token>`: its key is the TapTap session token and the
	 * blob holds it again (`session`), so it must not outlive the binding
	 */
	clearSessionSave(sessionToken: string) {
		return this.kv.del(credentialKey("save", sessionToken));
	}

	async isSessionTokenBanned(sessionToken?: string | null) {
		if (!sessionToken) return false;
		return Boolean(
			await this.kv.get(credentialKey("banSessionToken", sessionToken)),
		);
	}
}

export function initCredentials(kv: KvStore) {
	return new CredentialStore(kv);
}
