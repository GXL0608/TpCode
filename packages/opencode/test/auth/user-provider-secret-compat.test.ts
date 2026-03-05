import { beforeAll, expect, test } from "bun:test"
import { createCipheriv, createHash, randomBytes } from "crypto"
import { Auth } from "../../src/auth"
import { and, Database, eq, inArray } from "../../src/storage/db"
import { TpUserProviderTable } from "../../src/user/user-provider.sql"
import { UserService } from "../../src/user/service"

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function seal(input: string, secret: string) {
  const iv = randomBytes(12)
  const enc = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv)
  const body = Buffer.concat([enc.update(input, "utf8"), enc.final()])
  const tag = enc.getAuthTag()
  return [iv.toString("hex"), tag.toString("hex"), body.toString("base64")].join(".")
}

async function wait(providerID: string, left: number): Promise<string | undefined> {
  const row = await Database.use((db) =>
    db
      .select()
      .from(TpUserProviderTable)
      .where(and(eq(TpUserProviderTable.user_id, "user_tp_admin"), eq(TpUserProviderTable.provider_id, providerID)))
      .get(),
  )
  if (!row) return
  if (row.secret_cipher.trim().startsWith("{")) return row.secret_cipher
  if (left <= 0) return
  await Bun.sleep(50)
  return wait(providerID, left - 1)
}

beforeAll(async () => {
  await UserService.ensureSeed()
})

test("Auth.userAllByID reads encrypted and plaintext secret_cipher", async () => {
  const providerCipher = uid("cipher")
  const providerPlain = uid("plain")
  const providerBad = uid("bad")
  const providerIDs = [providerCipher, providerPlain, providerBad]
  const now = Date.now()
  const cipherRaw = JSON.stringify({ type: "api", key: "sk-cipher" })
  const plainRaw = JSON.stringify({ type: "api", key: "sk-plain" })
  await Database.use((db) =>
    db
      .insert(TpUserProviderTable)
      .values([
        {
          id: crypto.randomUUID(),
          user_id: "user_tp_admin",
          provider_id: providerCipher,
          auth_type: "api",
          secret_cipher: seal(cipherRaw, "tpcode-account-dev-secret"),
          meta_json: {},
          is_active: true,
          time_created: now,
          time_updated: now,
        },
        {
          id: crypto.randomUUID(),
          user_id: "user_tp_admin",
          provider_id: providerPlain,
          auth_type: "api",
          secret_cipher: plainRaw,
          meta_json: {},
          is_active: true,
          time_created: now,
          time_updated: now,
        },
        {
          id: crypto.randomUUID(),
          user_id: "user_tp_admin",
          provider_id: providerBad,
          auth_type: "api",
          secret_cipher: "invalid-cipher-value",
          meta_json: {},
          is_active: true,
          time_created: now,
          time_updated: now,
        },
      ])
      .run(),
  )

  try {
    const all = await Auth.userAllByID("user_tp_admin")
    expect(all[providerCipher]).toMatchObject({ type: "api", key: "sk-cipher" })
    expect(all[providerPlain]).toMatchObject({ type: "api", key: "sk-plain" })
    expect(all[providerBad]).toBeUndefined()

    const repaired = await wait(providerCipher, 20)
    expect(repaired).toBeDefined()
    expect(repaired?.startsWith("{")).toBe(true)
    expect((JSON.parse(repaired ?? "{}") as { key?: string }).key).toBe("sk-cipher")
  } finally {
    await Database.use((db) =>
      db
        .delete(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, "user_tp_admin"), inArray(TpUserProviderTable.provider_id, providerIDs)))
        .run(),
    )
  }
})

test("Auth.setUser stores secret_cipher as plaintext json", async () => {
  const providerID = uid("save")
  await Auth.setUser("user_tp_admin", providerID, { type: "api", key: "sk-write-plain" })
  try {
    const row = await Database.use((db) =>
      db
        .select()
        .from(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, "user_tp_admin"), eq(TpUserProviderTable.provider_id, providerID)))
        .get(),
    )
    expect(!!row).toBe(true)
    expect(row?.secret_cipher.startsWith("{")).toBe(true)
    expect((JSON.parse(row?.secret_cipher ?? "{}") as { key?: string }).key).toBe("sk-write-plain")
  } finally {
    await Database.use((db) =>
      db
        .delete(TpUserProviderTable)
        .where(and(eq(TpUserProviderTable.user_id, "user_tp_admin"), eq(TpUserProviderTable.provider_id, providerID)))
        .run(),
    )
  }
})
