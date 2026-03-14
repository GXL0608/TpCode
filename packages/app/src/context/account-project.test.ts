import { describe, expect, test } from "bun:test"
import { nextOpenProjectIDs, repairProjectID, shouldSkipAccountProjectReload, visibleProjectIDs } from "./account-project"

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
