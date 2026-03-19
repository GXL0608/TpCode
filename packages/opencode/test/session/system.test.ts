import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "../../src/shell/shell"
import type { Provider } from "../../src/provider/provider"
import { Workspace } from "../../src/control-plane/workspace"

describe("SystemPrompt.environment", () => {
  test("includes actual shell and syntax family", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = {
          providerID: "openai",
          api: { id: "gpt-5.2" },
        } as unknown as Provider.Model
        const env = await SystemPrompt.environment(model)
        const text = env.join("\n")
        const info = Shell.info(Shell.acceptable())

        expect(text).toContain("Platform:")
        expect(text).toContain(`Actual shell: ${info.path}`)
        expect(text).toContain(`Shell syntax family: ${info.family}`)
        expect(text).toContain("Command syntax must match the actual shell syntax family")
      },
    })
  })

  test("summarizes top-level entries for a regular repository", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "package.json"), "{}")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = {
          providerID: "openai",
          api: { id: "gpt-5.2" },
        } as unknown as Provider.Model
        const env = await SystemPrompt.environment(model)
        const text = env.join("\n")

        expect(text).toContain("Top-level entries:")
        expect(text).toContain("src/")
        expect(text).toContain("package.json")
      },
    })
  })

  test("summarizes overlay workspace mounts for product sessions", async () => {
    await using api = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "TPHY.UAPI.sln"), "")
      },
    })
    await using cshis = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "TPHY.UWin.HIS2Station"), { recursive: true })
        await Bun.write(path.join(dir, "TPHY.UWin.HIS2Station", "XtraFormLogin.Designer.cs"), "")
      },
    })

    const project = await Instance.provide({
      directory: api.path,
      fn: async () => Instance.project,
    })
    const workspace = await Workspace.createOverlay({
      projectID: project.id,
      sourceRoots: [api.path, cshis.path],
      name: "cshis-product",
      members: [
        {
          directory: api.path,
          name: "HIS统一版API",
          relative_path: "统一HISAPI服务",
          solution_id: "solution-api",
          solution_code: "HIS统一版API",
        },
        {
          directory: cshis.path,
          name: "CSHIS系统",
          relative_path: "CSHIS",
          solution_id: "solution-cshis",
          solution_code: "CSHIS系统",
        },
      ],
    })

    try {
      await Instance.provide({
        directory: workspace.directory,
        fn: async () => {
          const model = {
            providerID: "openai",
            api: { id: "gpt-5.2" },
          } as unknown as Provider.Model
          const env = await SystemPrompt.environment(model)
          const text = env.join("\n")

          expect(text).toContain("Top-level workspace entries:")
          expect(text).toContain("统一HISAPI服务/")
          expect(text).toContain("CSHIS/")
          expect(text).toContain("Use these mounted entry names directly")
          expect(text).not.toContain(api.path)
          expect(text).not.toContain(cshis.path)
        },
      })
    } finally {
      await Workspace.removeBatch(workspace.id).catch(() => undefined)
      await Instance.disposeAll().catch(() => undefined)
    }
  })
})
