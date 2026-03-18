import { describe, expect, test } from "bun:test"
import { productContextPaths, productContextProjectIDs, sidebarProductContext } from "./sidebar-product-context"

describe("productContextPaths", () => {
  test("prefers backend-provided product paths", () => {
    expect(
      productContextPaths({
        id: "product_1",
        paths: ["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"],
      }),
    ).toEqual(["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"])
  })

  test("falls back to matching local project ids from product paths when explicit project ids are missing", () => {
    expect(
      productContextProjectIDs({
        product: {
          id: "product_1",
          paths: ["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"],
        },
        projects: [
          {
            id: "folder_backend",
            worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端",
          },
          {
            id: "folder_frontend",
            worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端",
          },
        ],
      }),
    ).toEqual(["folder_backend", "folder_frontend"])
  })

  test("falls back to the current context project when product metadata has no resolvable project ids", () => {
    expect(
      productContextProjectIDs({
        product: {
          id: "product_1",
          paths: [],
        },
        projects: [],
        current_project_id: "folder_backend",
      }),
    ).toEqual(["folder_backend"])
  })
})

describe("sidebarProductContext", () => {
  test("prefers product name and solution paths when the current project is only an anchor", () => {
    const result = sidebarProductContext({
      current_directory: "/Volumes/TPCode/07慢病系统-JAVA/后端",
      project: {
        id: "folder_backend",
        name: "后端",
        worktree: "/Volumes/TPCode/07慢病系统-JAVA/后端",
      },
      product: {
        id: "product_1",
        name: "慢病管理系统",
        project_id: "folder_backend",
        related_project_ids: ["folder_backend", "folder_frontend"],
        worktree: "/Volumes/TPCode/07慢病系统-JAVA/后端",
        paths: ["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"],
      },
    })

    expect(result).toEqual({
      name: "慢病管理系统",
      paths: ["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"],
    })
  })
})
