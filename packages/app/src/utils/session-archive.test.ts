import { describe, expect, mock, test } from "bun:test"
import { dict as en } from "@/i18n/en"
import { archiveConfirmMessage, archiveDirtyCount, archiveNeedsForce, archiveWithConfirm } from "./session-archive"

const t = (key: keyof typeof en, args?: Record<string, string | number>) => {
  const value = en[key]
  if (!args) return value
  return Object.entries(args).reduce(
    (result, [name, item]) => result.replaceAll(`{{${name}}}`, String(item)),
    value,
  )
}

describe("session archive helpers", () => {
  test("detects when archive confirmation is required", () => {
    expect(archiveNeedsForce(undefined)).toBe(false)
    expect(archiveNeedsForce({ has_workspace: true, dirty: false })).toBe(false)
    expect(archiveNeedsForce({ has_workspace: false, dirty: true })).toBe(false)
    expect(archiveNeedsForce({ has_workspace: true, dirty: true })).toBe(true)
  })

  test("formats single and batch confirmation copy", () => {
    expect(archiveConfirmMessage(t)).toContain("clear the contents of this workspace")
    expect(archiveConfirmMessage(t, 3)).toContain("clear the contents of 3 workspaces")
  })

  test("counts only dirty workspaces", () => {
    expect(
      archiveDirtyCount([
        undefined,
        { has_workspace: true, dirty: false },
        { has_workspace: true, dirty: true },
        { has_workspace: true, dirty: true },
      ]),
    ).toBe(2)
  })

  test("archives immediately when no confirmation is needed", async () => {
    const archive = mock(() => Promise.resolve())
    const result = await archiveWithConfirm({
      t,
      preview: () => Promise.resolve({ has_workspace: true, dirty: false }),
      archive,
    })

    expect(result).toBe(true)
    expect(archive).toHaveBeenCalledWith(false)
  })

  test("stops when archive confirmation is rejected", async () => {
    const archive = mock(() => Promise.resolve())
    const confirm = mock(() => false)
    const result = await archiveWithConfirm({
      t,
      preview: () => Promise.resolve({ has_workspace: true, dirty: true }),
      archive,
      confirm,
    })

    expect(result).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(archive).not.toHaveBeenCalled()
  })

  test("passes force when dirty workspace is confirmed", async () => {
    const archive = mock(() => Promise.resolve())
    const confirm = mock(() => true)
    const result = await archiveWithConfirm({
      t,
      preview: () => Promise.resolve({ has_workspace: true, dirty: true }),
      archive,
      confirm,
    })

    expect(result).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(archive).toHaveBeenCalledWith(true)
  })
})
