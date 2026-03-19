import { afterEach, describe, expect, test } from "bun:test"
import os from "os"
import fs from "fs/promises"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { Database } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Workspace } from "../../src/control-plane/workspace"
import { SessionTable } from "../../src/session/session.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { TpProductTable } from "../../src/user/product.sql"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { Session } from "../../src/session"
import { BuildOverlay } from "../../src/build/overlay"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

/** 中文注释：为 bash overlay 场景创建最小 git 仓库，确保脚本命令能读到完整源码。 */
async function createRepo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await Bun.$`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "source.txt"), `${name}\n`)
  await Bun.write(path.join(directory, "keep.txt"), "keep\n")
  await Bun.write(path.join(directory, "unchanged.txt"), "unchanged\n")
  await Bun.$`git add .`.cwd(directory).quiet()
  await Bun.$`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

afterEach(async () => {
  const workspaces = await Database.use((db) => db.select().from(WorkspaceTable).all())
  for (const workspace of workspaces) {
    await Workspace.remove(workspace.id).catch(() => undefined)
  }
  await Database.use(async (db) => {
    await db.delete(SessionTable).run()
    await db.delete(TpProductSolutionRootTable).run()
    await db.delete(TpProductSolutionTable).run()
    await db.delete(TpProductTable).run()
  })
})

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test("uses overlay merged sandbox and only persists changed files", async () => {
    await using tmp = await tmpdir()
    const repo = await createRepo(tmp.path, "frontend")
    await Instance.provide({
      directory: repo,
      fn: async () => {
        const product = await AccountProductService.create({
          name: "脚本覆盖层产品",
          directory: repo,
        })
        expect(product.ok).toBe(true)
        if (!product.ok) return

        const solution = await ProductSolutionService.create({
          product_id: product.item.id,
          name: "脚本覆盖层方案",
          code: "bash-overlay",
          build_profile: {
            workdirs: ["frontend"],
            compile_command: "echo build",
            artifact_include: [],
          },
          roots: [
            {
              root_type: "single_repo",
              directory: repo,
              display_name: "脚本覆盖层方案",
              mount_name: "frontend",
              sort_order: 1,
            },
          ],
        })
        expect(solution.ok).toBe(true)
        if (!solution.ok) return
        if (!product.item.project_id) throw new Error("product_project_missing")

        const workspace = await Workspace.createOverlay({
          projectID: product.item.project_id,
          sourceRoots: [repo],
          members: [
            {
              directory: repo,
              name: "frontend",
              relative_path: "frontend",
              solution_id: solution.item.id,
              solution_code: solution.item.code,
            },
          ],
          name: "bash-overlay-workspace",
        })
        const session = await Session.createNext({
          directory: workspace.directory,
          workspaceID: workspace.id,
          workspaceDirectory: workspace.directory,
          workspaceKind: workspace.kind,
          workspaceStatus: "ready",
          workspaceCleanupStatus: "none",
        })
        const bash = await BashTool.init()
        const source = path.join(workspace.directory, "frontend", "source.txt")
        const created = path.join(workspace.directory, "frontend", "new.txt")
        const deleted = path.join(workspace.directory, "frontend", "keep.txt")
        const result = await bash.execute(
          {
            command: `printf 'patched\\n' > "${source}" && cp "${source}" "${created}" && rm "${deleted}"`,
            workdir: workspace.directory,
            description: "更新 overlay 文件",
          },
          {
            ...ctx,
            sessionID: session.id,
          },
        )

        const overlay = await BuildOverlay.load(session.id)
        expect(overlay).toBeDefined()
        if (!overlay) return

        const changes = await BuildOverlay.listChanges(overlay)
        expect(changes.map((item) => `${item.change_type}:${item.display_path}`)).toEqual([
          "delete:frontend/keep.txt",
          "create:frontend/new.txt",
          "update:frontend/source.txt",
        ])
        expect(result.metadata.exit).toBe(0)
        expect(typeof result.metadata.bash_sandbox_directory).toBe("string")
        expect(await Bun.file(path.join(repo, "source.txt")).text()).toBe("frontend\n")
        expect(await Bun.file(path.join(repo, "keep.txt")).text()).toBe("keep\n")
        expect(await Bun.file(path.join(repo, "new.txt")).exists()).toBe(false)
        expect(await Bun.file(path.join(workspace.directory, "frontend", "source.txt")).text()).toBe("patched\n")
        expect(await Bun.file(path.join(workspace.directory, "frontend", "new.txt")).text()).toBe("patched\n")
        expect(await Bun.file(path.join(workspace.directory, "frontend", "unchanged.txt")).exists()).toBe(false)
      },
    })
  })

  test(
    "read-only bash command does not persist whole solution files into overlay",
    { timeout: 15_000 },
    async () => {
    await using tmp = await tmpdir()
    const backend = await createRepo(tmp.path, "backend")
    const frontend = await createRepo(tmp.path, "frontend")
    await Instance.provide({
      directory: backend,
      fn: async () => {
        const product = await AccountProductService.create({
          name: "只读 overlay 产品",
          directory: backend,
        })
        expect(product.ok).toBe(true)
        if (!product.ok) return

        const backendSolution = await ProductSolutionService.create({
          product_id: product.item.id,
          name: "后端方案",
          code: "backend-solution",
          build_profile: {
            workdirs: ["backend"],
            compile_command: "echo build",
            artifact_include: [],
          },
          roots: [
            {
              root_type: "single_repo",
              directory: backend,
              display_name: "后端方案",
              mount_name: "backend",
              sort_order: 1,
            },
          ],
        })
        expect(backendSolution.ok).toBe(true)
        if (!backendSolution.ok) return

        const frontendSolution = await ProductSolutionService.create({
          product_id: product.item.id,
          name: "前端方案",
          code: "frontend-solution",
          build_profile: {
            workdirs: ["frontend"],
            compile_command: "echo build",
            artifact_include: [],
          },
          roots: [
            {
              root_type: "single_repo",
              directory: frontend,
              display_name: "前端方案",
              mount_name: "frontend",
              sort_order: 1,
            },
          ],
        })
        expect(frontendSolution.ok).toBe(true)
        if (!frontendSolution.ok) return
        if (!product.item.project_id) throw new Error("product_project_missing")

        const workspace = await Workspace.createOverlay({
          projectID: product.item.project_id,
          sourceRoots: [backend, frontend],
          members: [
            {
              directory: backend,
              name: "backend",
              relative_path: "backend",
              solution_id: backendSolution.item.id,
              solution_code: backendSolution.item.code,
            },
            {
              directory: frontend,
              name: "frontend",
              relative_path: "frontend",
              solution_id: frontendSolution.item.id,
              solution_code: frontendSolution.item.code,
            },
          ],
          name: "bash-overlay-readonly-workspace",
        })
        const overlay = BuildOverlay.fromWorkspace(workspace)
        expect(overlay).toBeDefined()
        if (!overlay) return
        const session = await Session.createNext({
          directory: workspace.directory,
          workspaceID: workspace.id,
          workspaceDirectory: workspace.directory,
          workspaceKind: workspace.kind,
          workspaceStatus: "ready",
          workspaceCleanupStatus: "none",
        })
        const bash = await BashTool.init()
        const started = Date.now()
        const result = await bash.execute(
          {
            command: "ls -d */ 2>/dev/null || ls -la",
            workdir: workspace.directory,
            description: "列出当前目录第一级子目录",
          },
          {
            ...ctx,
            sessionID: session.id,
          },
        )
        const duration = Date.now() - started

        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("backend/")
        expect(result.metadata.output).toContain("frontend/")
        expect(duration).toBeLessThan(3_000)
        expect(await BuildOverlay.listChanges(overlay)).toEqual([])
        expect(await Bun.file(path.join(workspace.directory, "backend", "source.txt")).exists()).toBe(false)
        expect(await Bun.file(path.join(workspace.directory, "frontend", "source.txt")).exists()).toBe(false)
      },
    })
  )
})

describe("tool.bash permissions", () => {
  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd ../",
            description: "Change to parent directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "ls",
            workdir: os.tmpdir(),
            description: "List temp dir",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(os.tmpdir(), "*"))
      },
    })
  })

  test("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        const filepath = path.join(outerTmp.path, "outside.txt")
        await bash.execute(
          {
            command: `cat ${filepath}`,
            description: "Read external file",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = path.join(outerTmp.path, "*")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        await bash.execute(
          {
            command: `rm -rf ${path.join(tmp.path, "nested")}`,
            description: "remove nested dir",
          },
          testCtx,
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          testCtx,
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })

  test("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "cat > /tmp/output.txt", description: "Redirect ls output" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("cat > /tmp/output.txt")
      },
    })
  })

  test("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute({ command: "ls -la", description: "List" }, testCtx)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        const pattern = bashReq!.always[0]
        expect(pattern).toBe("ls *")
      },
    })
  })
})

describe("tool.bash truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(false)
        const eol = process.platform === "win32" ? "\r\n" : "\n"
        expect(result.output).toBe(`hello${eol}`)
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath)
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})
