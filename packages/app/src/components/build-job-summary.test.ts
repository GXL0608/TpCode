import { describe, expect, test } from "bun:test"
import { buildScopeText, buildSummaryLine, buildToastDescription, collectBuildSolutionCodes } from "./build-job-summary"

const stages = [
  {
    stage: "compile",
    detail_json: {
      solutions: [
        { solution_code: "a-web" },
        { solution_code: "shared-api" },
      ],
    },
  },
  {
    stage: "package",
    detail_json: {
      solutions: [
        { solution_code: "a-web", file_name: "a-web.zip" },
        { solution_code: "shared-api", file_name: "shared-api.zip" },
      ],
    },
  },
]

const artifacts = [
  { id: "artifact-a", file_name: "a-web.zip" },
  { id: "artifact-b", file_name: "shared-api.zip" },
]

describe("build-job-summary", () => {
  test("把产品级构建范围翻译成管理员可读文案", () => {
    expect(buildScopeText("product_all")).toBe("全产品方案")
    expect(buildScopeText("single")).toBe("单解决方案")
    expect(buildScopeText(undefined)).toBe("单解决方案")
  })

  test("从阶段详情中提取去重后的方案编码列表", () => {
    expect(collectBuildSolutionCodes(stages)).toEqual(["a-web", "shared-api"])
  })

  test("生成包含范围、方案和产物数量的列表摘要", () => {
    expect(
      buildSummaryLine({
        solution_scope: "product_all",
        stages,
        artifacts,
      }),
    ).toBe("全产品方案 · a-web、shared-api · 2 个包")
  })

  test("为用户侧 build 成功提示生成更清晰的完成说明", () => {
    expect(
      buildToastDescription({
        solution_scope: "product_all",
        stages,
        artifacts,
      }),
    ).toBe("系统已完成 a-web、shared-api 的改码、编译与打包，本次共生成 2 个发布包。")
  })
})
