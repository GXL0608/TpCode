import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.create", () => {
  test("creates a worktree for repositories without any commits", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const created = await Worktree.create({ name: "unborn-root" })

        expect(created.branch).toBe("opencode/unborn-root")
        expect(await Filesystem.isDir(created.directory)).toBe(true)

        const status = await $`git status --short --branch`.quiet().cwd(created.directory).text()
        expect(status).toContain("## No commits yet on opencode/unborn-root")
      },
    })
  })

  test("retries without no-checkout when git reports orphan checkout conflicts", async () => {
    await using tmp = await tmpdir({ git: true })
    const real = (await $`which git`.quiet().text()).trim()
    expect(real).toBeTruthy()

    const bin = path.join(tmp.path, "bin")
    const shim = path.join(bin, "git")
    await fs.mkdir(bin, { recursive: true })
    await Bun.write(
      shim,
      [
        "#!/bin/bash",
        `REAL_GIT=${JSON.stringify(real)}`,
        'if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then',
        '  for arg in "$@"; do',
        '    if [ "$arg" = "--no-checkout" ]; then',
        '      echo "No possible source branch, inferring \\"--orphan\\"" >&2',
        '      echo "fatal: options \\"--orphan\\" and \\"--no-checkout\\" cannot be used together" >&2',
        "      exit 128",
        "    fi",
        "  done",
        "fi",
        'exec "$REAL_GIT" "$@"',
      ].join("\n"),
    )
    await fs.chmod(shim, 0o755)

    const prev = process.env.PATH ?? ""
    process.env.PATH = `${bin}${path.delimiter}${prev}`

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const created = await Worktree.create({ name: "retry-orphan-fallback" })

          expect(created.branch).toBe("opencode/retry-orphan-fallback")
          expect(await Filesystem.isDir(created.directory)).toBe(true)
        },
      })
    } finally {
      process.env.PATH = prev
    }
  })
})
