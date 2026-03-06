import { describe, expect, test } from "bun:test"
import { projectRootByDirectory, resolveProjectByDirectory, sanitizeProjectWorkspaceOrder } from "./project-resolver"

const projects = [
  {
    id: "project_a",
    worktree: "/repo/a",
    sandboxes: ["/repo/a-sandbox", "/repo/a-sandbox-2"],
  },
  {
    id: "project_b",
    worktree: "/repo/b",
    sandboxes: [],
  },
]

describe("project resolver", () => {
  test("resolves root and sandbox directories to the owning project", () => {
    expect(resolveProjectByDirectory(projects, "/repo/a")?.id).toBe("project_a")
    expect(resolveProjectByDirectory(projects, "/repo/a-sandbox")?.id).toBe("project_a")
    expect(resolveProjectByDirectory(projects, "/repo/missing")).toBeUndefined()
    expect(projectRootByDirectory(projects, "/repo/a-sandbox")).toBe("/repo/a")
  })

  test("sanitizes workspace order to keep real directories and root first", () => {
    expect(sanitizeProjectWorkspaceOrder(projects[0], ["/tmp/missing", "/repo/a-sandbox", "/repo/a"])).toEqual([
      "/repo/a",
      "/repo/a-sandbox",
      "/repo/a-sandbox-2",
    ])
  })
})
