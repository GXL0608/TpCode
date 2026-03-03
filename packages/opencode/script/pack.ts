#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync, readdirSync } from "fs"
import path from "path"

const dir = path.join(import.meta.dirname, "..")
process.chdir(dir)

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
  await $`bun pm pack`.cwd(cwd)
  const file = readdirSync(cwd)
    .filter((item) => item.endsWith(".tgz"))
    .sort()
    .at(-1)
  if (file) out.push(path.join(cwd, file))
}

console.log("")
console.log("Generated tgz packages:")
for (const item of out) {
  console.log(item)
}
