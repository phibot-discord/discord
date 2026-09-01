import type { Kv } from "../../../src/sdk/index.ts"
import { kvKey } from "./const.ts"

function credentialKey(kind: string, value: string | number) {
  return kvKey(kind, String(value))
}

class CredentialStore {
  constructor(private db: Kv) {}

  getSessionToken(userId: string | number) {
    return this.db.get(credentialKey("userToken", userId))
  }

  setSessionToken(userId: string | number, sessionToken: string) {
    return this.db.set(credentialKey("userToken", userId), sessionToken)
  }

  deleteSessionToken(userId: string | number) {
    return this.db.del(credentialKey("userToken", userId))
  }

  getApiId(userId: string | number) {
    return this.db.get(credentialKey("userApiId", userId))
  }

  setApiId(userId: string | number, apiId: string | number) {
    return this.db.set(credentialKey("userApiId", userId), String(apiId))
  }

  deleteApiId(userId: string | number) {
    return this.db.del(credentialKey("userApiId", userId))
  }

  async clearLocalCredentials(userId: string | number) {
    await this.db.del(credentialKey("userToken", userId))
    await this.db.del(credentialKey("userApiId", userId))
  }

  async listSessionCredentials() {
    const prefix = `${kvKey("userToken")}:`
    const names = await this.db.keys(prefix)
    const values = await Promise.all(names.map(key => this.db.get(key)))
    const result = new Map<string, string>()
    names.forEach((key, index) => {
      const value = values[index]
      if (value) result.set(key.slice(prefix.length), value)
    })
    return result
  }

  async banSessionToken(sessionToken: string) {
    return this.db.set(credentialKey("banSessionToken", sessionToken), "1")
  }

  allowSessionToken(sessionToken: string) {
    return this.db.del(credentialKey("banSessionToken", sessionToken))
  }

  async isSessionTokenBanned(sessionToken?: string | null) {
    if (!sessionToken) return false
    return Boolean(await this.db.get(credentialKey("banSessionToken", sessionToken)))
  }
}

export function initCredentials(db: Kv) {
  return new CredentialStore(db)
}
