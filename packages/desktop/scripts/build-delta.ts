#!/usr/bin/env bun

import { $ } from "bun"
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

type Change = {
  path: string
  type: "add" | "replace" | "remove"
  hash: string
  size: number
}

type Entry = {
  path: string
  hash: string
  size: number
}

function sort(values: string[]) {
  return [...new Set(values)].sort()
}

async function list(root: string, dir = ""): Promise<string[]> {
  const target = dir ? path.join(root, dir) : root
  const entries = await readdir(target, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry.name).replaceAll("\\", "/")
      if (entry.isDirectory()) return list(root, file)
      if (entry.isFile()) return [file]
      return []
    }),
  )
  return nested.flat()
}

async function dir(root: string) {
  return readdir(root, { withFileTypes: true })
    .then(() => true)
    .catch(() => false)
}

async function read(file: string) {
  const buffer = await Bun.file(file).arrayBuffer()
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(buffer)
  return {
    hash: hash.digest("hex"),
    size: buffer.byteLength,
    buffer,
  }
}

async function scan(root: string) {
  const files = await list(root)
  const entries = await Promise.all(
    files.map(async (file) => {
      const next = await read(path.join(root, file))
      return {
        path: file,
        hash: next.hash,
        size: next.size,
      } satisfies Entry
    }),
  )
  return new Map(entries.map((entry) => [entry.path, entry]))
}

async function writeFile(root: string, file: string, buffer: ArrayBuffer) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, buffer)
}

async function archive(root: string, file: string) {
  await rm(file, { force: true }).catch(() => undefined)

  if (process.platform === "win32") {
    const source = path.join(root, "*")
    await $`powershell -NoLogo -NoProfile -Command Compress-Archive -Path ${source} -DestinationPath ${file} -Force`
    return file
  }

  await $`tar -czf ${file} -C ${path.dirname(root)} ${path.basename(root)}`
  return file
}

export async function buildDelta(input: {
  name: string
  prev: string
  next: string
  outDir?: string
  notesFile?: string
  archiveFile?: string | null
}) {
  const prev = path.resolve(input.prev)
  const next = path.resolve(input.next)
  const outDir = path.resolve(input.outDir ?? path.join(process.cwd(), "dist", `${input.name}-delta`))
  const archiveFile =
    input.archiveFile === null
      ? null
      : path.resolve(
          input.archiveFile ?? `${outDir}${process.platform === "win32" ? ".zip" : ".tar.gz"}`,
        )

  if (!(await dir(prev))) {
    throw new Error(`prev directory not found: ${prev}`)
  }

  if (!(await dir(next))) {
    throw new Error(`next directory not found: ${next}`)
  }

  const [prevFiles, nextFiles] = await Promise.all([scan(prev), scan(next)])
  const files = sort([...prevFiles.keys(), ...nextFiles.keys()])
  const changes = files.reduce((acc, file) => {
    const left = prevFiles.get(file)
    const right = nextFiles.get(file)
    if (!left && right) return acc.concat({ path: file, type: "add", hash: right.hash, size: right.size } satisfies Change)
    if (left && !right) return acc.concat({ path: file, type: "remove", hash: left.hash, size: left.size } satisfies Change)
    if (!left || !right || left.hash === right.hash) return acc
    return acc.concat({ path: file, type: "replace", hash: right.hash, size: right.size } satisfies Change)
  }, [] as Change[])

  await rm(outDir, { recursive: true, force: true })
  await mkdir(path.join(outDir, "add"), { recursive: true })
  await mkdir(path.join(outDir, "replace"), { recursive: true })

  const writeTargets = changes.filter((change) => change.type !== "remove")
  await Promise.all(
    writeTargets.map(async (change) => {
      const slot = change.type === "add" ? "add" : "replace"
      const source = path.join(next, change.path)
      const buffer = await Bun.file(source).arrayBuffer()
      await writeFile(path.join(outDir, slot), change.path, buffer)
    }),
  )

  const remove = changes
    .filter((change) => change.type === "remove")
    .map((change) => change.path)
    .join("\n")
  await Bun.write(path.join(outDir, "remove.txt"), remove ? `${remove}\n` : "")

  const notes =
    input.notesFile && (await Bun.file(input.notesFile).exists())
      ? await Bun.file(input.notesFile).text()
      : `# ${input.name} delta\n\n- from: \`${prev}\`\n- to: \`${next}\`\n- changes: ${changes.length}\n`
  await Bun.write(path.join(outDir, "notes.md"), notes)

  const manifest = {
    version: 1,
    name: input.name,
    created_at: new Date().toISOString(),
    prev,
    next,
    counts: {
      total: changes.length,
      add: changes.filter((change) => change.type === "add").length,
      replace: changes.filter((change) => change.type === "replace").length,
      remove: changes.filter((change) => change.type === "remove").length,
    },
    files: changes,
  }

  await Bun.write(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  const packed = archiveFile ? await archive(outDir, archiveFile) : null

  return {
    outDir,
    archiveFile: packed,
    manifest,
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      name: { type: "string" },
      prev: { type: "string" },
      next: { type: "string" },
      "out-dir": { type: "string" },
      notes: { type: "string" },
      archive: { type: "string" },
      "no-archive": { type: "boolean", default: false },
    },
  })

  if (!values.name || !values.prev || !values.next) {
    throw new Error("name, prev and next are required")
  }

  const result = await buildDelta({
    name: values.name,
    prev: values.prev,
    next: values.next,
    outDir: values["out-dir"],
    notesFile: values.notes,
    archiveFile: values["no-archive"] ? null : values.archive,
  })

  console.log(JSON.stringify(result, null, 2))
}
