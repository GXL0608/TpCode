import { describe, expect, test } from "bun:test"
import type { Session, Workspace } from "@opencode-ai/sdk/v2/client"
import { buildPackageDisabledReason, buildPackagePrompt, canUseBuildPackage } from "./build-package"

const batchSession = {
  id: "session_123",
  workspaceID: "workspace_123",
  workspaceKind: "batch_worktree",
  workspaceBranch: "opencode/demo-batch",
} satisfies Pick<Session, "id" | "workspaceID" | "workspaceKind" | "workspaceBranch">

const batchWorkspace = {
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
  test("enables action for build sessions across batch single and plain directories", () => {
    expect(
      canUseBuildPackage({
        agent: "build",
        session: batchSession,
        workspace: batchWorkspace,
      }),
    ).toBeTrue()
    expect(
      canUseBuildPackage({
        agent: "build",
        session: {
          id: "session_456",
          workspaceKind: "single_worktree",
          workspaceBranch: "opencode/demo-single",
        },
      }),
    ).toBeTrue()
    expect(
      canUseBuildPackage({
        agent: "build",
        session: {
          id: "session_789",
        },
      }),
    ).toBeTrue()
    expect(
      canUseBuildPackage({
        agent: "chat",
        session: batchSession,
        workspace: batchWorkspace,
      }),
    ).toBeFalse()
  })

  test("returns disabled reason only when build action truly cannot run", () => {
    expect(
      buildPackageDisabledReason({
        agent: "build",
      }),
    ).toBe("仅已有会话可用")
    expect(
      buildPackageDisabledReason({
        agent: "build",
        session: {
          id: "session_123",
          workspaceKind: "single_worktree",
          workspaceBranch: "opencode/demo-single",
        },
      }),
    ).toBe("")
  })

  test("keeps batch sessions gated until workspace member details are available", () => {
    expect(
      canUseBuildPackage({
        agent: "build",
        session: batchSession,
      }),
    ).toBeFalse()
    expect(
      buildPackageDisabledReason({
        agent: "build",
        session: batchSession,
      }),
    ).toBe("未识别到批量工作区详情")
  })

  test("builds a fixed prompt with member repos and branch constraints for batch workspaces", () => {
    const prompt = buildPackagePrompt({
      session: batchSession as Session,
      workspace: batchWorkspace as Workspace,
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

  test("builds a fixed prompt for a single git workspace", () => {
    const prompt = buildPackagePrompt({
      session: {
        id: "session_single",
        workspaceKind: "single_worktree",
        workspaceBranch: "opencode/demo-single",
      } as Session,
    })

    expect(prompt).toContain("请在当前单仓工作区内执行“编译打包”流程")
    expect(prompt).toContain("当前沙盒分支是：opencode/demo-single")
    expect(prompt).toContain("只处理当前目录这一个 Git 项目")
    expect(prompt).toContain("如果当前分支不是当前沙盒分支，先切换到该沙盒分支")
    expect(prompt).toContain("最终只推送到当前远端同名沙盒分支")
  })

  test("builds a fixed prompt for non git directories", () => {
    const prompt = buildPackagePrompt({
      session: {
        id: "session_plain",
      } as Session,
    })

    expect(prompt).toContain("请在当前项目目录执行“编译打包”流程")
    expect(prompt).toContain("当前项目可能不是 Git 仓库")
    expect(prompt).toContain("优先识别项目内现有的构建脚本、任务编排和产物目录")
    expect(prompt).not.toContain("rebase")
    expect(prompt).not.toContain("push")
  })
})
