import type { Session, Workspace } from "@opencode-ai/sdk/v2/client"

/** 中文注释：判断当前 session 是否满足“编译打包”按钮的最小启用条件。 */
export function canUseBuildPackage(input: {
  agent?: string
  session?: Pick<Session, "id" | "workspaceID" | "workspaceKind">
  workspace?: Pick<Workspace, "kind" | "meta" | "branch">
}) {
  if (input.agent !== "build") return false
  if (!input.session?.id || !input.session.workspaceID) return false
  if (input.session.workspaceKind !== "batch_worktree") return false
  if (!input.workspace || input.workspace.kind !== "batch_worktree") return false
  return (input.workspace.meta?.members?.length ?? 0) > 0
}

/** 中文注释：为“编译打包”按钮返回简短禁用原因，便于前端直接展示 Tooltip。 */
export function buildPackageDisabledReason(input: {
  agent?: string
  session?: Pick<Session, "id" | "workspaceID" | "workspaceKind">
  workspace?: Pick<Workspace, "kind" | "meta">
}) {
  if (input.agent !== "build") return "仅 Build 模式可用"
  if (!input.session?.id) return "仅已有会话可用"
  if (!input.session.workspaceID || input.session.workspaceKind !== "batch_worktree") return "仅批量沙盒可用"
  if (!input.workspace || input.workspace.kind !== "batch_worktree") return "未识别到批量工作区"
  if ((input.workspace.meta?.members?.length ?? 0) === 0) return "未识别到可处理的 Git 子项目"
  return ""
}

/** 中文注释：生成固定的“编译打包”提示词，约束模型逐仓提交、rebase 并仅推送到同名沙盒分支。 */
export function buildPackagePrompt(input: { workspace: Workspace }) {
  const branch = input.workspace.branch ?? ""
  const members = input.workspace.meta?.members ?? []
  const lines = members.map((member) => {
    const defaultBranch = member.default_branch?.trim() || "未识别"
    return `- 仓库路径：${member.relative_path}；当前沙盒分支：${member.branch}；主分支：${defaultBranch}`
  })

  return [
    "请在当前批量沙盒工作区内执行“编译打包”流程，并严格遵守以下要求：",
    "",
    "1. 只处理下面这些 Git 子项目目录，不要处理聚合根目录顶层非 git 文件：",
    ...lines,
    "",
    "2. 对每个 Git 子项目都必须先进入对应的仓库路径目录，再执行后续步骤：",
    "   - 必须先 cd 到该仓库路径目录后，再执行任何 git 命令",
    "   - 禁止在聚合根目录直接执行 git 命令",
    "   - 禁止访问父目录下的原始仓库目录，也不要 cd 到原始仓库目录执行 git 命令",
    "   - 禁止使用 GIT_DIR、GIT_WORK_TREE、--git-dir、--work-tree 这类方式绕过当前 worktree 目录",
    "   - worktree 目录中的 .git 可能是一个文本文件，这属于正常现象，不代表它不是 git 仓库",
    "   - 进入仓库目录后，只能使用普通 git 命令检查和操作当前 worktree",
    "",
    "3. 对每个有改动的 Git 子项目分别执行：",
    "   - 先用 git status --porcelain 检查工作区状态",
    "   - 如果 git status --porcelain 为空，说明该仓库没有改动，立即跳过该仓库后续的 add、commit、fetch、rebase、push，并明确说明跳过原因",
    "   - 先确认当前分支；如果当前分支不是该仓库列出的沙盒分支，先切换到该沙盒分支",
    "   - 先提交当前本地改动",
    "   - commit message 必须根据实际改动内容生成，且必须使用简体中文",
    "   - 先检查 git remote -v",
    "   - 如果 git remote -v 为空，或没有 origin 远程，直接说明该仓库无远程，停止 fetch 和 push，不要猜测远程地址",
    "   - 如果存在 origin 远程，先同步该仓库主分支最新代码",
    "   - 如果存在 origin 远程，就把当前沙盒分支 rebase 到最新 origin/主分支之上；如果不存在 origin 远程，但本地主分支存在，就只 rebase 到本地主分支",
    "   - 最终只推送到该仓库远程同名沙盒分支",
    "   - 不要为了查 remote、分支或提交状态切换到原始仓库目录",
    "",
    "4. 如果某个仓库没有改动，只能输出跳过结果，不要继续执行该仓库的 git 写操作。",
    "5. 如果某个仓库无法识别主分支、无法识别当前分支，或目标推送分支不是当前沙盒分支，必须停止该仓库处理并说明原因，不要猜测。",
    `6. 当前这批沙盒分支名称是：${branch || "未识别"}。禁止推送到任何主分支，例如 main、master、dev 或对应远端默认分支。`,
    "7. 完成后按仓库输出结果摘要：仓库路径、主分支、沙盒分支、是否提交成功、是否 rebase 成功、是否 push 成功。",
  ].join("\n")
}
