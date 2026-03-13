import fs from "node:fs/promises"
import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { cleanupTestProject, openSidebar, setWorkspacesEnabled } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk, dirSlug, projectSession, sessionPath } from "../utils"

function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
}

/** 中文注释：切换新会话页的 agent 到 build，复用与主 build e2e 一致的交互方式。 */
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

async function waitWorkspaceReady(page: Page, slug: string) {
  await openSidebar(page)
  const item = page.locator(workspaceItemSelector(slug)).first()
  await expect(item).toBeVisible({ timeout: 60_000 })
}

async function createWorkspace(page: Page, root: string, seen: string[]) {
  await openSidebar(page)
  await page.getByRole("button", { name: "New workspace" }).first().click()

  await expect
    .poll(
      () => {
        const slug = slugFromUrl(page.url())
        if (!slug) return ""
        if (slug === root) return ""
        if (seen.includes(slug)) return ""
        return slug
      },
      { timeout: 45_000 },
    )
    .not.toBe("")

  const slug = slugFromUrl(page.url())
  const directory = base64Decode(slug)
  if (!directory) throw new Error(`Failed to decode workspace slug: ${slug}`)
  const resolved = await fs.realpath(directory).catch(() => directory)
  return {
    slug: dirSlug(resolved),
    directory: resolved,
  }
}

async function openWorkspaceNewSession(page: Page, slug: string) {
  await waitWorkspaceReady(page, slug)

  const item = page.locator(workspaceItemSelector(slug)).first()
  await item.hover()

  const button = page.locator(workspaceNewSessionSelector(slug)).first()
  await expect(button).toBeVisible()
  await button.click({ force: true })

  await expect.poll(() => slugFromUrl(page.url())).toBe(slug)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
}

/** 中文注释：通过当前工作区的后端 SDK 直接创建会话，避免这条目录归属用例被外部模型状态干扰。 */
async function createSessionFromWorkspace(page: Page, slug: string, directory: string, text: string) {
  await openWorkspaceNewSession(page, slug)
  await expect(page.getByText("Current workspace")).toHaveCount(0)
  await expect(page.getByText("Shared workspace")).toHaveCount(0)
  await projectSession(directory)
  const sessionID = await createSdk(directory)
    .session.create({ title: text })
    .then((x) => {
      if (!x.data) throw new Error("Failed to create session from workspace")
      return x.data.id
    })
  await page.goto(sessionPath(directory, sessionID))
  await expect(page).toHaveURL(new RegExp(`/${slug}/session/${sessionID}(?:[/?#]|$)`))
  return sessionID
}

async function sessionDirectory(directory: string, sessionID: string) {
  await projectSession(directory)
  const info = await createSdk(directory)
    .session.get({ sessionID })
    .then((x) => x.data)
    .catch(() => undefined)
  if (!info) return ""
  return info.directory
}

test("new sessions from sidebar workspace actions stay in selected workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ directory, slug: root }) => {
    const workspaces = [] as { slug: string; directory: string }[]
    const sessions = [] as string[]

    try {
      await openSidebar(page)
      await setWorkspacesEnabled(page, root, true)

      const first = await createWorkspace(page, root, [])
      workspaces.push(first)
      await waitWorkspaceReady(page, first.slug)

      const second = await createWorkspace(page, root, [first.slug])
      workspaces.push(second)
      await waitWorkspaceReady(page, second.slug)

      const firstSession = await createSessionFromWorkspace(page, first.slug, first.directory, `workspace one ${Date.now()}`)
      sessions.push(firstSession)

      const secondSession = await createSessionFromWorkspace(page, second.slug, second.directory, `workspace two ${Date.now()}`)
      sessions.push(secondSession)

      const thirdSession = await createSessionFromWorkspace(
        page,
        first.slug,
        first.directory,
        `workspace one again ${Date.now()}`,
      )
      sessions.push(thirdSession)

      await expect.poll(() => sessionDirectory(first.directory, firstSession)).toBe(first.directory)
      await expect.poll(() => sessionDirectory(second.directory, secondSession)).toBe(second.directory)
      await expect.poll(() => sessionDirectory(first.directory, thirdSession)).toBe(first.directory)
    } finally {
      const dirs = [directory, ...workspaces.map((workspace) => workspace.directory)]
      await Promise.all(
        sessions.map((sessionID) =>
          Promise.all(
            dirs.map((dir) =>
              createSdk(dir)
                .session.delete({ sessionID })
                .catch(() => undefined),
            ),
          ),
        ),
      )
      await Promise.all(workspaces.map((workspace) => cleanupTestProject(workspace.directory)))
    }
  })
})

test("plan sessions created inside a new workspace stay on that workspace after switching to build", async ({
  page,
  withProject,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ directory, slug: root }) => {
    const workspaces = [] as { slug: string; directory: string }[]
    const sessions = [] as string[]

    try {
      await openSidebar(page)
      await setWorkspacesEnabled(page, root, true)

      const workspace = await createWorkspace(page, root, [])
      workspaces.push(workspace)
      await waitWorkspaceReady(page, workspace.slug)

      const sessionID = await createSessionFromWorkspace(
        page,
        workspace.slug,
        workspace.directory,
        `workspace plan ${Date.now()}`,
      )
      sessions.push(sessionID)
      await expect.poll(() => sessionDirectory(workspace.directory, sessionID)).toBe(workspace.directory)

      await selectBuild(page)
      const prompt = page.locator(promptSelector)
      await expect(prompt).toBeVisible()
      await prompt.click()
      await prompt.fill(`workspace build ${Date.now()}`)
      await prompt.press("Enter")

      await expect.poll(() => sessionDirectory(workspace.directory, sessionID), { timeout: 45_000 }).toBe(workspace.directory)
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/session/${sessionID}(?:[/?#]|$)`))
    } finally {
      const dirs = [directory, ...workspaces.map((item) => item.directory)]
      await Promise.all(
        sessions.map((sessionID) =>
          Promise.all(
            dirs.map((dir) =>
              createSdk(dir)
                .session.delete({ sessionID })
                .catch(() => undefined),
            ),
          ),
        ),
      )
      await Promise.all(workspaces.map((workspace) => cleanupTestProject(workspace.directory)))
    }
  })
})
