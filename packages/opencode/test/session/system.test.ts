import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "../../src/shell/shell"
import type { Provider } from "../../src/provider/provider"

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
})
