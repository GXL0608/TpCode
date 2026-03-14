import { describe, expect, test } from "bun:test"
import {
  buildPackageDisabledReason,
  buildPackagePrompt,
  canUseBuildPackage,
  type BuildSession,
  type BuildWorkspace,
} from "./build-package"

const batchSession = {
  id: "session_123",
  workspaceID: "workspace_123",
  workspaceKind: "batch_worktree",
  workspaceBranch: "opencode/demo-batch",
} satisfies BuildSession

const singleSession = {
  id: "session_single",
  workspaceKind: "single_worktree",
  workspaceDirectory: "/tmp/sandbox/app",
  workspaceBranch: "opencode/demo-single",
} satisfies BuildSession

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
} satisfies BuildWorkspace

describe("build package action", () => {
  test("enables action for build sessions in batch and single sandboxes", () => {
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
        session: singleSession,
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

  test("returns sandbox-only reason for non-sandbox sessions", () => {
    expect(
      buildPackageDisabledReason({
        agent: "build",
        session: {
          id: "session_123",
        },
      }),
    ).toBe("仅沙盒可用")
  })

  test("returns single sandbox reason when directory is missing", () => {
    expect(
      buildPackageDisabledReason({
        agent: "build",
        session: {
          id: "session_123",
          workspaceKind: "single_worktree",
        },
      }),
    ).toBe("未识别到沙盒工作区")
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
    ).toBe("未识别到批量工作区")
  })

  test("builds a fixed batch prompt with existing push rules and the deployment packaging requirements", () => {
    const prompt = buildPackagePrompt({
      session: batchSession,
      workspace: batchWorkspace,
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
    expect(prompt).toContain("当前提交哈希")
    expect(prompt).toContain("输出摘要完成后后 根据当前会话的git 提交信息编译打包用于部署的文件成压缩包")
    expect(prompt).toContain("包里只保留包含更改内容对应的编译文件")
    expect(prompt).toContain("压缩包放到程序根目录下 ai_build_zip文件夹下")
    expect(prompt).toContain("如果有多个解决方案的话 按解决方案名称后缀生成各个包")
    expect(prompt).toContain("编译失败如果是代码问题 则将错误返回 让用户继续修改 你不要直接改代码")
    expect(prompt).toContain("编译失败如果是缺少依赖等 你自己自动迭代")
    expect(prompt).toContain("最终要生成可部署的压缩包")
    expect(prompt).not.toContain("auto-build.sh")
    expect(prompt).not.toContain("ai_replace_build")
    expect(prompt).not.toContain("build-config.json")
    expect(prompt).not.toContain("DevExpress.XtraEditors.v23.1.dll")
  })

  test("builds a single sandbox prompt without requiring batch workspace metadata", () => {
    const prompt = buildPackagePrompt({
      session: singleSession,
    })

    expect(prompt).toContain("请在当前沙盒工作区内执行“编译打包”流程")
    expect(prompt).toContain("只处理当前沙盒仓库目录")
    expect(prompt).toContain("仓库路径：/tmp/sandbox/app")
    expect(prompt).toContain("当前沙盒分支：opencode/demo-single")
    expect(prompt).toContain("对当前沙盒仓库必须先进入对应的仓库路径目录")
    expect(prompt).toContain("当前沙盒分支名称是：opencode/demo-single")
    expect(prompt).toContain("禁止推送到任何主分支")
  })
})
