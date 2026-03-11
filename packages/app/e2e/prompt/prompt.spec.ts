import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { sessionIDFromUrl } from "../actions"

const reply = (page: Page, token: string) => page.getByRole("log").getByText(token)

test("can send a prompt and receive a reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  await gotoSession()

  const token = `E2E_OK_${Date.now()}`

  const prompt = page.locator(promptSelector)
  await prompt.click()
  await page.keyboard.type(`Reply with exactly: ${token}`)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })

  const sessionID = (() => {
    const id = sessionIDFromUrl(page.url())
    if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)
    return id
  })()

  try {
    await expect(reply(page, token)).toBeVisible({ timeout: 90_000 })

    await expect
      .poll(
        async () => {
          const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
          return messages
            .filter((m) => m.info.role === "assistant")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
        },
        { timeout: 90_000 },
      )

      .toContain(token)
  } finally {
    page.off("pageerror", onPageError)
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})

test("reply stays visible when hydration returns a stale snapshot", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  let delayed = false
  await page.route(/\/session\/[^/]+\/message(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET" || delayed) {
      await route.continue()
      return
    }

    delayed = true
    const response = await route.fetch()
    const body = await response.body()
    await page.waitForTimeout(2000)
    await route.fulfill({ response, body })
  })

  await gotoSession()

  const token = `E2E_STALE_${Date.now()}`
  await page.locator(promptSelector).click()
  await page.keyboard.type(`Reply with exactly: ${token}`)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/session\/[^/?#]+/, { timeout: 30_000 })
  const sessionID = sessionIDFromUrl(page.url())!

  try {
    await expect(reply(page, token)).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(2500)
    await expect(reply(page, token)).toBeVisible()
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
