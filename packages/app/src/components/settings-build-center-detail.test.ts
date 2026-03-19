import { describe, expect, test } from "bun:test"
import { buildStageGroups, buildStageLabel, syncBuildCenterJobSelection } from "./settings-build-center-detail"

describe("settings-build-center-detail", () => {
  test("在任务选中项不存在时回退到第一条任务", () => {
    const jobs = [{ id: "job-a" }, { id: "job-b" }]
    expect(syncBuildCenterJobSelection(jobs, "")).toBe("job-a")
    expect(syncBuildCenterJobSelection(jobs, "missing")).toBe("job-a")
    expect(syncBuildCenterJobSelection(jobs, "job-b")).toBe("job-b")
    expect(syncBuildCenterJobSelection([], "job-b")).toBe("")
  })

  test("把编译阶段的方案日志整理成可展示的分组", () => {
    expect(
      buildStageGroups({
        stage: "compile",
        detail_json: {
          solutions: [
            {
              solution_code: "shared-api",
              logs: [
                { step: "install", exit_code: 0, workdir: "shared-api", stdout: "done" },
                { step: "compile", exit_code: 1, workdir: "shared-api", stderr: "build failed" },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "shared-api",
        lines: ["install · exit 0 · shared-api", "stdout: done", "compile · exit 1 · shared-api", "stderr: build failed"],
      },
    ])
  })

  test("把打包阶段的产物结果整理成可展示的分组", () => {
    expect(
      buildStageGroups({
        stage: "package",
        detail_json: {
          solutions: [
            {
              solution_code: "a-web",
              file_name: "a-web.zip",
              size: 1024,
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "a-web",
        lines: ["产物: a-web.zip", "大小: 1024 B"],
      },
    ])
  })

  test("把改码阶段的 overlay 变更整理成可展示的分组", () => {
    expect(
      buildStageGroups({
        stage: "coding",
        detail_json: {
          changes: [
            {
              solution_code: "shared-api",
              display_path: "shared-api/src/LoginService.cs",
              source_file_path: "/Volumes/TPCode/shared-api/src/LoginService.cs",
              overlay_file_path: "/Users/demo/.local/share/opencode/build-overlay/job/shared-api/src/LoginService.cs",
              change_type: "update",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "shared-api",
        lines: [
          "文件: shared-api/src/LoginService.cs",
          "真实源码: /Volumes/TPCode/shared-api/src/LoginService.cs",
          "Overlay: /Users/demo/.local/share/opencode/build-overlay/job/shared-api/src/LoginService.cs",
          "变更: update",
        ],
      },
    ])
  })

  test("把平台不匹配的编译失败整理成可读提示", () => {
    expect(
      buildStageGroups({
        stage: "compile",
        detail_json: {
          solutions: [
            {
              solution_code: "CSHIS系统",
              requested_workdirs: ["CSHIS"],
              resolved_workdirs: ["CSHIS"],
              required_platform: "win32",
              current_platform: "darwin",
              compile_sandbox_directory: "/tmp/compile-sandbox/cshis",
              logs: [
                {
                  step: "compile",
                  exit_code: 1,
                  stderr: "当前解决方案的编译命令是 Windows PowerShell/MSBuild 脚本，只能在 Windows 构建节点执行。",
                },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "CSHIS系统",
        lines: [
          "compile · exit 1",
          "stderr: 当前解决方案的编译命令是 Windows PowerShell/MSBuild 脚本，只能在 Windows 构建节点执行。",
          "配置目录: CSHIS",
          "实际目录: CSHIS",
          "编译沙盒: /tmp/compile-sandbox/cshis",
          "要求平台: win32",
          "当前平台: darwin",
        ],
      },
    ])
  })

  test("把编译运行中的当前步骤整理成可读提示", () => {
    expect(
      buildStageGroups({
        stage: "compile",
        detail_json: {
          active: {
            solution_code: "CSHIS系统",
            current_status: "正在准备独立编译沙盒",
            current_step: "prepare_compile_sandbox",
            requested_workdirs: ["CSHIS"],
            source_roots: ["Y:\\02HIS-CS\\CSHIS"],
          },
        },
      }),
    ).toEqual([
      {
        name: "CSHIS系统（当前）",
        lines: ["当前状态: 正在准备独立编译沙盒", "当前步骤: prepare_compile_sandbox", "配置目录: CSHIS", "源码根: Y:\\02HIS-CS\\CSHIS"],
      },
    ])
  })

  test("把改码运行中的目标挂载目录整理成可展示的分组", () => {
    expect(
      buildStageGroups({
        stage: "coding",
        detail_json: {
          session_id: "ses_demo",
          overlay_root: "Y:\\tpcode\\.local\\share\\opencode\\build-overlay\\project_a\\job_a",
          solutions: [
            {
              solution_code: "backend",
              mount_name: "后端",
              stack: ".NET/C#",
              compile_targets: ["TPHY.UWin.HIS2Station/TPHY.UWin.HIS2Station.csproj"],
              candidate_files: ["后端/TPHY.UWin.HIS2Station/frmLogin.cs"],
              source_directory: "Y:\\07慢病系统-JAVA\\后端",
              relative_path: "后端",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "backend",
        lines: [
          "挂载: 后端",
          "目录: 后端",
          "技术栈: .NET/C#",
          "编译目标: TPHY.UWin.HIS2Station/TPHY.UWin.HIS2Station.csproj",
          "优先检查: 后端/TPHY.UWin.HIS2Station/frmLogin.cs",
          "源码: Y:\\07慢病系统-JAVA\\后端",
        ],
      },
      {
        name: "当前改码会话",
        lines: [
          "会话: ses_demo",
          "Overlay: Y:\\tpcode\\.local\\share\\opencode\\build-overlay\\project_a\\job_a",
        ],
      },
    ])
  })

  test("把改码运行中的实时活动和变更文件一起整理出来", () => {
    expect(
      buildStageGroups({
        stage: "coding",
        detail_json: {
          session_id: "ses_live",
          overlay_root: "/Users/demo/.local/share/opencode/build-overlay/job",
          current_status: "模型正在生成下一步改码动作",
          change_count: 2,
          recent_activity: [
            {
              summary: "工具 edit 完成",
            },
            {
              summary: "已生成补丁：CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
            },
          ],
          changes: [
            {
              solution_code: "CSHIS系统",
              display_path: "CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
              source_file_path: "/Volumes/TPCode/02HIS-CS/CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
              overlay_file_path: "/Users/demo/.local/share/opencode/build-overlay/job/CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
              change_type: "update",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "CSHIS系统",
        lines: [
          "文件: CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
          "真实源码: /Volumes/TPCode/02HIS-CS/CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
          "Overlay: /Users/demo/.local/share/opencode/build-overlay/job/CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
          "变更: update",
        ],
      },
      {
        name: "当前改码会话",
        lines: ["会话: ses_live", "Overlay: /Users/demo/.local/share/opencode/build-overlay/job"],
      },
      {
        name: "实时进度",
        lines: [
          "当前状态: 模型正在生成下一步改码动作",
          "当前变更数: 2",
          "最近活动: 工具 edit 完成",
          "最近活动: 已生成补丁：CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.Designer.cs",
        ],
      },
    ])
  })

  test("把系统阶段名称翻译成中文标题", () => {
    expect(buildStageLabel("plan")).toBe("计划")
    expect(buildStageLabel("coding")).toBe("改码")
    expect(buildStageLabel("compile")).toBe("编译")
    expect(buildStageLabel("package")).toBe("打包")
    expect(buildStageLabel("custom")).toBe("custom")
  })
})
