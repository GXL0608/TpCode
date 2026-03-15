#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync, readdirSync, rmSync } from "fs"
import path from "path"

const dir = path.join(import.meta.dirname, "..")
process.chdir(dir)

/**
 * 删除目录中的旧 tgz 产物，避免打包时把历史包再次包含进去。
 */
function purge(cwd: string) {
  readdirSync(cwd)
    .filter((item) => item.endsWith(".tgz"))
    .forEach((item) => rmSync(path.join(cwd, item), { force: true }))
}

/**
 * 获取目录里最新生成的 tgz 文件路径。
 */
function latest(cwd: string) {
  return readdirSync(cwd)
    .filter((item) => item.endsWith(".tgz"))
    .sort()
    .at(-1)
}

const skipBuild = process.argv.includes("--skip-build")
if (!skipBuild) {
  await $`bun run ./script/build.ts`
}

const dist = path.join(dir, "dist")
const list = readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const out: string[] = []
for (const name of list) {
  const cwd = path.join(dist, name)
  if (!existsSync(path.join(cwd, "package.json"))) continue
  console.log(`packing ${name}`)
  purge(cwd)
  await $`bun pm pack`.cwd(cwd)
  const file = latest(cwd)
  if (file) out.push(path.join(cwd, file))
}

console.log("")
console.log("Generated tgz packages:")
for (const item of out) {
  console.log(item)
}
