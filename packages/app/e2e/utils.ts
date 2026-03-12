import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import path from "node:path"

export const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
export const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"

export const serverUrl = `http://${serverHost}:${serverPort}`
export const serverName = `${serverHost}:${serverPort}`

export const modKey = process.platform === "darwin" ? "Meta" : "Control"
export const terminalToggleKey = "Control+Backquote"

const account = {
  username: process.env.PLAYWRIGHT_ADMIN_USERNAME ?? "admin",
  password: process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? "TpCode@2026",
}

let session:
  | Promise<
      | {
          access_token: string
          refresh_token: string
          access_expires_at?: number
          refresh_expires_at?: number
        }
      | undefined
    >
  | undefined
let tokens:
  | {
      access_token: string
      refresh_token: string
      access_expires_at?: number
      refresh_expires_at?: number
    }
  | undefined
const scoped = new Map<string, string>()

export async function accountSession() {
  if (session) return await session

  session = (async () => {
    const response = await fetch(`${serverUrl}/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(account),
    }).catch(() => undefined)

    if (!response || response.status === 404) return
    if (!response.ok) {
      throw new Error(`Failed to login test admin: ${response.status} ${response.statusText}`)
    }

    const body = await response.json().catch(() => undefined)
    if (!body || typeof body !== "object") throw new Error("Test admin login returned an invalid response")

    const access_token = typeof body.access_token === "string" ? body.access_token : undefined
    const refresh_token = typeof body.refresh_token === "string" ? body.refresh_token : undefined
    if (!access_token || !refresh_token) throw new Error("Test admin login did not return account tokens")

    tokens = {
      access_token,
      refresh_token,
      access_expires_at: typeof body.access_expires_at === "number" ? body.access_expires_at : undefined,
      refresh_expires_at: typeof body.refresh_expires_at === "number" ? body.refresh_expires_at : undefined,
    }
    return tokens
  })()

  return await session
}

export async function projectSession(directory: string) {
  const cached = scoped.get(directory)
  if (cached) {
    return {
      access_token: cached,
    }
  }

  const auth = await accountSession()
  if (!auth) return

  await fetch(`${serverUrl}/path`, {
    headers: {
      "x-opencode-directory": directory,
    },
  })

  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    encoding: "utf8",
  }).trim()

  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: directory,
    encoding: "utf8",
  }).trim()

  const commonPath = path.isAbsolute(common) ? common : path.resolve(top, common)
  const worktree = path.dirname(commonPath === top ? top : commonPath)
  const roots = execFileSync("git", ["rev-list", "--max-parents=0", "--all"], {
    cwd: top,
    encoding: "utf8",
  })
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()

  const legacy = roots[0] ?? "global"
  const project_id =
    legacy === "global"
      ? legacy
      : `${legacy}_${createHash("sha1").update(path.resolve(worktree).replace(/\\\\/g, "/").toLowerCase()).digest("hex").slice(0, 12)}`
  await fetch(`${serverUrl}/path`, {
    headers: {
      authorization: `Bearer ${auth.access_token}`,
      "x-opencode-directory": directory,
    },
  }).catch(() => undefined)
  const listed = await fetch(`${serverUrl}/project`).then((r) => r.json().catch(() => []))
  const project = Array.isArray(listed)
    ? listed.find(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.worktree === "string" &&
          path.resolve(item.worktree) === path.resolve(worktree),
      )
    : undefined
  const resolved = project && typeof project.id === "string" ? project.id : project_id

  const allow = await fetch(`${serverUrl}/account/admin/project-access/user`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      project_id: resolved,
      user_id: "user_tp_admin",
      mode: "allow",
    }),
  })

  if (!allow.ok) {
    throw new Error(
      `Failed to grant admin project access: ${allow.status} ${allow.statusText} ${await allow.text().catch(() => "")}`.trim(),
    )
  }

  const selected = await fetch(`${serverUrl}/account/context/select`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      project_id: resolved,
    }),
  })

  if (!selected.ok) {
    throw new Error(
      `Failed to select project context: ${selected.status} ${selected.statusText} ${await selected.text().catch(() => "")}`.trim(),
    )
  }

  const body = await selected.json().catch(() => undefined)
  if (!body || typeof body !== "object" || typeof body.access_token !== "string") {
    throw new Error("Project context select did not return an access token")
  }

  scoped.set(directory, body.access_token)
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : auth.refresh_token,
    access_expires_at: typeof body.access_expires_at === "number" ? body.access_expires_at : undefined,
    refresh_expires_at: typeof body.refresh_expires_at === "number" ? body.refresh_expires_at : undefined,
  }
}

export function createSdk(directory?: string) {
  const access = directory ? scoped.get(directory) ?? tokens?.access_token : tokens?.access_token
  return createOpencodeClient({
    baseUrl: serverUrl,
    directory,
    throwOnError: true,
    headers: access ? { authorization: `Bearer ${access}` } : undefined,
  })
}

export async function getWorktree() {
  await accountSession()
  const sdk = createSdk()
  const result = await sdk.path.get()
  const data = result.data
  if (!data?.worktree) throw new Error(`Failed to resolve a worktree from ${serverUrl}/path`)
  return data.worktree
}

export function dirSlug(directory: string) {
  return base64Encode(directory)
}

export function dirPath(directory: string) {
  return `/${dirSlug(directory)}`
}

export function sessionPath(directory: string, sessionID?: string) {
  return `${dirPath(directory)}/session${sessionID ? `/${sessionID}` : ""}`
}
