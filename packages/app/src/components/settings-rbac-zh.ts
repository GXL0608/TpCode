export type AccountUser = {
  id: string
  username: string
  display_name: string
  email?: string
  phone?: string
  status: string
  account_type: string
  org_id: string
  department_id?: string
  customer_id?: string
  customer_name?: string
  customer_department_id?: string
  customer_department_name?: string
  force_password_reset?: boolean
  roles: string[]
  permissions?: string[]
}

export type AccountRole = {
  id: string
  code: string
  name: string
  permissions: string[]
  member_count?: number
}

export type AccountPermission = {
  id: string
  code: string
  name: string
  group_name: string
}

const roleTextMap: Record<string, string> = {
  super_admin: "超级管理员",
  dev_lead: "研发负责人",
  developer: "研发工程师",
  ops: "运维工程师",
  pm: "项目经理",
  value_ops: "价值运营",
  hospital_admin: "医院管理员",
  dept_director: "科室主任",
  hospital_user: "医院用户",
  dean: "院长",
}

const permissionTextMap: Record<string, string> = {
  "user:manage": "用户管理",
  "org:manage": "组织管理",
  "role:manage": "角色管理",
  "session:create": "创建会话",
  "session:view_own": "查看本人会话",
  "session:view_dept": "查看本科室会话",
  "session:view_org": "查看本机构会话",
  "session:view_all": "查看全部会话",
  "session:update_any": "管理全部会话",
  "code:generate": "生成代码",
  "code:review": "代码审查",
  "code:deploy": "部署代码",
  "prototype:view": "查看原型",
  "prototype:approve": "审批原型",
  "file:browse": "浏览文件",
  "agent:use_docs": "使用 Docs 智能体",
  "agent:use_build": "使用 Build 智能体",
  "agent:use_plan": "使用 Plan 智能体",
  "provider:config_global": "配置全局模型密钥",
  "provider:config_user": "配置用户模型密钥",
  "ui:settings.providers:view": "查看供应商设置页",
  "ui:settings.models:view": "查看模型设置页",
  "audit:view": "查看审计日志",
  "feedback:create": "提交反馈",
  "feedback:reply": "回复反馈",
  "feedback:resolve": "处理反馈",
  "feedback:manage": "管理反馈",
}

export function accountTypeZh(value?: string) {
  if (value === "internal") return "内部账号"
  if (value === "hospital") return "医院账号"
  if (value === "partner") return "合作方账号"
  return value ?? "-"
}

export function statusZh(value?: string) {
  if (value === "active") return "启用"
  if (value === "inactive") return "禁用"
  return value ?? "-"
}

export function roleZh(code?: string) {
  if (!code) return "-"
  return roleTextMap[code] ?? code
}

export function permissionZh(code?: string) {
  if (!code) return "-"
  return permissionTextMap[code] ?? code
}
