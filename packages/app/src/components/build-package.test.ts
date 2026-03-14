import { describe, expect, test } from "bun:test"
import type { Session, Workspace } from "@opencode-ai/sdk/v2/client"
import { buildPackageDisabledReason, buildPackagePrompt, canUseBuildPackage } from "./build-package"

const session = {
  id: "session_123",
  workspaceID: "workspace_123",
  workspaceKind: "batch_worktree",
} satisfies Pick<Session, "id" | "workspaceID" | "workspaceKind">

const workspace = {
  kind: "batch_worktree",
  branch: "opencode/demo-batch",
  meta: {
    source_root: "/repo",
    members: [
      {
        name: "app",
        relative_path: "app",
        source_directory: "/repo/app",
        sandbox_directory: "/tmp/app",
        branch: "opencode/demo-batch",
        default_branch: "dev",
        status: "ready",
      },
    ],
  },
} satisfies Pick<Workspace, "kind" | "branch" | "meta">

describe("build package action", () => {
  test("enables action only for batch workspace build sessions", () => {
    expect(
      canUseBuildPackage({
        agent: "build",
        session,
        workspace,
      }),
    ).toBeTrue()
    expect(
      canUseBuildPackage({
        agent: "chat",
        session,
        workspace,
      }),
    ).toBeFalse()
  })

  test("returns disabled reason for non batch workspace", () => {
    expect(
      buildPackageDisabledReason({
        agent: "build",
        session: {
          id: "session_123",
          workspaceID: "workspace_123",
          workspaceKind: "single_worktree",
        },
      }),
    ).toBe("仅批量沙盒可用")
  })

  test("builds a fixed prompt with member repos and branch constraints", () => {
    const prompt = buildPackagePrompt({
      workspace: workspace as Workspace,
    })

    expect(prompt).toContain("只处理下面这些 Git 子项目目录")
    expect(prompt).toContain("仓库路径：app")
    expect(prompt).toContain("主分支：dev")
    expect(prompt).toContain("禁止推送到任何主分支")
    expect(prompt).toContain("必须先进入对应的仓库路径目录")
    expect(prompt).toContain("禁止在聚合根目录直接执行 git 命令")
    expect(prompt).toContain("禁止使用 GIT_DIR、GIT_WORK_TREE")
    expect(prompt).toContain("如果当前分支不是该仓库列出的沙盒分支，先切换到该沙盒分支")
    expect(prompt).toContain("worktree 目录中的 .git 可能是一个文本文件")
    expect(prompt).toContain("禁止访问父目录下的原始仓库目录")
    expect(prompt).toContain("如果 git remote -v 为空，或没有 origin 远程")
    expect(prompt).toContain("不要为了查 remote、分支或提交状态切换到原始仓库目录")
    expect(prompt).toContain("如果 git status --porcelain 为空")
    expect(prompt).toContain("立即跳过该仓库后续的 add、commit、fetch、rebase、push")
  })
})
