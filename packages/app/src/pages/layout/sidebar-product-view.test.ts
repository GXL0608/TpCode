import { describe, expect, test } from "bun:test"
import {
  productSidebarAvatar,
  productSidebarDirectories,
  productSidebarItemClass,
  productSidebarName,
  productSidebarProducts,
  useProductSidebar,
} from "./sidebar-product-view-helpers"

describe("sidebar-product-view", () => {
  test("产品侧栏目录会优先包含当前目录和最近会话目录，并对同一真实目录去重", () => {
    expect(
      productSidebarDirectories({
        product: {
          id: "product_1",
          related_project_ids: ["backend", "frontend"],
        },
        projects: [
          { id: "backend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
          { id: "frontend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端" },
        ],
        current_directory: "/Volumes/TPCode/07慢病系统-JAVA/后端/build-overlay/job_1",
        last_session_by_project: {
          backend: {
            session_id: "ses_backend",
            directory: "/Volumes/TPCode/07慢病系统-JAVA/后端/build-overlay/job_1",
          },
          frontend: {
            session_id: "ses_frontend",
            directory: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端",
          },
        },
      }),
    ).toEqual([
      "/Volumes/TPCode/07慢病系统-JAVA/后端/build-overlay/job_1",
      "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端",
      "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端",
    ])
  })

  test("产品侧栏显示名与头像都只围绕产品本身，不暴露解决方案信息", () => {
    expect(productSidebarName({ id: "product_1", name: "慢病管理系统" })).toBe("慢病管理系统")
    expect(productSidebarAvatar({ id: "product_1", name: "慢病管理系统" })).toBe("慢")
    expect(productSidebarAvatar({ id: "product_1" })).toBe("P")
  })

  test("存在产品上下文时强制切到产品视图", () => {
    expect(useProductSidebar("product_1")).toBe(true)
    expect(useProductSidebar("")).toBe(false)
    expect(useProductSidebar(undefined)).toBe(false)
  })

  test("产品接口未返回时侧栏仍保留当前产品占位，避免导航整列空白", () => {
    expect(
      productSidebarProducts({
        products: [],
        current_product_id: "product_1",
      }),
    ).toEqual([
      {
        id: "product_1",
        name: "当前产品",
        selected: true,
        last_selected: true,
      },
    ])
  })

  test("产品导航项对选中产品返回高亮样式", () => {
    expect(productSidebarItemClass(true)).toContain("border-brand-solid")
    expect(productSidebarItemClass(false)).toContain("hover:bg-surface-base-hover")
  })
})
