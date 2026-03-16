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
              change_type: "update",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "shared-api",
        lines: ["shared-api/src/LoginService.cs", "变更: update"],
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
