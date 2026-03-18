import { describe, expect, test } from "bun:test"
import {
  collapseVisibleProjects,
  currentProjectID,
  latestRememberedProductSession,
  nextProductNavigation,
  nextProductContextState,
  nextOpenProjectIDs,
  productEntryDirectory,
  productEntryProjectID,
  productProjectIDs,
  productSessionDirectoryMatches,
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
          id: "product_slow",
          related_project_ids: ["frontend", "backend"],
        },
        last_session_by_product: {},
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

  test("prefers product-specific remembered session over shared project history", () => {
    expect(
      latestRememberedProductSession({
        product: {
          id: "product_slow_1",
          related_project_ids: ["frontend", "backend"],
        },
        products: [
          {
            id: "product_slow",
            related_project_ids: ["frontend", "backend"],
          },
          {
            id: "product_slow_1",
            related_project_ids: ["frontend", "backend"],
          },
        ],
        last_session_by_product: {
          product_slow_1: {
            session_id: "ses_product",
            directory: "/tmp/product_slow_1-abcd",
            time_updated: 30,
          },
        },
        last_session_by_project: {
          frontend: {
            session_id: "ses_frontend",
            directory: "/slow/session",
            time_updated: 20,
          },
          backend: {
            session_id: "ses_backend",
            directory: "/slow/backend",
            time_updated: 10,
          },
        },
      }),
    ).toEqual({
      session_id: "ses_product",
      directory: "/tmp/product_slow_1-abcd",
      time_updated: 30,
    })
  })

  test("does not fall back to project-level history when another product shares the same project set", () => {
    expect(
      latestRememberedProductSession({
        product: {
          id: "product_slow_1",
          related_project_ids: ["frontend", "backend"],
        },
        products: [
          {
            id: "product_slow",
            related_project_ids: ["frontend", "backend"],
          },
          {
            id: "product_slow_1",
            related_project_ids: ["frontend", "backend"],
          },
        ],
        last_session_by_product: {},
        last_session_by_project: {
          frontend: {
            session_id: "ses_frontend",
            directory: "/slow/session",
            time_updated: 20,
          },
        },
      }),
    ).toBeUndefined()
  })

  test("switching products can disable project-level history fallback even when no product-specific session exists", () => {
    expect(
      latestRememberedProductSession({
        product: {
          id: "product_cshis",
          related_project_ids: ["api", "client"],
        },
        last_session_by_product: {},
        last_session_by_project: {
          api: {
            session_id: "ses_api",
            directory: "/api/session",
            time_updated: 20,
          },
          client: {
            session_id: "ses_client",
            directory: "/client/session",
            time_updated: 10,
          },
        },
        allow_project_fallback: false,
      }),
    ).toBeUndefined()
  })

  test("switching product reuses local remembered state without extra queries", () => {
    expect(
      nextProductContextState({
        product: {
          id: "product_backend",
          related_project_ids: ["frontend", "backend"],
        },
        state: {
          last_project_id: "backend",
          last_session_by_product: {},
          last_session_by_project: {
            frontend: {
              session_id: "ses_frontend",
              directory: "/frontend/session",
              time_updated: 10,
            },
            backend: {
              session_id: "ses_backend",
              directory: "/backend/session",
              time_updated: 20,
            },
          },
        },
      }),
    ).toEqual({
      open_project_ids: ["frontend", "backend"],
      last_project_id: "backend",
      remembered: {
        session_id: "ses_backend",
        directory: "/backend/session",
        time_updated: 20,
      },
    })
  })

  test("opening a product restores the remembered session route", () => {
    expect(
      nextProductNavigation({
        product: {
          id: "product_backend",
          related_project_ids: ["frontend", "backend"],
          worktree: "/backend",
        },
        projects: [
          { id: "frontend", worktree: "/frontend" },
          { id: "backend", worktree: "/backend" },
        ],
        state: {
          last_project_id: "backend",
          last_session_by_product: {},
          last_session_by_project: {
            backend: {
              session_id: "ses_backend",
              directory: "/backend/session",
              time_updated: 20,
            },
          },
        },
      }),
    ).toEqual({
      open_project_ids: ["frontend", "backend"],
      last_project_id: "backend",
      href: "/L2JhY2tlbmQvc2Vzc2lvbg/session/ses_backend",
    })
  })

  test("opening a product without remembered session lands on the product session root", () => {
    expect(
      nextProductNavigation({
        product: {
          id: "product_backend",
          related_project_ids: ["frontend", "backend"],
          worktree: "/backend",
        },
        projects: [
          { id: "frontend", worktree: "/frontend" },
          { id: "backend", worktree: "/backend" },
        ],
        state: {
          last_project_id: "backend",
          last_session_by_product: {},
          last_session_by_project: {},
        },
      }),
    ).toEqual({
      open_project_ids: ["frontend", "backend"],
      last_project_id: "backend",
      href: "/L2JhY2tlbmQ/session?product=product_backend",
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

  test("falls back to product paths when project catalog is unavailable", () => {
    expect(
      productEntryDirectory({
        product: {
          paths: ["/Volumes/TPCode/07慢病系统-JAVA/后端", "/Volumes/TPCode/07慢病系统-JAVA/前端"],
        },
        projects: [],
      }),
    ).toBe("/Volumes/TPCode/07慢病系统-JAVA/后端")
  })

  test("falls back to solution roots when product paths are missing", () => {
    expect(
      productEntryDirectory({
        product: {
          solutions: [
            {
              roots: [
                {
                  directory: "/Volumes/TPCode/02HIS-CS/CSHIS",
                  enabled: true,
                },
              ],
            },
          ],
        },
        projects: [],
      }),
    ).toBe("/Volumes/TPCode/02HIS-CS/CSHIS")
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
        skip_for_project: "b",
        context_project_id: "b",
      }),
    ).toBe(true)
  })

  test("skips the immediate reload after an explicit product switch to the same product", () => {
    expect(
      shouldSkipAccountProjectReload({
        skip_for_product: "product_b",
        context_product_id: "product_b",
      }),
    ).toBe(true)
  })

  test("does not skip reload when the context does not match the pending skip marker", () => {
    expect(
      shouldSkipAccountProjectReload({
        skip_for_project: "b",
        context_project_id: "c",
      }),
    ).toBe(false)
    expect(
      shouldSkipAccountProjectReload({
        skip_for_project: undefined,
        context_project_id: "b",
      }),
    ).toBe(false)
    expect(
      shouldSkipAccountProjectReload({
        skip_for_product: "product_b",
        context_product_id: "product_c",
      }),
    ).toBe(false)
  })

  test("matches product overlay directories by product id", () => {
    expect(productSessionDirectoryMatches("01KKTWF3TKC952B85RT8SRQHY6", "/tmp/01kktwf3tkc952b85rt8srqhy6-abcd")).toBe(true)
    expect(productSessionDirectoryMatches("01KKTWF3TKC952B85RT8SRQHY6", "C:\\tmp\\01kktwf3tkc952b85rt8srqhy6-abcd")).toBe(true)
    expect(productSessionDirectoryMatches("01KKTWF3TKC952B85RT8SRQHY6", "/tmp/01kkv6wvyajesjrrewwpmm8cr7-abcd")).toBe(false)
  })

  test("ignores stale remembered sessions from another product when projects are shared", () => {
    expect(
      latestRememberedProductSession({
        product: {
          id: "01KKV6WVYAJESJRREWWPMM8CR7",
          related_project_ids: ["backend", "frontend"],
        },
        products: [
          {
            id: "01KKTWF3TKC952B85RT8SRQHY6",
            related_project_ids: ["backend", "frontend"],
          },
          {
            id: "01KKV6WVYAJESJRREWWPMM8CR7",
            related_project_ids: ["backend", "frontend"],
          },
        ],
        last_session_by_product: {
          "01KKV6WVYAJESJRREWWPMM8CR7": {
            session_id: "ses_wrong",
            directory: "/tmp/01kktwf3tkc952b85rt8srqhy6-abcd",
            time_updated: 100,
          },
        },
        last_session_by_project: {},
        allow_project_fallback: false,
      }),
    ).toBeUndefined()
  })
})
