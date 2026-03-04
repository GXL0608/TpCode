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

function list<T>(input: unknown) {
  return Array.isArray(input) ? (input as T[]) : []
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
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

  const roleMembersCount = (roleCode: string) => state.users.filter((item) => item.roles.includes(roleCode)).length
  const roleProjectCount = (roleCode: string) => (state.roleProjects[roleCode] ?? []).length

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

  const load = async () => {
    if (!canRole()) return
    setState("loading", true)
    setState("error", "")

    const rolesResponse = await request({ path: "/account/admin/roles" }).catch(() => undefined)
    const permissionsResponse = await request({ path: "/account/admin/permissions" }).catch(() => undefined)
    const scanRootResponse = await request({ path: "/account/admin/settings/project-scan-root" }).catch(() => undefined)
    const usersResponse = canMember() ? await request({ path: "/account/admin/users" }).catch(() => undefined) : undefined

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

    const roles = list<AccountRole>(await rolesResponse.json().catch(() => undefined))
    const permissions = list<AccountPermission>(await permissionsResponse.json().catch(() => undefined))
    const scanRoot = scanRootResponse?.ok
      ? ((await scanRootResponse.json().catch(() => undefined)) as { project_scan_root?: string; source?: "env" | "setting" | "default" } | undefined)
      : undefined
    const users = usersResponse?.ok ? list<AccountUser>(await usersResponse.json().catch(() => undefined)) : []

    setState("roles", roles)
    setState("permissions", permissions)
    setState("scanRoot", scanRoot?.project_scan_root ?? "")
    setState("scanRootSource", scanRoot?.source ?? "default")
    setState("users", users)
    await loadRoleProjects(roles)
    setState("loading", false)
  }

  const saveScanRoot = async (event: SubmitEvent) => {
    event.preventDefault()
    setState("scanRootSaving", true)
    setState("error", "")
    setState("message", "")
    const response = await request({
      method: "PUT",
      path: "/account/admin/settings/project-scan-root",
      body: {
        project_scan_root: state.scanRoot.trim() || undefined,
      },
    }).catch(() => undefined)
    setState("scanRootSaving", false)
    if (!response?.ok) {
      setState("error", await parseAccountError(response))
      return
    }
    setState("message", "项目扫描根目录已保存")
    await load()
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

  const openMember = (role: AccountRole) => {
    if (!canMember()) return
    const selected = state.users.filter((item) => item.roles.includes(role.code)).map((item) => item.id)
    setState("memberOpen", true)
    setState("memberRoleCode", role.code)
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
          <form class="rounded-xl border border-border-weak-base bg-surface-base p-3 flex flex-col gap-2" onSubmit={saveScanRoot}>
            <div class="flex items-center justify-between">
              <div class="text-13-medium text-text-strong">项目扫描根目录（TPCODE_PROJECT_SCAN_ROOT）</div>
              <div class="text-11-regular text-text-weak">来源：{state.scanRootSource}</div>
            </div>
            <input
              class="h-10 rounded-md border border-border-weak-base bg-background-base px-3 text-14-regular"
              placeholder="可填多个目录，逗号分隔；留空使用默认扫描路径"
              value={state.scanRoot}
              onInput={(event) => setState("scanRoot", event.currentTarget.value)}
            />
            <div class="text-11-regular text-text-weak">
              示例：`/data/repos,/srv/hospital-projects`。仅扫描一级子目录且目录内需包含 `.git`。
            </div>
            <div class="flex justify-end">
              <Button type="submit" size="small" variant="secondary" disabled={state.scanRootSaving}>
                {state.scanRootSaving ? "保存中..." : "保存扫描目录"}
              </Button>
            </div>
          </form>

          <div class="flex items-center justify-between">
            <div>
              <div class="text-18-medium text-text-strong">角色管理</div>
              <div class="text-12-regular text-text-weak mt-1">单表格管理角色权限、成员与项目分配</div>
            </div>
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={state.loading}>
              刷新
            </Button>
          </div>

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
                        <td class="px-3 py-2">{roleZh(item.code)}</td>
                        <td class="px-3 py-2">{item.permissions.length}</td>
                        <td class="px-3 py-2">{roleMembersCount(item.code)}</td>
                        <td class="px-3 py-2">{roleProjectCount(item.code)}</td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-1.5">
                            <Button type="button" size="small" variant="secondary" onClick={() => openPerm(item)}>
                              权限设置
                            </Button>
                            <Show when={canMember()}>
                              <Button type="button" size="small" variant="secondary" onClick={() => openMember(item)}>
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
          </div>
        </section>
      </Show>

      <Show when={state.permOpen}>
        <div class="fixed inset-0 z-[140] bg-black/55 backdrop-blur-sm px-4 flex items-center justify-center">
          <form class="w-full max-w-2xl rounded-xl border border-border-weak-base bg-background-base shadow-lg p-5 flex flex-col gap-3" onSubmit={savePerm}>
            <div class="text-16-medium text-text-strong">权限设置 · {roleZh(state.permRoleCode)}</div>
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
            <div class="text-16-medium text-text-strong">成员管理 · {roleZh(state.memberRoleCode)}</div>
            <div class="max-h-80 overflow-auto rounded-md border border-border-weak-base bg-surface-base p-2 flex flex-col gap-1">
              <For each={state.users}>
                {(item) => (
                  <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-panel/50">
                    <input type="checkbox" checked={state.memberUserIDs.includes(item.id)} onChange={() => toggleMember(item.id)} />
                    <span class="text-12-regular text-text-strong">{item.display_name}</span>
                    <span class="text-11-regular text-text-weak">({item.username})</span>
                  </label>
                )}
              </For>
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
            <div class="text-16-medium text-text-strong">分配项目 · {roleZh(state.projectRoleCode)}</div>
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
                    未扫描到可分配项目，请检查 `TPCODE_PROJECT_SCAN_ROOT`（支持逗号分隔多个根目录）或确认目录为一级 Git 仓库。
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
