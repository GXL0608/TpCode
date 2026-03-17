import { describe, expect, test } from "bun:test"
import {
  collapseVisibleProjects,
  currentProjectID,
  latestRememberedProductSession,
  nextOpenProjectIDs,
  productEntryDirectory,
  productEntryProjectID,
  productProjectIDs,
  repairProjectID,
  shouldSkipAccountProjectReload,
  visibleProjectIDs,
} from "./account-project"

const projects = [{ id: "a" }, { id: "b" }, { id: "c" }]

describe("account project list", () => {
  test("keeps the current open order when opening an existing project", () => {
    expect(
      nextOpenProjectIDs({
        open_project_ids: ["b", "a"],
        project_id: "a",
      }),
    ).toEqual(["b", "a"])
  })

  test("appends a newly opened project instead of moving it to the front", () => {
    expect(
      nextOpenProjectIDs({
        open_project_ids: ["b", "a"],
        project_id: "c",
      }),
    ).toEqual(["b", "a", "c"])
  })

  test("keeps persisted open order when current project is already open", () => {
    expect(
      visibleProjectIDs({
        projects,
        open_project_ids: ["b", "a"],
        current_project_id: "b",
      }),
    ).toEqual(["b", "a"])
  })

  test("surfaces the current project when refresh state lost the open list entry", () => {
    expect(
      visibleProjectIDs({
        projects,
        open_project_ids: [],
        current_project_id: "b",
      }),
    ).toEqual(["b"])
  })

  test("appends the current project when it is missing from persisted open order", () => {
    expect(
      visibleProjectIDs({
        projects,
        open_project_ids: ["a", "c"],
        current_project_id: "b",
      }),
    ).toEqual(["a", "c", "b"])
  })

  test("ignores unknown ids from stale state", () => {
    expect(
      visibleProjectIDs({
        projects,
        open_project_ids: ["x", "a", "a"],
        current_project_id: "x",
      }),
    ).toEqual(["a"])
  })

  test("collapses duplicate project entries that point to the same shared directory", () => {
    expect(
      collapseVisibleProjects({
        projects: [
          { id: "unc", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
          { id: "mounted", worktree: "/Volumes/TPCode/07慢病系统-JAVA/后端" },
        ],
        current_project_id: "mounted",
      }),
    ).toEqual([{ id: "mounted", worktree: "/Volumes/TPCode/07慢病系统-JAVA/后端" }])
  })

  test("prefers product related project ids over the legacy single project id", () => {
    expect(
      productProjectIDs({
        project_id: "legacy",
        related_project_ids: ["frontend", "backend", "frontend"],
      }),
    ).toEqual(["frontend", "backend"])
  })

  test("falls back to the legacy project id when the product has no related project ids", () => {
    expect(
      productProjectIDs({
        project_id: "legacy",
      }),
    ).toEqual(["legacy"])
  })

  test("picks the latest remembered session from the product related projects", () => {
    expect(
      latestRememberedProductSession({
        product: {
          related_project_ids: ["frontend", "backend"],
        },
        last_session_by_project: {
          frontend: {
            session_id: "ses_frontend",
            directory: "/frontend",
            time_updated: 10,
          },
          backend: {
            session_id: "ses_backend",
            directory: "/backend",
            time_updated: 20,
          },
        },
      }),
    ).toEqual({
      session_id: "ses_backend",
      directory: "/backend",
      time_updated: 20,
    })
  })

  test("prefers the current related project when choosing the product entry project", () => {
    expect(
      productEntryProjectID({
        product: {
          related_project_ids: ["frontend", "backend"],
        },
        current_project_id: "backend",
        last_project_id: "frontend",
      }),
    ).toBe("backend")
  })

  test("falls back to the last related project when the current project is empty", () => {
    expect(
      productEntryProjectID({
        product: {
          related_project_ids: ["frontend", "backend"],
        },
        last_project_id: "frontend",
      }),
    ).toBe("frontend")
  })

  test("uses the resolved related project worktree as the product entry directory", () => {
    expect(
      productEntryDirectory({
        product: {
          related_project_ids: ["frontend", "backend"],
          worktree: "/legacy",
        },
        projects: [
          { id: "frontend", worktree: "/frontend" },
          { id: "backend", worktree: "/backend" },
        ],
        last_project_id: "backend",
      }),
    ).toBe("/backend")
  })

  test("clears the stale current project when the selected product has no anchor project", () => {
    expect(
      currentProjectID({
        context_project_id: undefined,
        context_product_id: "product_1",
        state_current_project_id: "stale_project",
      }),
    ).toBeUndefined()
  })

  test("keeps the explicit context project when the product still has a valid anchor project", () => {
    expect(
      currentProjectID({
        context_project_id: "current_project",
        context_product_id: "product_1",
        state_current_project_id: "stale_project",
      }),
    ).toBe("current_project")
  })

  test("does not repair before the server-backed state is hydrated", () => {
    expect(
      repairProjectID({
        ready: true,
        hydrated: false,
        authenticated: true,
        pending: false,
        projects,
        open_project_ids: [],
        current_project_id: "b",
      }),
    ).toBeUndefined()
  })

  test("repairs the current project only after hydration when it is missing from the open list", () => {
    expect(
      repairProjectID({
        ready: true,
        hydrated: true,
        authenticated: true,
        pending: false,
        projects,
        open_project_ids: ["a"],
        current_project_id: "b",
      }),
    ).toBe("b")
  })

  test("skips the immediate reload after an explicit context switch to the same project", () => {
    expect(
      shouldSkipAccountProjectReload({
        skip_for: "b",
        context_project_id: "b",
      }),
    ).toBe(true)
  })

  test("does not skip reload when the context does not match the pending skip marker", () => {
    expect(
      shouldSkipAccountProjectReload({
        skip_for: "b",
        context_project_id: "c",
      }),
    ).toBe(false)
    expect(
      shouldSkipAccountProjectReload({
        skip_for: undefined,
        context_project_id: "b",
      }),
    ).toBe(false)
  })
})
