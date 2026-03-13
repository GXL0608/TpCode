import { test as base, expect, type Page } from "@playwright/test"
import { cleanupTestProject, createTestProject, seedProjects } from "./actions"
import { sessionComposerDockSelector } from "./selectors"
import { accountSession, createSdk, dirSlug, getWorktree, projectSession, sessionPath } from "./utils"

export const settingsKey = "settings.v3"

type TestFixtures = {
  sdk: ReturnType<typeof createSdk>
  gotoSession: (sessionID?: string) => Promise<void>
  withProject: <T>(
    callback: (project: {
      directory: string
      slug: string
      gotoSession: (sessionID?: string) => Promise<void>
    }) => Promise<T>,
    options?: { extra?: string[] },
  ) => Promise<T>
}

type WorkerFixtures = {
  directory: string
  slug: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  directory: [
    async ({}, use) => {
      const directory = await getWorktree()
      await use(directory)
    },
    { scope: "worker" },
  ],
  slug: [
    async ({ directory }, use) => {
      await use(dirSlug(directory))
    },
    { scope: "worker" },
  ],
  sdk: async ({ directory }, use) => {
    await projectSession(directory)
    await use(createSdk(directory))
  },
  gotoSession: async ({ page, directory }, use) => {
    await seedStorage(page, { directory })

    const gotoSession = async (sessionID?: string) => {
      await page.goto(sessionPath(directory, sessionID))
      await expect(page.locator(sessionComposerDockSelector)).toBeVisible()
    }
    await use(gotoSession)
  },
  withProject: async ({ page }, use) => {
    await use(async (callback, options) => {
      const directory = await createTestProject()
      const slug = dirSlug(directory)
      await seedStorage(page, { directory, extra: options?.extra })

      const gotoSession = async (sessionID?: string) => {
        await page.goto(sessionPath(directory, sessionID))
        await expect(page.locator(sessionComposerDockSelector)).toBeVisible()
      }

      try {
        await gotoSession()
        return await callback({ directory, slug, gotoSession })
      } finally {
        await cleanupTestProject(directory)
      }
    })
  },
})

async function seedStorage(page: Page, input: { directory: string; extra?: string[] }) {
  const auth = (await projectSession(input.directory)) ?? (await accountSession())
  await seedProjects(page, input)
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
}

export { expect }
