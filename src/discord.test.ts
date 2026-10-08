import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { REST } from "discord.js"
// Loads undici 8 and makes it the global dispatcher, as the render stack does at boot
import "./outgoing.ts"
import { discordAgent } from "./discord.ts"

test("card uploads reach Discord after undici 8 owns the global dispatcher", async () => {
  const server = createServer((req, res) => {
    let n = 0
    req.on("data", (c: Buffer) => {
      n += c.length
    })
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id: "1", received: n }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const { port } = server.address() as { port: number }
    const agent = discordAgent()
    assert.ok(agent, "discord.js agent resolved from its own undici")
    const rest = new REST({ api: `http://127.0.0.1:${port}`, version: "10", timeout: 5_000, retries: 0, agent }).setToken("t")
    const card = Buffer.alloc(1_600_000, 7)
    const res = (await rest.patch("/webhooks/1/token/messages/@original", {
      files: [{ name: "b30.jpg", data: card }],
      body: { content: "" },
    })) as { received: number }
    assert.ok(res.received > card.length, `multipart body arrived (${res.received}B)`)
  } finally {
    server.close()
  }
})
