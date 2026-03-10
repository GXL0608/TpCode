import { Button } from "@opencode-ai/ui/button"
import { A } from "@solidjs/router"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useAccountAuth } from "@/context/account-auth"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { AccountToken } from "@/utils/account-auth"
import { passwordError, passwordRule, phoneError, phoneRule } from "@/utils/account-rule"

type Org = {
  id: string
  name: string
  code: string
  org_type: string
  status: string
}

type Department = {
  id: string
  org_id: string
  name: string
  code?: string
  status: string
}

type User = {
  id: string
  username: string
  display_name: string
  phone?: string
  vho_user_id?: string
  account_type: string
  org_id: string
  department_id?: string
  customer_id?: string
  customer_name?: string
  customer_department_id?: string
  customer_department_name?: string
  status: string
  roles: string[]
}

type Project = {
  id: string
  name?: string
  worktree: string
  vcs?: string
}

type Role = {
  id: string
  code: string
  name: string
  permissions: string[]
}

type Permission = {
  id: string
  code: string
  group_name: string
}

type Audit = {
  id: string
  actor_user_id?: string
  action: string
  result: string
  time_created: number
}

type RoleAccess = {
  project_id: string
  role_id: string
  role_code?: string
  role_name?: string
  time_created: number
}

type UserAccess = {
  project_id: string
  user_id: string
  username?: string
  display_name?: string
  mode: "allow" | "deny"
  time_created: number
}

type VhoBind = {
  user_id: string
  username: string
  display_name: string
  phone?: string
  vho_user_id?: string
  bound: boolean
}

function json<T>(input: unknown): T | undefined {
  if (!input || typeof input !== "object") return
  return input as T
}

function orgTypeText(value: string) {
  if (value === "internal") return "内部组织"
  if (value === "hospital") return "医院组织"
  if (value === "partner") return "合作方"
  return value
}

function accountTypeText(value: string) {
  if (value === "internal") return "内部账号"
  if (value === "hospital") return "医院账号"
  if (value === "partner") return "合作方账号"
  return value
}

function statusText(value: string) {
  if (value === "active") return "启用"
  if (value === "disabled") return "禁用"
  if (value === "pending") return "待处理"
  return value
}

function auditResult(value: string) {
  if (value === "success") return "成功"
  if (value === "failed") return "失败"
  if (value === "blocked") return "阻断"
  return value
}

export default function AccountAdmin() {
  const auth = useAccountAuth()
  const server = useServer()
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  const [state, setState] = createStore({
    loading: false,
    pending: false,
    message: "",
    error: "",
    organizations: [] as Org[],
    departments: [] as Department[],
    users: [] as User[],
    roles: [] as Role[],
    permissions: [] as Permission[],
    audits: [] as Audit[],
    projects: [] as Project[],
    roleAccess: [] as RoleAccess[],
    userAccess: [] as UserAccess[],
    vhoBinds: [] as VhoBind[],
    globalProviders: {} as Record<string, { type: string }>,
  })

  const [orgName, setOrgName] = createSignal("")
  const [orgCode, setOrgCode] = createSignal("")
  const [orgType, setOrgType] = createSignal<"internal" | "hospital" | "partner">("hospital")
  const [departmentOrgID, setDepartmentOrgID] = createSignal("")
  const [departmentName, setDepartmentName] = createSignal("")
  const [departmentCode, setDepartmentCode] = createSignal("")
  const [userUsername, setUserUsername] = createSignal("")
  const [userPassword, setUserPassword] = createSignal("")
  const [userDisplayName, setUserDisplayName] = createSignal("")
  const [userPhone, setUserPhone] = createSignal("")
  const [userType, setUserType] = createSignal<"internal" | "hospital" | "partner">("hospital")
  const [userOrgID, setUserOrgID] = createSignal("")
  const [userDepartmentID, setUserDepartmentID] = createSignal("")
  const [userRoleCodes, setUserRoleCodes] = createSignal("")
  const [targetUserID, setTargetUserID] = createSignal("")
  const [targetUserRoleCodes, setTargetUserRoleCodes] = createSignal("")
  const [targetRoleCode, setTargetRoleCode] = createSignal("")
  const [targetPermissionCodes, setTargetPermissionCodes] = createSignal("")
  const [globalProviderID, setGlobalProviderID] = createSignal("openai")
  const [globalProviderKey, setGlobalProviderKey] = createSignal("")
  const [globalModel, setGlobalModel] = createSignal("")
  const [globalSmallModel, setGlobalSmallModel] = createSignal("")
  const [globalEnabledProviders, setGlobalEnabledProviders] = createSignal("")
  const [globalDisabledProviders, setGlobalDisabledProviders] = createSignal("")
  const [globalProviderConfigText, setGlobalProviderConfigText] = createSignal("{}")
  const [roleAccessProjectID, setRoleAccessProjectID] = createSignal("")
  const [roleAccessCodes, setRoleAccessCodes] = createSignal("")
  const [userAccessProjectID, setUserAccessProjectID] = createSignal("")
  const [userAccessUserID, setUserAccessUserID] = createSignal("")
  const [userAccessMode, setUserAccessMode] = createSignal<"allow" | "deny" | "remove">("allow")
  const [vhoKeyword, setVhoKeyword] = createSignal("")
  const [vhoBindUserID, setVhoBindUserID] = createSignal("")
  const [vhoBindPhone, setVhoBindPhone] = createSignal("")
  const [vhoBindVhoUserID, setVhoBindVhoUserID] = createSignal("")

  const canOrg = createMemo(() => auth.has("org:manage"))
  const canUser = createMemo(() => auth.has("user:manage"))
  const canRole = createMemo(() => auth.has("role:manage"))
  const canAudit = createMemo(() => auth.has("audit:view"))
  const canProviderGlobal = createMemo(() => (auth.user()?.roles ?? []).includes("super_admin"))
  const canAdmin = createMemo(
    () => canOrg() || canUser() || canRole() || canAudit() || canProviderGlobal(),
  )
  const roleAccessRows = createMemo(() =>
    roleAccessProjectID() ? state.roleAccess.filter((item) => item.project_id === roleAccessProjectID()) : state.roleAccess,
  )
  const userAccessRows = createMemo(() =>
    userAccessProjectID() ? state.userAccess.filter((item) => item.project_id === userAccessProjectID()) : state.userAccess,
  )
  const userPasswordIssue = createMemo(() => passwordError(userPassword()))
  const userPhoneIssue = createMemo(() => phoneError(userPhone()))

  const request = async (input: { path: string; method?: string; body?: Record<string, unknown> }) => {
    const current = server.current
    if (!current) return
    const endpoint = new URL(input.path, current.http.url).toString()
    const headers = new Headers()
    const token = AccountToken.access()
    if (token) headers.set("authorization", `Bearer ${token}`)
    if (input.body) headers.set("content-type", "application/json")
    const response = await fetcher(endpoint, {
      method: input.method ?? "GET",
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
    if (response.status !== 401 || !token) return response
    const next = await AccountToken.refreshIfNeeded({
      baseUrl: current.http.url,
      fetcher,
    })
    if (!next) {
      AccountToken.handleUnauthorized()
      return response
    }
    const retry = new Headers(headers)
    retry.set("authorization", `Bearer ${next}`)
    return fetcher(endpoint, {
      method: input.method ?? "GET",
      headers: retry,
      body: input.body ? JSON.stringify(input.body) : undefined,
    })
  }

  const load = async () => {
    if (!canAdmin()) return
    setState("loading", true)
    setState("error", "")
    const jobs: Array<Promise<void>> = []

    if (canOrg()) {
      jobs.push(
        request({ path: "/account/admin/organizations" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Org[]>(await response.json().catch(() => undefined))
          setState("organizations", items ?? [])
        }),
      )
      jobs.push(
        request({ path: "/account/admin/departments" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Department[]>(await response.json().catch(() => undefined))
          setState("departments", items ?? [])
        }),
      )
    }
    if (canUser()) {
      jobs.push(
        request({ path: "/account/admin/users" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<User[]>(await response.json().catch(() => undefined))
          setState("users", items ?? [])
        }),
      )
      jobs.push(
        request({ path: "/account/admin/project-access/user" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<UserAccess[]>(await response.json().catch(() => undefined))
          setState("userAccess", items ?? [])
        }),
      )
      jobs.push(
        request({ path: "/account/admin/vho-bind" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<VhoBind[]>(await response.json().catch(() => undefined))
          setState("vhoBinds", items ?? [])
        }),
      )
    }
    if (canRole()) {
      jobs.push(
        request({ path: "/account/admin/roles" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Role[]>(await response.json().catch(() => undefined))
          setState("roles", items ?? [])
        }),
      )
      jobs.push(
        request({ path: "/account/admin/permissions" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Permission[]>(await response.json().catch(() => undefined))
          setState("permissions", items ?? [])
        }),
      )
      jobs.push(
        request({ path: "/account/admin/project-access/role" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<RoleAccess[]>(await response.json().catch(() => undefined))
          setState("roleAccess", items ?? [])
        }),
      )
    }
    if (canRole()) {
      jobs.push(
        request({ path: "/account/admin/projects/catalog?source=scanned" }).then(async (response) => {
          if (!response?.ok) return
          const payload = json<Project[]>(await response.json().catch(() => undefined))
          setState("projects", payload ?? [])
        }),
      )
    }
    if (canAudit()) {
      jobs.push(
        request({ path: "/account/admin/audit?limit=100" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Audit[]>(await response.json().catch(() => undefined))
          setState("audits", items ?? [])
        }),
      )
    }
    if (canProviderGlobal()) {
      jobs.push(
        request({ path: "/account/admin/provider/global" }).then(async (response) => {
          if (!response?.ok) return
          const items = json<Record<string, { type: string }>>(await response.json().catch(() => undefined))
          setState("globalProviders", items ?? {})
        }),
      )
      jobs.push(
        request({ path: "/account/admin/provider-control/global" }).then(async (response) => {
          if (!response?.ok) return
          const body = json<{
            model?: string
            small_model?: string
            enabled_providers?: string[]
            disabled_providers?: string[]
          }>(await response.json().catch(() => undefined))
          setGlobalModel(body?.model ?? "")
          setGlobalSmallModel(body?.small_model ?? "")
          setGlobalEnabledProviders((body?.enabled_providers ?? []).join(", "))
          setGlobalDisabledProviders((body?.disabled_providers ?? []).join(", "))
        }),
      )
    }

    await Promise.all(jobs)
    setState("loading", false)
    if (!departmentOrgID() && state.organizations[0]?.id) setDepartmentOrgID(state.organizations[0].id)
    if (!userOrgID() && state.organizations[0]?.id) setUserOrgID(state.organizations[0].id)
    if (!targetRoleCode() && state.roles[0]?.code) setTargetRoleCode(state.roles[0].code)
    if (!roleAccessProjectID() && state.projects[0]?.id) setRoleAccessProjectID(state.projects[0].id)
    if (!userAccessProjectID() && state.projects[0]?.id) setUserAccessProjectID(state.projects[0].id)
    if (!userAccessUserID() && state.users[0]?.id) setUserAccessUserID(state.users[0].id)
    if (!vhoBindUserID() && state.vhoBinds[0]?.user_id) {
      const item = state.vhoBinds[0]
      setVhoBindUserID(item.user_id)
      setVhoBindPhone(item.phone ?? "")
      setVhoBindVhoUserID(item.vho_user_id ?? "")
    }
  }

  const done = (message: string) => {
    setState("pending", false)
    setState("error", "")
    setState("message", message)
    void load()
  }

  const fail = (message: string) => {
    setState("pending", false)
    setState("message", "")
    setState("error", message)
  }

  createEffect(() => {
    if (!auth.ready()) return
    if (!auth.authenticated()) return
    void load()
  })

  createEffect(() => {
    if (!auth.ready() || !auth.authenticated() || !canProviderGlobal()) return
    const providerID = globalProviderID().trim()
    if (!providerID) {
      setGlobalProviderConfigText("{}")
      return
    }
    void request({
      path: `/account/admin/providers/${encodeURIComponent(providerID)}/config/global`,
    }).then(async (response) => {
      if (!response?.ok) return
      const body = json<{ config?: unknown }>(await response.json().catch(() => undefined))
      setGlobalProviderConfigText(body?.config ? JSON.stringify(body.config, null, 2) : "{}")
    })
  })

  const parseList = (input: string) =>
    input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

  return (
    <div class="min-h-screen w-full px-4 py-6">
      <div class="mx-auto w-full max-w-6xl flex flex-col gap-4">
        <div class="rounded-xl bg-surface-raised-base p-4 flex items-center justify-between">
          <div>
            <div class="text-20-medium text-text-strong">TpCode 账号管理台</div>
            <div class="text-12-regular text-text-weak">组织 / 部门 / 用户 / 角色权限 / 项目分配 / VHO绑定</div>
          </div>
          <div class="flex items-center gap-2 text-12-regular">
            <A href="/settings/security" class="hover:text-text-strong">
              账号安全
            </A>
            <A href="/approval" class="hover:text-text-strong">
              审批流
            </A>
            <A href="/" class="hover:text-text-strong">
              返回
            </A>
          </div>
        </div>

        <Show when={state.message}>
          <div class="rounded-md bg-surface-panel px-3 py-2 text-12-regular text-icon-success-base">{state.message}</div>
        </Show>
        <Show when={state.error}>
          <div class="rounded-md bg-surface-panel px-3 py-2 text-12-regular text-icon-critical-base">{state.error}</div>
        </Show>
        <Show when={!canAdmin()}>
          <div class="rounded-xl bg-surface-raised-base p-4 text-14-regular text-text-weak">
            当前账号无管理权限。
          </div>
        </Show>
        <Show when={canAdmin()}>
          <Show when={state.loading}>
            <div class="rounded-xl bg-surface-raised-base p-4 text-12-regular text-text-weak">加载中...</div>
          </Show>

          <Show when={canOrg()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">组织管理</div>
              <form
                class="grid grid-cols-1 md:grid-cols-4 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/organizations",
                    method: "POST",
                    body: {
                      name: orgName().trim(),
                      code: orgCode().trim(),
                      org_type: orgType(),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("创建组织失败")
                    setOrgName("")
                    setOrgCode("")
                    done("组织已创建")
                  })
                }}
              >
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="组织名称"
                  value={orgName()}
                  onInput={(event) => setOrgName(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="组织编码"
                  value={orgCode()}
                  onInput={(event) => setOrgCode(event.currentTarget.value)}
                />
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={orgType()}
                  onChange={(event) => setOrgType(event.currentTarget.value as "internal" | "hospital" | "partner")}
                >
                  <option value="internal">内部组织</option>
                  <option value="hospital">医院组织</option>
                  <option value="partner">合作方</option>
                </select>
                <Button type="submit" disabled={state.pending || !orgName().trim() || !orgCode().trim()}>
                  创建
                </Button>
              </form>
              <div class="max-h-60 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">编号</th>
                      <th class="text-left px-2 py-1">名称</th>
                      <th class="text-left px-2 py-1">编码</th>
                      <th class="text-left px-2 py-1">类型</th>
                      <th class="text-left px-2 py-1">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.organizations}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.id}</td>
                          <td class="px-2 py-1">{item.name}</td>
                          <td class="px-2 py-1">{item.code}</td>
                          <td class="px-2 py-1">{orgTypeText(item.org_type)}</td>
                          <td class="px-2 py-1">{statusText(item.status)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canOrg()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">科室/部门管理</div>
              <form
                class="grid grid-cols-1 md:grid-cols-4 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/departments",
                    method: "POST",
                    body: {
                      org_id: departmentOrgID(),
                      name: departmentName().trim(),
                      code: departmentCode().trim() || undefined,
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("创建科室/部门失败")
                    setDepartmentName("")
                    setDepartmentCode("")
                    done("科室/部门已创建")
                  })
                }}
              >
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={departmentOrgID()}
                  onChange={(event) => setDepartmentOrgID(event.currentTarget.value)}
                >
                  <For each={state.organizations}>{(item) => <option value={item.id}>{item.name}</option>}</For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="科室/部门名称"
                  value={departmentName()}
                  onInput={(event) => setDepartmentName(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="科室/部门编码"
                  value={departmentCode()}
                  onInput={(event) => setDepartmentCode(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending || !departmentOrgID() || !departmentName().trim()}>
                  创建
                </Button>
              </form>
              <div class="max-h-60 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">编号</th>
                      <th class="text-left px-2 py-1">组织</th>
                      <th class="text-left px-2 py-1">名称</th>
                      <th class="text-left px-2 py-1">编码</th>
                      <th class="text-left px-2 py-1">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.departments}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.id}</td>
                          <td class="px-2 py-1">{item.org_id}</td>
                          <td class="px-2 py-1">{item.name}</td>
                          <td class="px-2 py-1">{item.code ?? "-"}</td>
                          <td class="px-2 py-1">{statusText(item.status)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canUser()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">用户管理</div>
              <form
                class="grid grid-cols-1 md:grid-cols-3 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/users",
                    method: "POST",
                    body: {
                      username: userUsername().trim(),
                      password: userPassword(),
                      display_name: userDisplayName().trim() || undefined,
                      phone: userPhone().trim(),
                      account_type: userType(),
                      org_id: userOrgID(),
                      department_id: userDepartmentID().trim() || undefined,
                      role_codes: userRoleCodes()
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("创建用户失败")
                    setUserUsername("")
                    setUserPassword("")
                    setUserDisplayName("")
                    setUserPhone("")
                    setUserDepartmentID("")
                    setUserRoleCodes("")
                    done("用户已创建")
                  })
                }}
              >
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="用户名"
                  value={userUsername()}
                  onInput={(event) => setUserUsername(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="初始密码"
                  type="password"
                  value={userPassword()}
                  onInput={(event) => setUserPassword(event.currentTarget.value)}
                />
                <Show when={userPassword()}>
                  <div class={`md:col-span-3 text-12-regular ${userPasswordIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
                    {userPasswordIssue() || "密码格式正确"}
                  </div>
                </Show>
                <Show when={!userPassword()}>
                  <div class="md:col-span-3 text-12-regular text-text-weak">{passwordRule}</div>
                </Show>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="显示名称"
                  value={userDisplayName()}
                  onInput={(event) => setUserDisplayName(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="手机号"
                  value={userPhone()}
                  onInput={(event) => setUserPhone(event.currentTarget.value)}
                />
                <Show when={userPhone()}>
                  <div class={`md:col-span-3 text-12-regular ${userPhoneIssue() ? "text-icon-critical-base" : "text-icon-success-base"}`}>
                    {userPhoneIssue() || "手机号格式正确"}
                  </div>
                </Show>
                <Show when={!userPhone()}>
                  <div class="md:col-span-3 text-12-regular text-text-weak">{phoneRule}</div>
                </Show>
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={userType()}
                  onChange={(event) => setUserType(event.currentTarget.value as "internal" | "hospital" | "partner")}
                >
                  <option value="internal">内部账号</option>
                  <option value="hospital">医院账号</option>
                  <option value="partner">合作方账号</option>
                </select>
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={userOrgID()}
                  onChange={(event) => setUserOrgID(event.currentTarget.value)}
                >
                  <For each={state.organizations}>{(item) => <option value={item.id}>{item.name}</option>}</For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="科室/部门编号（可选）"
                  value={userDepartmentID()}
                  onInput={(event) => setUserDepartmentID(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular md:col-span-2"
                  placeholder="角色编码（逗号分隔）"
                  value={userRoleCodes()}
                  onInput={(event) => setUserRoleCodes(event.currentTarget.value)}
                />
                <Button
                  type="submit"
                  disabled={
                    state.pending ||
                    !userUsername().trim() ||
                    !userPassword() ||
                    !!userPasswordIssue() ||
                    !userPhone().trim() ||
                    !!userPhoneIssue() ||
                    !userOrgID()
                  }
                >
                  创建
                </Button>
              </form>
              <div class="max-h-72 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">编号</th>
                      <th class="text-left px-2 py-1">用户名</th>
                      <th class="text-left px-2 py-1">显示名</th>
                      <th class="text-left px-2 py-1">客户</th>
                      <th class="text-left px-2 py-1">部门</th>
                      <th class="text-left px-2 py-1">手机号</th>
                      <th class="text-left px-2 py-1">VHO ID</th>
                      <th class="text-left px-2 py-1">账号类型</th>
                      <th class="text-left px-2 py-1">组织</th>
                      <th class="text-left px-2 py-1">角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.users}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.id}</td>
                          <td class="px-2 py-1">{item.username}</td>
                          <td class="px-2 py-1">{item.display_name}</td>
                          <td class="px-2 py-1">{item.customer_name ?? "-"}</td>
                          <td class="px-2 py-1">{item.customer_department_name ?? "-"}</td>
                          <td class="px-2 py-1">{item.phone ?? "-"}</td>
                          <td class="px-2 py-1">{item.vho_user_id ?? "-"}</td>
                          <td class="px-2 py-1">{accountTypeText(item.account_type)}</td>
                          <td class="px-2 py-1">{item.org_id}</td>
                          <td class="px-2 py-1">{item.roles.join(", ")}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canRole()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">角色与权限绑定</div>
              <form
                class="grid grid-cols-1 md:grid-cols-3 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: `/account/admin/users/${encodeURIComponent(targetUserID().trim())}/roles`,
                    method: "POST",
                    body: {
                      role_codes: targetUserRoleCodes()
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("更新用户角色失败")
                    done("用户角色已更新")
                  })
                }}
              >
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="用户编号"
                  value={targetUserID()}
                  onInput={(event) => setTargetUserID(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular md:col-span-2"
                  placeholder="角色编码（逗号分隔）"
                  value={targetUserRoleCodes()}
                  onInput={(event) => setTargetUserRoleCodes(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending || !targetUserID().trim()}>
                  更新用户角色
                </Button>
              </form>

              <form
                class="grid grid-cols-1 md:grid-cols-3 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: `/account/admin/roles/${encodeURIComponent(targetRoleCode())}/permissions`,
                    method: "POST",
                    body: {
                      permission_codes: targetPermissionCodes()
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("更新角色权限失败")
                    done("角色权限已更新")
                  })
                }}
              >
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={targetRoleCode()}
                  onChange={(event) => setTargetRoleCode(event.currentTarget.value)}
                >
                  <For each={state.roles}>{(item) => <option value={item.code}>{item.code}</option>}</For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular md:col-span-2"
                  placeholder="权限编码（逗号分隔）"
                  value={targetPermissionCodes()}
                  onInput={(event) => setTargetPermissionCodes(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending || !targetRoleCode()}>
                  更新角色权限
                </Button>
              </form>

              <div class="max-h-72 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">角色</th>
                      <th class="text-left px-2 py-1">权限</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.roles}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.code}</td>
                          <td class="px-2 py-1">{item.permissions.join(", ")}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canRole()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">项目分配管理（角色分配）</div>
              <form
                class="grid grid-cols-1 md:grid-cols-3 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/project-access/role",
                    method: "POST",
                    body: {
                      project_id: roleAccessProjectID(),
                      role_codes: roleAccessCodes()
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("保存角色项目分配失败")
                    done("角色项目分配已更新")
                  })
                }}
              >
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={roleAccessProjectID()}
                  onChange={(event) => setRoleAccessProjectID(event.currentTarget.value)}
                >
                  <For each={state.projects}>
                    {(item) => <option value={item.id}>{item.name ?? item.worktree}</option>}
                  </For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular md:col-span-2"
                  placeholder="角色编码（逗号分隔）"
                  value={roleAccessCodes()}
                  onInput={(event) => setRoleAccessCodes(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending || !roleAccessProjectID()}>
                  保存角色分配
                </Button>
              </form>
              <div class="max-h-64 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">项目</th>
                      <th class="text-left px-2 py-1">角色编码</th>
                      <th class="text-left px-2 py-1">角色名称</th>
                      <th class="text-left px-2 py-1">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={roleAccessRows()}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.project_id}</td>
                          <td class="px-2 py-1">{item.role_code ?? item.role_id}</td>
                          <td class="px-2 py-1">{item.role_name ?? "-"}</td>
                          <td class="px-2 py-1">{new Date(item.time_created).toLocaleString()}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canUser()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">项目分配管理（用户覆盖）</div>
              <form
                class="grid grid-cols-1 md:grid-cols-4 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/project-access/user",
                    method: "POST",
                    body: {
                      project_id: userAccessProjectID(),
                      user_id: userAccessUserID(),
                      mode: userAccessMode(),
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("保存用户项目覆盖失败")
                    done("用户项目覆盖已更新")
                  })
                }}
              >
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={userAccessProjectID()}
                  onChange={(event) => setUserAccessProjectID(event.currentTarget.value)}
                >
                  <For each={state.projects}>
                    {(item) => <option value={item.id}>{item.name ?? item.worktree}</option>}
                  </For>
                </select>
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={userAccessUserID()}
                  onChange={(event) => setUserAccessUserID(event.currentTarget.value)}
                >
                  <For each={state.users}>
                    {(item) => <option value={item.id}>{item.display_name} ({item.username})</option>}
                  </For>
                </select>
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={userAccessMode()}
                  onChange={(event) => setUserAccessMode(event.currentTarget.value as "allow" | "deny" | "remove")}
                >
                  <option value="allow">allow（允许）</option>
                  <option value="deny">deny（拒绝）</option>
                  <option value="remove">remove（删除覆盖）</option>
                </select>
                <Button type="submit" disabled={state.pending || !userAccessProjectID() || !userAccessUserID()}>
                  保存用户覆盖
                </Button>
              </form>
              <div class="max-h-64 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">项目</th>
                      <th class="text-left px-2 py-1">用户</th>
                      <th class="text-left px-2 py-1">模式</th>
                      <th class="text-left px-2 py-1">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={userAccessRows()}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.project_id}</td>
                          <td class="px-2 py-1">{item.display_name || item.username || item.user_id}</td>
                          <td class="px-2 py-1">{item.mode}</td>
                          <td class="px-2 py-1">{new Date(item.time_created).toLocaleString()}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canUser()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">VHO 绑定管理</div>
              <form
                class="grid grid-cols-1 md:grid-cols-3 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  const query = vhoKeyword().trim()
                  const path = query
                    ? `/account/admin/vho-bind?keyword=${encodeURIComponent(query)}`
                    : "/account/admin/vho-bind"
                  void request({ path }).then(async (response) => {
                    if (!response?.ok) return fail("查询 VHO 绑定失败")
                    const items = json<VhoBind[]>(await response.json().catch(() => undefined))
                    setState("pending", false)
                    setState("error", "")
                    setState("message", "VHO 绑定列表已刷新")
                    setState("vhoBinds", items ?? [])
                  })
                }}
              >
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular md:col-span-2"
                  placeholder="按用户名/显示名关键字过滤（可选）"
                  value={vhoKeyword()}
                  onInput={(event) => setVhoKeyword(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending}>
                  查询绑定列表
                </Button>
              </form>

              <form
                class="grid grid-cols-1 md:grid-cols-4 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (state.pending) return
                  setState("pending", true)
                  void request({
                    path: "/account/admin/vho-bind",
                    method: "POST",
                    body: {
                      user_id: vhoBindUserID(),
                      phone: vhoBindPhone().trim() || undefined,
                      vho_user_id: vhoBindVhoUserID().trim() || undefined,
                    },
                  }).then((response) => {
                    if (!response?.ok) return fail("保存 VHO 绑定失败")
                    done("VHO 绑定已更新")
                  })
                }}
              >
                <select
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  value={vhoBindUserID()}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setVhoBindUserID(value)
                    const item = state.vhoBinds.find((row) => row.user_id === value)
                    setVhoBindPhone(item?.phone ?? "")
                    setVhoBindVhoUserID(item?.vho_user_id ?? "")
                  }}
                >
                  <For each={state.vhoBinds}>
                    {(item) => (
                      <option value={item.user_id}>
                        {item.display_name} ({item.username})
                      </option>
                    )}
                  </For>
                </select>
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="手机号"
                  value={vhoBindPhone()}
                  onInput={(event) => setVhoBindPhone(event.currentTarget.value)}
                />
                <input
                  class="h-10 rounded-md border border-border-weak-base bg-surface-base px-3 text-14-regular"
                  placeholder="vho_user_id（留空表示解绑）"
                  value={vhoBindVhoUserID()}
                  onInput={(event) => setVhoBindVhoUserID(event.currentTarget.value)}
                />
                <Button type="submit" disabled={state.pending || !vhoBindUserID()}>
                  保存绑定
                </Button>
              </form>
              <div class="max-h-64 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">用户</th>
                      <th class="text-left px-2 py-1">手机号</th>
                      <th class="text-left px-2 py-1">VHO ID</th>
                      <th class="text-left px-2 py-1">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.vhoBinds}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{item.display_name} ({item.username})</td>
                          <td class="px-2 py-1">{item.phone ?? "-"}</td>
                          <td class="px-2 py-1">{item.vho_user_id ?? "-"}</td>
                          <td class="px-2 py-1">{item.bound ? "已绑定" : "未绑定"}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>

          <Show when={canProviderGlobal()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">全局模型配置入口已调整</div>
              <div class="rounded-md border border-border-weak-base bg-surface-base p-4 text-13-regular text-text-weak">
                全局供应商、模型、默认项和 provider config 现在统一在“设置 / 提供商”页面维护。
                <div class="mt-2 text-12-regular text-text-weak">
                  用户级/个人供应商配置入口已停用，不再支持按用户单独配置模型与提供商。
                </div>
              </div>
            </section>
          </Show>

          <Show when={canAudit()}>
            <section class="rounded-xl bg-surface-raised-base p-4 flex flex-col gap-3">
              <div class="text-16-medium text-text-strong">审计日志</div>
              <div class="max-h-72 overflow-auto rounded-md border border-border-weak-base">
                <table class="w-full text-12-regular">
                  <thead class="bg-surface-panel">
                    <tr>
                      <th class="text-left px-2 py-1">时间</th>
                      <th class="text-left px-2 py-1">操作者</th>
                      <th class="text-left px-2 py-1">动作</th>
                      <th class="text-left px-2 py-1">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={state.audits}>
                      {(item) => (
                        <tr class="border-t border-border-weak-base">
                          <td class="px-2 py-1">{new Date(item.time_created).toLocaleString()}</td>
                          <td class="px-2 py-1">{item.actor_user_id ?? "-"}</td>
                          <td class="px-2 py-1">{item.action}</td>
                          <td class="px-2 py-1">{auditResult(item.result)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </section>
          </Show>
        </Show>
      </div>
    </div>
  )
}
