import { describe, expect, test } from "bun:test"
import { projectSelected, projectTileActive, selectedProjectSidebarAction } from "./sidebar-project-helpers"

describe("projectSelected", () => {
  test("matches direct worktree", () => {
    expect(projectSelected("/tmp/root", "/tmp/root")).toBe(true)
  })

  test("matches sandbox worktree", () => {
    expect(projectSelected("/tmp/branch", "/tmp/root", ["/tmp/branch"])).toBe(true)
    expect(projectSelected("/tmp/other", "/tmp/root", ["/tmp/branch"])).toBe(false)
  })
})

describe("projectTileActive", () => {
  test("menu state always wins", () => {
    expect(
      projectTileActive({
        menu: true,
        preview: false,
        open: false,
        overlay: false,
        worktree: "/tmp/root",
      }),
    ).toBe(true)
  })

  test("preview mode uses open state", () => {
    expect(
      projectTileActive({
        menu: false,
        preview: true,
        open: true,
        overlay: true,
        hoverProject: "/tmp/other",
        worktree: "/tmp/root",
      }),
    ).toBe(true)
  })

  test("overlay mode uses hovered project", () => {
    expect(
      projectTileActive({
        menu: false,
        preview: false,
        open: false,
        overlay: true,
        hoverProject: "/tmp/root",
        worktree: "/tmp/root",
      }),
    ).toBe(true)
    expect(
      projectTileActive({
        menu: false,
        preview: false,
        open: false,
        overlay: true,
        hoverProject: "/tmp/other",
        worktree: "/tmp/root",
      }),
    ).toBe(false)
  })
})

describe("selectedProjectSidebarAction", () => {
  test("returns close when sidebar is already open", () => {
    expect(selectedProjectSidebarAction(true)).toBe("close")
  })

  test("returns open when sidebar is collapsed", () => {
    expect(selectedProjectSidebarAction(false)).toBe("open")
  })
})
