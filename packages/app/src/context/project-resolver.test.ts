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

  test("falls back to the encoded project id inside opencode worktree paths", () => {
    const directory =
      "c:\\users\\zhaoz\\.local\\share\\opencode\\worktree\\project_b\\stellar-planet-ses-313df03e5ffelypuwxrne6x0pi"
    const batch =
      "/Users/demo/.local/share/opencode/batch-worktree/project_a/night-shift"
    expect(resolveProjectByDirectory(projects, directory)?.id).toBe("project_b")
    expect(resolveProjectByDirectory(projects, batch)?.id).toBe("project_a")
    expect(projectRootByDirectory(projects, directory)).toBe("/repo/b")
  })

  test("sanitizes workspace order to keep real directories and root first", () => {
    expect(sanitizeProjectWorkspaceOrder(projects[0], ["/tmp/missing", "/repo/a-sandbox", "/repo/a"])).toEqual([
      "/repo/a",
      "/repo/a-sandbox",
      "/repo/a-sandbox-2",
    ])
  })
})
