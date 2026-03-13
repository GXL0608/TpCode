import fs from "node:fs/promises"
import path from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "../fixtures"
import { clickMenuItem, openSessionMoreMenu, openSidebar, seedProjects, sessionIDFromUrl } from "../actions"
import { promptSelector, sessionComposerDockSelector, sessionItemSelector, workspaceItemSelector } from "../selectors"
import { createSdk, dirSlug, projectSession, sessionPath } from "../utils"

async function waitForWorkspace(input: { sdk: ReturnType<typeof createSdk>; sessionID: string; root: string }) {
  await expect
    .poll(
      async () => {
        const info = await input.sdk.session.get({ sessionID: input.sessionID }).then((r) => r.data)
        const dir = info?.directory ?? ""
        if (!dir || dir === input.root) return ""
        return dir
      },
      { timeout: 90_000 },
    )
    .not.toBe("")

  const info = await input.sdk.session.get({ sessionID: input.sessionID }).then((r) => r.data)
  const dir = info?.directory
  if (!dir || dir === input.root) {
    throw new Error(`Session ${input.sessionID} did not switch away from root directory`)
  }
  return dir
}

async function sendFirstPrompt(page: Page, text: string) {
  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await prompt.click()
  await page.keyboard.type(text)
  await page.keyboard.press("Enter")
}

async function selectBuild(page: Page) {
  const trigger = page.getByRole("button", { name: /plan|build/i }).last()
  await expect(trigger).toBeVisible()
  const current = ((await trigger.textContent()) ?? "").trim().toLowerCase()
  if (current === "build") return
  await trigger.click()
  const option = page.locator('[data-slot="select-select-item"]').filter({ hasText: /^build$/i }).first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(trigger).toContainText(/build/i)
}

async function currentDirectory(sdk: ReturnType<typeof createSdk>, sessionID: string) {
  return (await sdk.session.get({ sessionID }).then((r) => r.data?.directory)) ?? ""
}

function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
}

async function openProject(page: Page, directory: string, sessionID?: string) {
  const auth = await projectSession(directory)
  await seedProjects(page, { directory })
  await page.addInitScript((value) => {
    const decodeAccountID = (token?: string) => {
      if (!token) return "anonymous"
      const part = token.split(".")[1]
      if (!part) return "anonymous"
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/")
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
      try {
        const payload = JSON.parse(atob(padded)) as { sub?: unknown }
        return typeof payload.sub === "string" ? payload.sub : "anonymous"
      } catch {
        return "anonymous"
      }
    }

    if (value) {
      localStorage.setItem("tpcode.account.access_token", value.access_token)
      localStorage.setItem("tpcode.account.refresh_token", value.refresh_token)
      if (typeof value.access_expires_at === "number") {
        localStorage.setItem("tpcode.account.access_expires_at", String(value.access_expires_at))
      }
      if (typeof value.refresh_expires_at === "number") {
        localStorage.setItem("tpcode.account.refresh_expires_at", String(value.refresh_expires_at))
      }
    }
    const layout = JSON.stringify({
      sidebar: { opened: true, width: 344 },
      terminal: { height: 280, opened: false },
      review: { diffStyle: "split", panelOpened: false },
      fileTree: { opened: false, width: 344, tab: "changes" },
      session: { width: 600 },
      mobileSidebar: { opened: false },
      sessionTabs: {},
      sessionView: {},
      handoff: { tabs: undefined },
    })
    localStorage.setItem("opencode.global.dat:acct:anonymous:layout", layout)
    localStorage.setItem(`opencode.global.dat:acct:${decodeAccountID(value?.access_token)}:layout`, layout)
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        recent: [{ providerID: "opencode", modelID: "big-pickle" }],
        user: [],
        variant: {},
      }),
    )
  }, auth ?? null)
  await page.goto(sessionPath(directory, sessionID))
  await expect(page.locator(sessionComposerDockSelector)).toBeVisible()
}

test.describe.configure({ mode: "serial" })

test("build new session page shows the main workspace before the first prompt", async ({ page, withProject }) => {
  await withProject(async ({ directory }) => {
    await openProject(page, directory)
    await selectBuild(page)
    await expect(page.getByText("Current workspace")).toBeVisible()
    await expect(page.getByText("Main workspace")).toBeVisible()
    await expect(page.getByText("The first build message will create an isolated workspace for this session.")).toBeVisible()
  })
})

test("build workspace is created lazily on the first submitted prompt", async ({ page, directory }) => {
  test.setTimeout(120_000)

  await projectSession(directory)
  const sdk = createSdk(directory)
  const session = await sdk.session.create({ title: `e2e build lazy ${Date.now()}` }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  try {
    await openProject(page, directory, session.id)
    await selectBuild(page)

    await expect.poll(() => currentDirectory(sdk, session.id)).not.toBe("")
    const root = await currentDirectory(sdk, session.id)

    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type(`Reply with exactly: E2E_BUILD_PENDING_${Date.now()}`)

    await expect.poll(() => sdk.session.get({ sessionID: session.id }).then((r) => r.data?.directory)).toBe(root)

    await page.keyboard.press("Enter")

    const workspace = await waitForWorkspace({ sdk, sessionID: session.id, root })

    await expect.poll(() => sessionIDFromUrl(page.url()) ?? "").toBe(session.id)
    await expect(page).toHaveURL(new RegExp(`/${dirSlug(workspace)}/session/${session.id}(?:[/?#]|$)`))
    await openSidebar(page)
    await expect(page.locator(workspaceItemSelector(dirSlug(workspace))).first()).toBeVisible()
    await expect(page.locator(sessionItemSelector(session.id)).first()).toBeVisible()
  } finally {
    await sdk.session.abort({ sessionID: session.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
})

test("plan history remains visible after the session migrates into the first build workspace", async ({ page, directory }) => {
  test.setTimeout(120_000)

  await projectSession(directory)
  const sdk = createSdk(directory)
  const session = await sdk.session.create({ title: `e2e build history ${Date.now()}` }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  const planText = `E2E_PLAN_HISTORY_${Date.now()}`
  const buildText = `E2E_BUILD_HISTORY_${Date.now()}`

  try {
    await openProject(page, directory, session.id)
    await sendFirstPrompt(page, planText)
    await expect(page.getByText(planText)).toBeVisible()

    await selectBuild(page)
    const root = await currentDirectory(sdk, session.id)
    await sendFirstPrompt(page, buildText)

    const workspace = await waitForWorkspace({ sdk, sessionID: session.id, root })
    await expect(page).toHaveURL(new RegExp(`/${dirSlug(workspace)}/session/${session.id}(?:[/?#]|$)`))
    await expect(page.getByText(planText)).toBeVisible()
    await expect(page.getByText(buildText)).toBeVisible()
  } finally {
    await sdk.session.abort({ sessionID: session.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
})

test("dirty build workspace warns before archiving and is deleted after confirmation", async ({ page, directory }) => {
  test.setTimeout(120_000)

  await projectSession(directory)
  const sdk = createSdk(directory)
  const session = await sdk.session.create({ title: `e2e build archive ${Date.now()}` }).then((r) => r.data)
  if (!session?.id) throw new Error("Session create did not return an id")

  try {
    await openProject(page, directory, session.id)
    await selectBuild(page)
    await expect.poll(() => currentDirectory(sdk, session.id)).not.toBe("")
    const root = await currentDirectory(sdk, session.id)
    await sendFirstPrompt(page, `Reply with exactly: E2E_BUILD_ARCHIVE_${Date.now()}`)

    const workspace = await waitForWorkspace({ sdk, sessionID: session.id, root })
    await fs.writeFile(path.join(workspace, `dirty_${Date.now()}.txt`), "dirty\n", "utf8")

    const dismissed = new Promise<string>((resolve) => {
      page.once("dialog", async (dialog) => {
        const message = dialog.message()
        await dialog.dismiss()
        resolve(message)
      })
    })

    const firstMenu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(firstMenu, /archive/i)

    await expect(await dismissed).toContain("clear the contents of this workspace")
    await expect
      .poll(() => sdk.session.get({ sessionID: session.id }).then((r) => r.data?.time?.archived))
      .toBeUndefined()

    const accepted = new Promise<string>((resolve) => {
      page.once("dialog", async (dialog) => {
        const message = dialog.message()
        await dialog.accept()
        resolve(message)
      })
    })

    const secondMenu = await openSessionMoreMenu(page, session.id)
    await clickMenuItem(secondMenu, /archive/i)

    await expect(await accepted).toContain("clear the contents of this workspace")
    await expect
      .poll(
        () => sdk.session.get({ sessionID: session.id }).then((r) => r.data?.time?.archived),
        { timeout: 30_000 },
      )
      .not.toBeUndefined()
    await expect
      .poll(
        async () =>
          await fs
            .stat(workspace)
            .then(() => true)
            .catch(() => false),
        { timeout: 30_000 },
      )
      .toBe(false)
  } finally {
    await sdk.session.abort({ sessionID: session.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
  }
})

test("build sessions started from an existing workspace still migrate to a fresh build workspace", async ({
  page,
  directory,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1400, height: 800 })

  await projectSession(directory)
  const sdk = createSdk(directory)
  let workspaceDir: string | undefined
  let sessionID: string | undefined

  try {
    const workspace = await sdk.worktree.create({}).then((result) => result.data)
    if (!workspace?.directory) throw new Error("Worktree create did not return a directory")
    workspaceDir = workspace.directory
    await openProject(page, directory)
    await page.goto(sessionPath(workspace.directory))
    await expect(page.locator(promptSelector)).toBeVisible()
    await selectBuild(page)
    await expect(page.getByText("Current workspace")).toBeVisible()
    await expect(page.getByText("Shared workspace", { exact: true })).toBeVisible()
    await expect(page.getByText("You are currently in a shared workspace. The first build message will switch this session to an isolated workspace.")).toBeVisible()
    await sendFirstPrompt(page, `Reply with exactly: E2E_BUILD_SHARED_${Date.now()}`)

    await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")
    sessionID = sessionIDFromUrl(page.url()) ?? undefined
    if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)
    const id = sessionID

    await expect
      .poll(
        () => {
          const slug = slugFromUrl(page.url())
          if (!slug || slug === dirSlug(workspace.directory)) return ""
          return slug
        },
        { timeout: 30_000 },
      )
      .not.toBe("")

    const buildSlug = slugFromUrl(page.url())
    expect(buildSlug).not.toBe(dirSlug(workspace.directory))
    expect(buildSlug).not.toBe(dirSlug(directory))
    await expect
      .poll(
        async () => {
          const slug = slugFromUrl(page.url())
          if (!slug) return ""
          return slug === dirSlug(workspace.directory) ? "" : slug
        },
        { timeout: 30_000 },
      )
      .toBe(buildSlug)
  } finally {
    if (sessionID) await sdk.session.abort({ sessionID }).catch(() => undefined)
    if (sessionID) await sdk.session.delete({ sessionID }).catch(() => undefined)
    if (workspaceDir) {
      await sdk.worktree.remove({ worktreeRemoveInput: { directory: workspaceDir } }).catch(() => undefined)
    }
  }
})

test("first build shell call creates an isolated workspace before execution", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)
    const session = await sdk.session.create({ title: `e2e build shell ${Date.now()}` }).then((r) => r.data)
    if (!session?.id) throw new Error("Session create did not return an id")

    try {
      await project.gotoSession(session.id)
      await selectBuild(page)
      const root = await currentDirectory(sdk, session.id)
      await sdk.session.shell({
        sessionID: session.id,
        command: "pwd",
        agent: "build",
      })

      const workspace = await waitForWorkspace({ sdk, sessionID: session.id, root })
      expect(workspace).not.toBe(root)
    } finally {
      await sdk.session.abort({ sessionID: session.id }).catch(() => undefined)
      await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
    }
  })
})

test("first build slash command creates an isolated workspace before execution", async ({ page, withProject }) => {
  test.setTimeout(120_000)

  await withProject(async (project) => {
    const sdk = createSdk(project.directory)
    const session = await sdk.session.create({ title: `e2e build command ${Date.now()}` }).then((r) => r.data)
    if (!session?.id) throw new Error("Session create did not return an id")

    try {
      await project.gotoSession(session.id)
      await selectBuild(page)
      const root = await currentDirectory(sdk, session.id)
      void sdk.session
        .command({
          sessionID: session.id,
          command: "review",
          arguments: "",
          agent: "build",
        })
        .catch(() => undefined)

      const workspace = await waitForWorkspace({ sdk, sessionID: session.id, root })
      expect(workspace).not.toBe(root)
    } finally {
      await sdk.session.abort({ sessionID: session.id }).catch(() => undefined)
      await sdk.session.delete({ sessionID: session.id }).catch(() => undefined)
    }
  })
})
