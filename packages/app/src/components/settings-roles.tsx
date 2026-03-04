import { Button } from "@opencode-ai/ui/button"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { parseAccountError, useAccountRequest } from "./settings-account-api"
import { type AccountPermission, type AccountRole, type AccountUser, permissionZh, roleZh } from "./settings-rbac-zh"

type RoleProjectsResponse = {
  ok: boolean
  role_code: string
  project_ids: string[]
}

type ProjectCatalogItem = {
  id: string
  name?: string
  worktree: string
  vcs?: string
  sources: string[]
}

type ScanDirEntry = {
  path: string
  name: string
}

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function page<T>(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const row = input as {
    items?: unknown
    total?: unknown
    page?: unknown
    page_size?: unknown
  }
  if (!Array.isArray(row.items)) return
  return {
    items: row.items as T[],
    total: typeof row.total === "number" ? row.total : Number(row.total ?? 0),
    page: typeof row.page === "number" ? row.page : Number(row.page ?? 1),
    page_size: typeof row.page_size === "number" ? row.page_size : Number(row.page_size ?? 15),
  }
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function firstScanRoot(input: string) {
  return input
    .split(/[,;\n]/g)
    .map((item) => item.trim())
    .find((item): item is string => !!item)
}

export const SettingsRoles = () => {
  const auth = useAccountAuth()
  const request = useAccountRequest()
  const canRole = createMemo(() => auth.has("role:manage"))
  const canMember = createMemo(() => canRole())

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    error: "",
    message: "",
    createCode: "",
    createName: "",
    createScope: "system" as "system" | "org",
    rolePage: 1,
    rolePageSize: 15,
    roleTotal: 0,
    roles: [] as AccountRole[],
    permissions: [] as AccountPermission[],
    users: [] as AccountUser[],
    roleProjects: {} as Record<string, string[]>,
    permOpen: false,
    permRoleCode: "",
    permCodes: [] as string[],
    permBase: [] as string[],
    permQuery: "",
    memberOpen: false,
    memberRoleCode: "",
    memberUserIDs: [] as string[],
    memberBase: [] as string[],
    memberLoading: false,
    projectOpen: false,
    projectRoleCode: "",
    projectIDs: [] as string[],
    projectBase: [] as string[],
    projectCatalog: [] as ProjectCatalogItem[],
    projectCatalogLoading: false,
    projectQuery: "",
    scanRoot: "",
    scanRootSource: "default" as "env" | "setting" | "default",
    scanRootSaving: false,
    scanDirOpen: false,
    scanDirLoading: false,
    scanDirCurrent: "",
    scanDirParent: "",
    scanDirEntries: [] as ScanDirEntry[],
  })

  const permissionQuickCodes = [
    "ui:settings.providers:view",
    "ui:settings.models:view",
    "provider:config_user",
    "agent:use_docs",
    "agent:use_build",
  ] as const
  const permissionQuickSet = new Set<string>(permissionQuickCodes)
  const quickPermissions = createMemo(() =>
    permissionQuickCodes.map((code) => {
      const found = state.permissions.find((item) => item.code === code)
      if (found) return found
      return {
        id: code,
        code,
        name: permissionZh(code),
        group_name: code.startsWith("agent:") ? "agent" : code.startsWith("provider:") ? "provider" : "ui",
      }
    }),
  )
  const filteredPermissions = createMemo(() => {
    const query = state.permQuery.trim().toLowerCase()
    const rows = state.permissions.filter((item) => !permissionQuickSet.has(item.code))
    if (!query) return rows
    return rows.filter((item) => {
      const name = permissionZh(item.code).toLowerCase()
      return item.code.toLowerCase().includes(query) || name.includes(query)
    })
  })

  const projectCatalogFiltered = createMemo(() => {
    const query = state.projectQuery.trim().toLowerCase()
    if (!query) return state.projectCatalog
    return state.projectCatalog.filter((item) => {
      const name = (item.name ?? "").toLowerCase()
      const tree = item.worktree.toLowerCase()
      return item.id.toLowerCase().includes(query) || name.includes(query) || tree.includes(query)
    })
  })

  const rolePageTotal = createMemo(() => Math.max(1, Math.ceil(state.roleTotal / state.rolePageSize)))
  const roleRangeStart = createMemo(() => {
    if (state.roleTotal === 0 || state.roles.length === 0) return 0
    return (state.rolePage - 1) * state.rolePageSize + 1
  })
  const roleRangeEnd = createMemo(() => {
    const start = roleRangeStart()
    if (start === 0) return 0
    return start + state.roles.length - 1
  })
  const roleMembersCount = (roleCode: string) => state.roles.find((item) => item.code === roleCode)?.member_count ?? 0
  const roleProjectCount = (roleCode: string) => (state.roleProjects[roleCode] ?? []).length
  const roleTitle = (code: string) => {
    const role = state.roles.find((item) => item.code === code)
    if (role?.name) return `${role.name} (${role.code})`
    const name = roleZh(code)
    if (name === code) return code
    return `${name} (${code})`
  }

  const togglePerm = (code: string) => {
    if (state.permCodes.includes(code)) {
      setState("permCodes", (current) => current.filter((item) => item !== code))
      return
    }
    setState("permCodes", (current) => [...current, code])
  }

  const toggleMember = (userID: string) => {
    if (state.memberUserIDs.includes(userID)) {
      setState("memberUserIDs", (current) => current.filter((item) => item !== userID))
      return
    }
    setState("memberUserIDs", (current) => [...current, userID])
  }

  const toggleProject = (projectID: string) => {
    if (state.projectIDs.includes(projectID)) {
      setState("projectIDs", (current) => current.filter((item) => item !== projectID))
      return
    }
    setState("projectIDs", (current) => [...current, projectID])
  }

  const loadRoleProjects = async (roles: AccountRole[]) => {
    const rows = await Promise.all(
      roles.map(async (item) => {
        const response = await request({ path: `/account/admin/roles/${encodeURIComponent(item.code)}/projects` }).catch(() => undefined)
        if (!response?.ok) return [item.code, [] as string[]] as const
        const body = (await response.json().catch(() => undefined)) as RoleProjectsResponse | undefined
        return [item.code, body?.project_ids ?? []] as const
      }),
    )
    const next = rows.reduce(
      (acc, [code, projectIDs]) => {
        acc[code] = projectIDs
        return acc
      },
      {} as Record<string, string[]>,
    )
    setState("roleProjects", next)
  }

  const load = async (input?: { page?: number }) => {
    if (!canRole()) return
    setState("loading", true)
    setState("error", "")
    const pageID = input?.page ?? state.rolePage

    const rolesQuery = new URLSearchParams({
      page: String(pageID),
      page_size: String(state.rolePageSize),
    })
    const rolesResponse = await request({ path: `/account/admin/roles?${rolesQuery.toString()}` }).catch(() => undefined)
    const permissionsResponse = await request({ path: "/account/admin/permissions" }).catch(() => undefined)
    const scanRootResponse = await request({ path: "/account/admin/settings/project-scan-root" }).catch(() => undefined)

    if (!rolesResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(rolesResponse))
      return
    }
    if (!permissionsResponse?.ok) {
      setState("loading", false)
      setState("error", await parseAccountError(permissionsResponse))
      return
    }

    const rolesBody = await rolesResponse.json().catch(() => undefined)
    const rolesPage = page<AccountRole>(rolesBody)
    const roles = rolesPage ? list<AccountRole>(rolesPage.items) : list<AccountRole>(rolesBody)
    const permissions = list<AccountPermission>(await permissionsResponse.json().catch(() => undefined))
    const scanRoot = scanRootResponse?.ok
      ? ((await scanRootResponse.json().catch(() => undefined)) as { project_scan_root?: string; source?: "env" | "setting" | "default" } | undefined)
      : undefined

    setState("roles", roles)
    setState("rolePage", Math.max(1, rolesPage?.page ?? pageID))
    setState("rolePageSize", Math.max(1, rolesPage?.page_size ?? state.rolePageSize))
    setState("roleTotal", Math.max(0, rolesPage?.total ?? roles.length))
    setState("permissions", permissions)
    setState("scanRoot", scanRoot?.project_scan_root ?? "")
    setState("scanRootSource", scanRoot?.source ?? "default")
    await loadRoleProjects(roles)
    setState("loading", false)
  }

  const saveScanRoot = async (value?: string) => {
    setState("scanRootSaving", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "PUT",
      path: "/account/admin/settings/project-scan-root",
      body: {
        project_scan_root: value?.trim() || undefined,
      },
    }).catch(() => undefined)
    setState("scanRootSaving", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return false
    }
    setState("message", "项目扫描根目录已保存")
    await load()
    return true
  }

  const loadScanDirs = async (target?: string) => {
    setState("scanDirLoading", true)
    const query = new URLSearchParams()
    const value = target?.trim()
    if (value) query.set("path", value)
    const response = await request({
      path: query.size > 0 ? `/account/admin/fs/directories?${query.toString()}` : "/account/admin/fs/directories",
    }).catch(() => undefined)
    setState("scanDirLoading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const body = (await response.json().catch(() => undefined)) as
      | {
          ok?: boolean
          current?: string
          parent?: string
          directories?: ScanDirEntry[]
        }
      | undefined
    setState("scanDirCurrent", body?.current ?? "")
    setState("scanDirParent", body?.parent ?? "")
    setState("scanDirEntries", list<ScanDirEntry>(body?.directories))
  }

  const chooseScanRoot = async () => {
    setState("scanDirOpen", true)
    setState("error", "")
    await loadScanDirs(firstScanRoot(state.scanRoot))
  }

  const closeScanDir = () => {
    if (state.scanDirLoading || state.scanRootSaving) return
    setState("scanDirOpen", false)
    setState("scanDirCurrent", "")
    setState("scanDirParent", "")
    setState("scanDirEntries", [])
  }

  const confirmScanDir = async () => {
    const current = state.scanDirCurrent.trim()
    if (!current) return
    setState("scanRoot", current)
    const ok = await saveScanRoot(current)
    if (!ok) return
    closeScanDir()
  }

  const enterScanDir = async (target: string) => {
    await loadScanDirs(target)
  }

  const openScanRoots = async () => {
    await loadScanDirs(undefined)
  }

  const enterScanParent = async () => {
    const parent = state.scanDirParent.trim()
    if (!parent) {
      await openScanRoots()
      return
    }
    await loadScanDirs(parent)
  }

  const clearScanRoot = async () => {
    setState("scanRoot", "")
    await saveScanRoot(undefined)
  }

  const loadCatalog = async () => {
    setState("projectCatalogLoading", true)
    const response = await request({ path: "/account/admin/projects/catalog?source=scanned" }).catch(() => undefined)
    setState("projectCatalogLoading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const rows = list<ProjectCatalogItem>(await response.json().catch(() => undefined))
    setState("projectCatalog", rows)
  }

  const openPerm = (role: AccountRole) => {
    setState("permOpen", true)
    setState("permRoleCode", role.code)
    setState("permCodes", role.permissions.slice())
    setState("permBase", role.permissions.slice())
    setState("permQuery", "")
  }

  const openMember = async (role: AccountRole) => {
    if (!canMember()) return
    setState("error", "")
    setState("memberOpen", true)
    setState("memberRoleCode", role.code)
    setState("memberUserIDs", [])
    setState("memberBase", [])
    setState("users", [])
    setState("memberLoading", true)
    const response = await request({ path: "/account/admin/users" }).catch(() => undefined)
    setState("memberLoading", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    const usersBody = await response.json().catch(() => undefined)
    const usersPage = page<AccountUser>(usersBody)
    const users = usersPage ? list<AccountUser>(usersPage.items) : list<AccountUser>(usersBody)
    const selected = users.filter((item) => item.roles.includes(role.code)).map((item) => item.id)
    setState("users", users)
    setState("memberUserIDs", selected)
    setState("memberBase", selected)
  }

  const openProject = async (role: AccountRole) => {
    setState("projectOpen", true)
    setState("projectRoleCode", role.code)
    setState("projectQuery", "")
    await loadCatalog()
    const response = await request({ path: `/account/admin/roles/${encodeURIComponent(role.code)}/projects` }).catch(() => undefined)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      setState("projectOpen", false)
      return
    }
    const body = (await response.json().catch(() => undefined)) as RoleProjectsResponse | undefined
    const ids = body?.project_ids ?? []
    setState("projectIDs", ids)
    setState("projectBase", ids)
  }

  const closePerm = () => {
    if (state.pending) return
    setState("permOpen", false)
    setState("permRoleCode", "")
    setState("permCodes", [])
    setState("permBase", [])
    setState("permQuery", "")
  }

  const closeMember = () => {
    if (state.pending) return
    setState("memberOpen", false)
    setState("memberRoleCode", "")
    setState("memberUserIDs", [])
    setState("memberBase", [])
    setState("users", [])
    setState("memberLoading", false)
  }

  const closeProject = () => {
    if (state.pending) return
    setState("projectOpen", false)
    setState("projectRoleCode", "")
    setState("projectIDs", [])
    setState("projectBase", [])
    setState("projectQuery", "")
  }

  const savePerm = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.permRoleCode) return
    if (sameSet(state.permCodes, state.permBase)) {
      closePerm()
      return
    }
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "POST",
      path: `/account/admin/roles/${encodeURIComponent(state.permRoleCode)}/permissions`,
      body: { permission_codes: state.permCodes },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "角色权限已更新")
    closePerm()
    await load()
    await auth.reload()
  }

  const saveMember = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.memberRoleCode) return
    if (sameSet(state.memberUserIDs, state.memberBase)) {
      closeMember()
      return
    }

    const updates = state.users
      .map((item) => {
        const before = item.roles.includes(state.memberRoleCode)
        const after = state.memberUserIDs.includes(item.id)
        if (before === after) return
        return {
          id: item.id,
          role_codes: after
            ? [...new Set([...item.roles, state.memberRoleCode])]
            : item.roles.filter((code) => code !== state.memberRoleCode),
        }
      })
      .filter((item): item is { id: string; role_codes: string[] } => !!item)

    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const responses = await Promise.all(
      updates.map((item) =>
        request({
          method: "POST",
          path: `/account/admin/users/${encodeURIComponent(item.id)}/roles`,
          body: { role_codes: item.role_codes },
        }).catch(() => undefined),
      ),
    )
    setState("pending", false)
    const failed = responses.find((item) => !item?.ok)
    if (failed) {
      setState("error", await parseAccountError(failed))
      return
    }
    setState("message", "角色成员已更新")
    closeMember()
    await load()
  }

  const saveProject = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!state.projectRoleCode) return
    if (sameSet(state.projectIDs, state.projectBase)) {
      closeProject()
      return
    }
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "PUT",
      path: `/account/admin/roles/${encodeURIComponent(state.projectRoleCode)}/projects`,
      body: { project_ids: state.projectIDs },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "角色项目分配已更新")
    closeProject()
    await load()
  }

  const saveRole = async (event: SubmitEvent) => {
    event.preventDefault()
    const code = state.createCode.trim()
    const name = state.createName.trim()
    if (!code || !name) return
    setState("pending", true)
    setState("message", "")
    setState("error", "")
    const response = await request({
      method: "POST",
      path: "/account/admin/roles",
      body: {
        code,
        name,
        scope: state.createScope,
      },
    }).catch(() => undefined)
    setState("pending", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("createCode", "")
    setState("createName", "")
    setState("createScope", "system")
    setState("message", "角色已创建")
    setState("rolePage", 1)
    await load({ page: 1 })
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  return (
    <div class="w-full h-full overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <Show
        when={canRole()}
        fallback={
          <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 text-13-regular text-text-weak">
            当前账号没有角色管理权限
          </section>
        }
      >
        <section class="rounded-2xl border border-border-weak-base bg-surface-raised-base p-5 flex flex-col gap-4">
          <div class="rounded-xl border border-border-weak-base bg-surface-base p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="text-13-medium text-text-strong">项目扫描根目录（TPCODE_PROJECT_SCAN_ROOT）</div>
              <div class="text-11-regular text-text-weak">来源：{state.scanRootSource}</div>
            </div>
            <div class="flex gap-2">
              <input
                class="h-10 flex-1 min-w-0 rounded-md border border-border-weak-base bg-background-base px-3 text-14-regular"
                placeholder="请选择项目扫描根目录"
                value={state.scanRoot}
                readOnly
              />
              <Button type="button" size="small" variant="secondary" disabled={state.scanRootSaving} onClick={() => void chooseScanRoot()}>
                {state.scanRootSaving ? "保存中..." : "选择目录"}
              </Button>
              <Button type="button" size="small" variant="secondary" disabled={!state.scanRoot || state.scanRootSaving} onClick={() => void clearScanRoot()}>
                清空
              </Button>
            </div>
            <div class="text-11-regular text-text-weak">
              点击“选择目录”可在服务端目录选择器中逐级进入任意层级目录；确认后自动保存。项目分配时仅扫描所选目录下的一级子目录。
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <div class="text-18-medium text-text-strong">角色管理</div>
              <div class="text-12-regular text-text-weak mt-1">单表格管理角色权限、成员与项目分配</div>
            </div>
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
              刷新
            </Button>
          </div>

          <form class="rounded-xl border border-border-weak-base bg-surface-panel/35 p-3 grid grid-cols-1 md:grid-cols-4 gap-2" onSubmit={saveRole}>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="角色编码（如：feature_owner）"
              value={state.createCode}
              onInput={(event) => setState("createCode", event.currentTarget.value)}
            />
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="角色名称（如：功能负责人）"
              value={state.createName}
              onInput={(event) => setState("createName", event.currentTarget.value)}
            />
            <select
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              value={state.createScope}
              onChange={(event) => setState("createScope", event.currentTarget.value === "org" ? "org" : "system")}
            >
              <option value="system">系统级角色</option>
              <option value="org">组织级角色</option>
            </select>
            <Button type="submit" disabled={state.pending || !state.createCode.trim() || !state.createName.trim()}>
              {state.pending ? "提交中..." : "新增角色"}
            </Button>
          </form>

          <Show when={state.message}>
            <div class="rounded-md bg-icon-success-base/10 px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
          </Show>
          <Show when={state.error}>
            <div class="rounded-md bg-icon-critical-base/10 px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
          </Show>

          <div class="rounded-xl border border-border-weak-base bg-surface-base overflow-hidden">
            <div class="px-4 py-3 border-b border-border-weak-base text-13-medium text-text-strong flex items-center justify-between">
              <span>角色列表</span>
              <Show when={state.loading}>
                <span class="text-12-regular text-text-weak">加载中...</span>
              </Show>
            </div>
            <div class="max-h-[560px] overflow-auto">
              <table class="w-full text-12-regular">
                <thead class="bg-surface-panel">
                  <tr>
                    <th class="text-left px-3 py-2">角色编码</th>
                    <th class="text-left px-3 py-2">角色名称</th>
                    <th class="text-left px-3 py-2">权限数</th>
                    <th class="text-left px-3 py-2">成员数</th>
                    <th class="text-left px-3 py-2">项目数</th>
                    <th class="text-left px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={state.roles}>
                    {(item) => (
                      <tr class="border-t border-border-weak-base hover:bg-surface-panel/45 transition-colors">
                        <td class="px-3 py-2">{item.code}</td>
                        <td class="px-3 py-2">{item.name || roleZh(item.code)}</td>
                        <td class="px-3 py-2">{item.permissions.length}</td>
                        <td class="px-3 py-2">{roleMembersCount(item.code)}</td>
                        <td class="px-3 py-2">{roleProjectCount(item.code)}</td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-1.5">
                            <Button type="button" size="small" variant="secondary" onClick={() => openPerm(item)}>
                              权限设置
                            </Button>
                            <Show when={canMember()}>
                              <Button type="button" size="small" variant="secondary" onClick={() => void openMember(item)}>
                                成员管理
                              </Button>
                            </Show>
                            <Button type="button" size="small" variant="secondary" onClick={() => void openProject(item)}>
                              分配项目
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                  <Show when={state.roles.length === 0}>
                    <tr class="border-t border-border-weak-base">
                      <td class="px-3 py-6 text-center text-text-weak" colSpan={6}>
                        暂无角色数据
                      </td>
                    </tr>
                  </Show>
                </tbody>
              </table>
            </div>
            <div class="px-4 py-3 border-t border-border-weak-base bg-surface-panel/35 flex items-center justify-between">
              <div class="text-12-regular text-text-weak">
                第 {state.rolePage} / {rolePageTotal()} 页，共 {state.roleTotal} 条（当前 {roleRangeStart()}-{roleRangeEnd()}）
              </div>
              <div class="flex items-center gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={state.loading || state.rolePage <= 1}
                  onClick={() => void load({ page: state.rolePage - 1 })}
                >
                  上一页
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={state.loading || state.rolePage >= rolePageTotal()}
                  onClick={() => void load({ page: state.rolePage + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          </div>
        </section>
      </Show>

      <Show when={state.scanDirOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <div class="w-full max-w-3xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3">
            <div class="text-16-medium text-text-strong">选择项目扫描根目录</div>
            <div class="flex items-center gap-2">
              <Button type="button" size="small" variant="secondary" disabled={state.scanDirLoading} onClick={() => void openScanRoots()}>
                根目录
              </Button>
              <Button type="button" size="small" variant="secondary" disabled={state.scanDirLoading} onClick={() => void enterScanParent()}>
                上一级
              </Button>
              <div class="min-w-0 text-12-regular text-text-weak break-all">
                {state.scanDirCurrent || "请选择目录根节点"}
              </div>
            </div>
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.scanDirLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载目录中...</div>}>
                <For each={state.scanDirEntries}>
                  {(item) => (
                    <button
                      type="button"
                      class="w-full text-left rounded px-2 py-1.5 hover:bg-surface-panel/50"
                      onClick={() => void enterScanDir(item.path)}
                    >
                      <div class="text-12-medium text-text-strong">{item.name}</div>
                      <div class="text-11-regular text-text-weak break-all">{item.path}</div>
                    </button>
                  )}
                </For>
                <Show when={state.scanDirEntries.length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">当前目录没有子目录</div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeScanDir} disabled={state.scanDirLoading || state.scanRootSaving}>
                取消
              </Button>
              <Button type="button" disabled={!state.scanDirCurrent || state.scanDirLoading || state.scanRootSaving} onClick={() => void confirmScanDir()}>
                {state.scanRootSaving ? "保存中..." : "选择当前目录并保存"}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={state.permOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={savePerm}>
            <div class="text-16-medium text-text-strong">权限设置 · {roleTitle(state.permRoleCode)}</div>
            <div class="rounded-md border border-border-weak-base bg-surface-panel p-3 flex flex-col gap-2">
              <div class="text-12-medium text-text-strong">设置页可见性、用户供应商与智能体可用性</div>
              <For each={quickPermissions()}>
                {(item) => (
                  <label class="flex items-center gap-2 px-1 py-1 rounded hover:bg-surface-base/80">
                    <input type="checkbox" checked={state.permCodes.includes(item.code)} onChange={() => togglePerm(item.code)} />
                    <span class="text-12-regular text-text-strong">{permissionZh(item.code)}</span>
                    <span class="text-11-regular text-text-weak">{item.code}</span>
                  </label>
                )}
              </For>
            </div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="搜索权限编码或名称"
              value={state.permQuery}
              onInput={(event) => setState("permQuery", event.currentTarget.value)}
            />
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <For each={filteredPermissions()}>
                {(item) => (
                  <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                    <input type="checkbox" checked={state.permCodes.includes(item.code)} onChange={() => togglePerm(item.code)} />
                    <span class="text-12-regular text-text-strong">{permissionZh(item.code)}</span>
                    <span class="text-11-regular text-text-weak">{item.code}</span>
                  </label>
                )}
              </For>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closePerm} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.memberOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveMember}>
            <div class="text-16-medium text-text-strong">成员管理 · {roleTitle(state.memberRoleCode)}</div>
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.memberLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载成员中...</div>}>
                <For each={state.users}>
                  {(item) => (
                    <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                      <input type="checkbox" checked={state.memberUserIDs.includes(item.id)} onChange={() => toggleMember(item.id)} />
                      <span class="text-12-regular text-text-strong">{item.display_name}</span>
                      <span class="text-11-regular text-text-weak">({item.username})</span>
                    </label>
                  )}
                </For>
                <Show when={state.users.length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">暂无可选成员</div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeMember} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={state.projectOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-3xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={saveProject}>
            <div class="text-16-medium text-text-strong">分配项目 · {roleTitle(state.projectRoleCode)}</div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
              placeholder="搜索项目名称/路径"
              value={state.projectQuery}
              onInput={(event) => setState("projectQuery", event.currentTarget.value)}
            />
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <Show when={!state.projectCatalogLoading} fallback={<div class="px-2 py-3 text-12-regular text-text-weak">加载项目中...</div>}>
                <For each={projectCatalogFiltered()}>
                  {(item) => (
                    <label class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                      <input type="checkbox" checked={state.projectIDs.includes(item.id)} onChange={() => toggleProject(item.id)} />
                      <div class="min-w-0">
                        <div class="text-12-medium text-text-strong">{item.name ?? item.worktree}</div>
                        <div class="text-11-regular text-text-weak break-all">{item.worktree}</div>
                      </div>
                    </label>
                  )}
                </For>
                <Show when={projectCatalogFiltered().length === 0}>
                  <div class="px-2 py-3 text-12-regular text-text-weak">
                    未扫描到可分配项目，请检查 `TPCODE_PROJECT_SCAN_ROOT` 是否已正确选择并确认目录下存在可访问的一级子目录。
                  </div>
                </Show>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeProject} disabled={state.pending}>
                取消
              </Button>
              <Button type="submit" disabled={state.pending}>
                {state.pending ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </Show>
    </div>
  )
}
