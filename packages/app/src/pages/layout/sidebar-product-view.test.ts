import { describe, expect, test } from "bun:test"
import {
  productSidebarAvatar,
  productSidebarCurrentDirectory,
  productSidebarDirectories,
  productSidebarItemClass,
  productSidebarName,
  productSidebarProducts,
  productSidebarSessions,
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
        products: [
          { id: "product_1", related_project_ids: ["backend", "frontend"] },
        ],
        projects: [
          { id: "backend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
          { id: "frontend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端" },
        ],
        last_session_by_product: {},
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
    ])
  })

  test("切换产品时不会把旧产品当前目录混进新产品会话列表", () => {
    expect(
      productSidebarCurrentDirectory({
        product: {
          id: "product_cshis",
          related_project_ids: ["api", "client"],
        },
        products: [
          { id: "product_cshis", related_project_ids: ["api", "client"] },
        ],
        projects: [
          { id: "api", worktree: "\\\\192.168.1.212\\TPCode\\02WEBHIS-统一版\\统一HISAPI服务" },
          { id: "client", worktree: "\\\\192.168.1.212\\TPCode\\02HIS-CS\\CSHIS" },
          { id: "slow", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
        ],
        last_session_by_product: {},
        current_directory: "/Volumes/TPCode/07慢病系统-JAVA/后端/build-overlay/job_old",
        last_session_by_project: {
          api: {
            session_id: "ses_api",
            directory: "\\\\192.168.1.212\\TPCode\\02WEBHIS-统一版\\统一HISAPI服务",
          },
          client: {
            session_id: "ses_client",
            directory: "\\\\192.168.1.212\\TPCode\\02HIS-CS\\CSHIS",
          },
        },
      }),
    ).toEqual([])
  })

  test("当前目录已经是目标产品最近会话时仍然保留，避免切产品后丢掉当前会话", () => {
    expect(
      productSidebarCurrentDirectory({
        product: {
          id: "product_cshis",
          related_project_ids: ["api", "client"],
        },
        products: [
          { id: "product_cshis", related_project_ids: ["api", "client"] },
        ],
        projects: [
          { id: "api", worktree: "\\\\192.168.1.212\\TPCode\\02WEBHIS-统一版\\统一HISAPI服务" },
          { id: "client", worktree: "\\\\192.168.1.212\\TPCode\\02HIS-CS\\CSHIS" },
        ],
        last_session_by_product: {},
        current_directory: "/Volumes/TPCode/build-overlay/product_cshis-abc123",
        last_session_by_project: {
          api: {
            session_id: "ses_api",
            directory: "/Volumes/TPCode/build-overlay/product_cshis-abc123",
          },
        },
      }),
    ).toEqual(["/Volumes/TPCode/build-overlay/product_cshis-abc123"])
  })

  test("共享根目录产品存在产品级最近会话时，不再把共享根目录所有会话都拉出来", () => {
    expect(
      productSidebarDirectories({
        product: {
          id: "product_slow_1",
          related_project_ids: ["frontend", "backend"],
        },
        products: [
          { id: "product_slow", related_project_ids: ["frontend", "backend"] },
          { id: "product_slow_1", related_project_ids: ["frontend", "backend"] },
        ],
        projects: [
          { id: "frontend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端" },
          { id: "backend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
        ],
        last_session_by_product: {
          product_slow_1: {
            session_id: "ses_product",
            directory: "/Volumes/TPCode/build-overlay/product_slow_1-abc123",
            time_updated: 30,
          },
        },
        current_directory: undefined,
        last_session_by_project: {
          frontend: {
            session_id: "ses_frontend",
            directory: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端",
          },
          backend: {
            session_id: "ses_backend",
            directory: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端",
          },
        },
      }),
    ).toEqual(["/Volumes/TPCode/build-overlay/product_slow_1-abc123"])
  })

  test("共享项目集合且没有产品级最近会话时，不再显示别的产品遗留会话", () => {
    expect(
      productSidebarDirectories({
        product: {
          id: "product_slow_1",
          related_project_ids: ["frontend", "backend"],
        },
        products: [
          { id: "product_slow", related_project_ids: ["frontend", "backend"] },
          { id: "product_slow_1", related_project_ids: ["frontend", "backend"] },
        ],
        projects: [
          { id: "frontend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端" },
          { id: "backend", worktree: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\后端" },
        ],
        last_session_by_product: {},
        current_directory: undefined,
        last_session_by_project: {
          frontend: {
            session_id: "ses_frontend",
            directory: "\\\\192.168.1.212\\TPCode\\07慢病系统-JAVA\\前端",
          },
        },
      }),
    ).toEqual([])
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

  test("产品侧栏会话列表直接按当前产品过滤并保留多个根会话", () => {
    expect(
      productSidebarSessions({
        product_id: "product_cshis",
        sort: (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
        sessions: [
          {
            id: "ses_old_product",
            directory: "/Volumes/TPCode/build-overlay/product_slow-old",
            contextProductID: "product_slow",
            time: { created: 1, updated: 10 },
          },
          {
            id: "ses_cshis_new",
            directory: "/Volumes/TPCode/build-overlay/product_cshis-new",
            contextProductID: "product_cshis",
            time: { created: 1, updated: 30 },
          },
          {
            id: "ses_cshis_old",
            directory: "/Volumes/TPCode/build-overlay/product_cshis-old",
            contextProductID: "product_cshis",
            time: { created: 1, updated: 20 },
          },
          {
            id: "ses_child",
            directory: "/Volumes/TPCode/build-overlay/product_cshis-old",
            parentID: "ses_cshis_old",
            contextProductID: "product_cshis",
            time: { created: 1, updated: 25 },
          },
        ],
      }).map((item) => item.session.id),
    ).toEqual(["ses_cshis_new", "ses_cshis_old"])
  })

  test("产品侧栏会话列表最多只展示最近10条", () => {
    expect(
      productSidebarSessions({
        product_id: "product_cshis",
        sort: (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
        sessions: Array.from({ length: 12 }, (_, index) => ({
          id: `ses_${index}`,
          directory: `/tmp/product_cshis_${index}`,
          contextProductID: "product_cshis",
          time: { created: 1, updated: 100 - index },
        })),
      }).map((item) => item.session.id),
    ).toEqual(["ses_0", "ses_1", "ses_2", "ses_3", "ses_4", "ses_5", "ses_6", "ses_7", "ses_8", "ses_9"])
  })
})
