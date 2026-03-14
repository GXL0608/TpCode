type Kind = "aspnet-web" | "mvc-api" | "winforms" | "dotnet"
type Risk = "low" | "medium" | "high"
type Mode = "delta-preferred" | "full-preferred"
type Status = "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown"
type BuildTool = "dotnet" | "msbuild"

export type DeltaInput = {
  repo: string
  from?: string
  to: string
  project?: string
  kind?: Kind | "auto"
  configuration?: string
  publish_args?: string
}

export type Candidate = {
  path: string
  name: string
  kind: Kind
  title: string
  reason: string
}

type SourceFile = {
  path: string
  status: Status
  previous?: string
}

type OutputFile = {
  path: string
  type: "add" | "replace" | "remove"
  hash: string
  size: number
}

type Stored = {
  job: string
  created_at: string
  repo: string
  from: { input: string; resolved: string; short: string }
  to: { input: string; resolved: string; short: string }
  project: {
    path: string
    name: string
    kind: Kind
    title: string
    configuration: string
    build_tool: BuildTool
  }
  strategy: {
    mode: Mode
    reason: string
  }
  risk: Risk
  warnings: string[]
  source: {
    total: number
    additions: number
    deletions: number
    blockers: string[]
    files: SourceFile[]
  }
  output: {
    total: number
    add: number
    replace: number
    remove: number
    files: OutputFile[]
  }
  command: string
  artifacts: Array<{
    name: string
    label: string
    url: string
    size: number
  }>
}

type NodeError = Error & {
  status?: number
  candidates?: Candidate[]
}

type ProjectInfo = {
  path: string
  root: string
  assembly: string
  refs: string[]
}

type OutputFilter = {
  exact: Set<string>
  assembly: Set<string>
}

function fail(status: number, message: string, extra?: Partial<NodeError>) {
  return Object.assign(new Error(message), { status }, extra)
}

function asError(error: unknown) {
  if (error instanceof Error) return error as NodeError
  return new Error(String(error))
}

function norm(input: string) {
  return input.replaceAll("\\", "/").replace(/^[./]+/, "")
}

function short(input: string) {
  return input.slice(0, 7)
}

function hide(input: string) {
  return input.replace(/\/\/([^@/]+)@/, "//***@")
}

function title(kind: Kind) {
  if (kind === "aspnet-web") return "ASP.NET Web"
  if (kind === "mvc-api") return "MVC API"
  if (kind === "winforms") return "WinForms"
  return ".NET"
}

function mode(kind: Kind, blockers: string[]) {
  if (kind === "winforms") {
    return {
      mode: "full-preferred" as const,
      reason: "WinForms is safer with full deployment by default; this delta package is better suited to controlled xcopy validation.",
    }
  }

  if (blockers.length > 0) {
    return {
      mode: "full-preferred" as const,
      reason: "Project or publish configuration files changed. A delta package was generated, but staged verification is recommended before rollout.",
    }
  }

  return {
    mode: "delta-preferred" as const,
    reason: "This package focuses on publish-output differences and is suitable for directory-level incremental deployment.",
  }
}

function risk(kind: Kind, blockers: string[], files: SourceFile[], output: OutputFile[]) {
  if (kind === "winforms") return "high"
  if (blockers.length > 0) return "high"
  if (output.filter((item) => item.type === "remove").length >= 10) return "high"
  if (files.length >= 80 || output.length >= 120) return "medium"
  return "low"
}

function split(input: string) {
  const list: string[] = []
  let part = ""
  let mark = ""

  for (const char of input.trim()) {
    if (mark) {
      if (char === mark) {
        mark = ""
        continue
      }
      part += char
      continue
    }

    if (char === "'" || char === '"') {
      mark = char
      continue
    }

    if (/\s/.test(char)) {
      if (!part) continue
      list.push(part)
      part = ""
      continue
    }

    part += char
  }

  if (part) list.push(part)
  return list
}

function status(code: string): Status {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("M")) return "modified"
  if (code.startsWith("D")) return "deleted"
  if (code.startsWith("R")) return "renamed"
  if (code.startsWith("C")) return "copied"
  return "unknown"
}

function quoted(input: string) {
  return input.startsWith("\"") && input.endsWith("\"") && input.length >= 2
}

function decoded(input: string) {
  const text = quoted(input) ? input.slice(1, -1) : input
  const bytes: number[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== "\\") {
      bytes.push(...Buffer.from(char))
      continue
    }

    const next = text[index + 1] || ""
    if (/^[0-7]$/.test(next)) {
      const oct = text.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] || next
      bytes.push(parseInt(oct, 8))
      index += oct.length
      continue
    }

    if (next === "t") {
      bytes.push(9)
      index += 1
      continue
    }

    if (next === "n") {
      bytes.push(10)
      index += 1
      continue
    }

    if (next === "r") {
      bytes.push(13)
      index += 1
      continue
    }

    if (next) {
      bytes.push(...Buffer.from(next))
      index += 1
      continue
    }

    bytes.push(...Buffer.from(char))
  }

  return Buffer.from(bytes).toString("utf8")
}

function gitPath(input: string) {
  return norm(decoded(input.trim()))
}

function source(text: string) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [code, left, right] = line.split("\t")
      const kind = status(code ?? "")

      if (kind === "renamed" || kind === "copied") {
        return {
          path: gitPath(right ?? ""),
          previous: left ? gitPath(left) : undefined,
          status: kind,
        } satisfies SourceFile
      }

      return {
        path: gitPath(left ?? ""),
        status: kind,
      } satisfies SourceFile
    })
    .filter((item) => item.path)
}

function stat(text: string) {
  return text.split(/\r?\n/).filter(Boolean).reduce(
    (acc, line) => {
      const [add, del] = line.split("\t")
      if (add && add !== "-") acc.additions += Number(add) || 0
      if (del && del !== "-") acc.deletions += Number(del) || 0
      return acc
    },
    { additions: 0, deletions: 0 },
  )
}

function blockers(files: SourceFile[]) {
  return [...new Set(
    files
      .map((item) => item.path)
      .filter((file) =>
        [
          ".sln",
          ".csproj",
          ".vbproj",
          ".props",
          ".targets",
          ".pubxml",
          "packages.config",
          "web.config",
          "app.config",
          "Directory.Build.props",
          "Directory.Build.targets",
          "nuget.config",
          "global.json",
        ].some((part) => file.endsWith(part)),
      ),
  )]
}

function sample<T>(items: T[], count: number) {
  return items.slice(0, count)
}

function safe(input: string, field: string) {
  if (!input.match(/^[a-zA-Z0-9._-]+$/)) throw fail(400, `${field} format is invalid.`)
  return input
}

function safePath(input: string, field: string) {
  const path = norm(input)
  if (!path.match(/^[a-zA-Z0-9._/-]+$/)) throw fail(400, `${field} format is invalid.`)
  if (path.split("/").some((item) => !item || item === "." || item === "..")) throw fail(400, `${field} format is invalid.`)
  return path
}

function slug(input: string) {
  return norm(input).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project"
}
function folder(file: string) {
  const path = norm(file)
  const index = path.lastIndexOf("/")
  return index < 0 ? "" : path.slice(0, index)
}

function base(file: string) {
  const path = norm(file)
  const name = path.slice(path.lastIndexOf("/") + 1)
  const index = name.lastIndexOf(".")
  return index < 0 ? name : name.slice(0, index)
}

function relative(root: string, file: string) {
  const path = norm(file)
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function compile(file: string) {
  return /\.(cs|vb)$/i.test(file) || file.endsWith(".xaml") || file.endsWith(".resx") || file.endsWith(".tt")
}

function projectChange(file: string) {
  return [
    ".csproj",
    ".vbproj",
    ".props",
    ".targets",
    "packages.config",
    "Directory.Build.props",
    "Directory.Build.targets",
  ].some((part) => file.endsWith(part))
}

function assembly(body: string, file: string) {
  return body.match(/<AssemblyName>\s*([^<]+)\s*<\/AssemblyName>/i)?.[1]?.trim() || base(file)
}
function normalizeKind(input: DeltaInput["kind"]) {
  return input === "aspnet-web" || input === "mvc-api" || input === "winforms" ? input : "auto"
}

async function child() {
  return import("node:child_process")
}

async function fs() {
  return import("node:fs/promises")
}

async function hashFile(file: string) {
  const [{ readFile }, { createHash }] = await Promise.all([fs(), import("node:crypto")])
  const buffer = await readFile(file)
  return {
    size: buffer.byteLength,
    hash: createHash("sha256").update(buffer).digest("hex"),
    buffer,
  }
}

async function run(cmd: string, args: string[], cwd?: string) {
  const { spawn } = await child()

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })

    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })

    proc.on("error", (error) => reject(error))
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(
        new Error(
          [cmd, ...args].join(" ") +
            "\n" +
            [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim(),
        ),
      )
    })
  })
}

async function path() {
  return import("node:path")
}

async function root() {
  const [{ mkdir }, nodePath] = await Promise.all([fs(), path()])
  const dir = nodePath.join(process.cwd(), "tpcode-delta-jobs")
  await mkdir(dir, { recursive: true })
  return dir
}

async function cleanup(dir: string) {
  const [{ readdir, rm, stat: info }, nodePath] = await Promise.all([fs(), path()])
  const now = Date.now()
  const list = await readdir(dir).catch(() => [])

  await Promise.all(
    list.map(async (name) => {
      const target = nodePath.join(dir, name)
      const meta = await info(target).catch(() => undefined)
      if (!meta || !meta.isDirectory()) return
      if (now - meta.mtimeMs < 1000 * 60 * 60 * 24) return
      await rm(target, { recursive: true, force: true })
    }),
  )
}

async function exists(file: string) {
  const { stat } = await fs()
  return stat(file)
    .then(() => true)
    .catch(() => false)
}

async function text(file: string) {
  const { readFile } = await fs()
  return readFile(file, "utf8").catch(() => "")
}

async function walk(dir: string, base = dir, trim = true) {
  const [{ readdir }, nodePath] = await Promise.all([fs(), path()])
  const list = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    list.map(async (item) => {
      const next = nodePath.join(dir, item.name)
      if (item.isDirectory()) {
        if (
          item.name === ".git" ||
          item.name === "node_modules" ||
          item.name === ".vs" ||
          (trim && (item.name === "bin" || item.name === "obj"))
        ) {
          return []
        }

        return walk(next, base, trim)
      }

      return [norm(nodePath.relative(base, next))]
    }),
  )

  return nested.flat()
}

async function controllers(dir: string) {
  return (await walk(dir)).filter((file) => file.endsWith("Controller.cs"))
}

async function detect(dir: string, file: string) {
  const nodePath = await path()
  const project = norm(file)
  const name = nodePath.basename(project, nodePath.extname(project))
  const rootDir = nodePath.dirname(nodePath.join(dir, project))
  const body = await text(nodePath.join(dir, project))
  const output = body.match(/<OutputType>\s*([^<]+)\s*<\/OutputType>/i)?.[1]?.trim().toLowerCase() || ""
  const winforms =
    !!body.match(/<UseWindowsForms>\s*true\s*<\/UseWindowsForms>|System\.Windows\.Forms/i) &&
    (output === "exe" || output === "winexe")
  const web = !!body.match(/Microsoft\.NET\.Sdk\.Web/i) || (await exists(nodePath.join(rootDir, "web.config")))

  const files = await Promise.all([text(nodePath.join(rootDir, "Program.cs")), text(nodePath.join(rootDir, "Startup.cs"))])
  const api =
    (name + " " + project).match(/api|webapi|mvcapi/i) !== null ||
    files.some((item) => item.match(/AddControllers|MapControllers|ControllerBase|ApiController/)) ||
    (await controllers(rootDir)).some((item) => item.includes("Controllers/"))

  const kind = winforms ? "winforms" : web && api ? "mvc-api" : web ? "aspnet-web" : "dotnet"
  const reason = winforms
    ? "Detected a WinForms project marker."
    : web && api
      ? "Detected Web SDK plus API controllers or AddControllers/MapControllers."
      : web
        ? "Detected Web SDK or web.config."
        : "Not recognized as Web/API/WinForms; this test page is usually not recommended for it."

  return {
    path: project,
    name,
    kind,
    title: title(kind),
    reason,
  } satisfies Candidate
}

async function projects(dir: string) {
  const list = await walk(dir)
  const items = list.filter((file) => file.endsWith(".csproj") || file.endsWith(".vbproj")).sort((a, b) => a.localeCompare(b))
  return Promise.all(items.map((item) => detect(dir, item)))
}

async function detail(dir: string) {
  const nodePath = await path()
  const list = await walk(dir)
  const items = list.filter((file) => file.endsWith(".csproj") || file.endsWith(".vbproj")).sort((a, b) => a.localeCompare(b))

  return Promise.all(
    items.map(async (item) => {
      const body = await text(nodePath.join(dir, item))
      return {
        path: norm(item),
        root: folder(item),
        assembly: assembly(body, item),
        refs: [...new Set(
          [...body.matchAll(/<ProjectReference\b[^>]*Include="([^"]+)"/gi)]
            .map((part) => part[1]?.trim())
            .filter((part): part is string => !!part)
            .map((part) => norm(nodePath.normalize(nodePath.join(folder(item) || ".", part)))),
        )],
      } satisfies ProjectInfo
    }),
  )
}

function hit(file: string, list: ProjectInfo[]) {
  const path = norm(file)
  return list
    .slice()
    .sort((a, b) => b.root.length - a.root.length)
    .find((item) => path === item.path || !item.root || path === item.root || path.startsWith(`${item.root}/`))
}

function hits(file: SourceFile, list: ProjectInfo[]) {
  return [...new Map(
    [file.path, file.previous]
      .filter((item): item is string => !!item)
      .map((item) => hit(item, list))
      .filter((item): item is ProjectInfo => !!item)
      .map((item) => [item.path, item]),
  ).values()]
}

function filter(files: SourceFile[], picked: Candidate, list: ProjectInfo[]) {
  return files.reduce(
    (acc, item) => {
      const owners = hits(item, list)
      const next = owners.find((part) => part.path === picked.path)
      owners
        .filter((part) => part.path !== picked.path)
        .forEach((part) => acc.assembly.add(part.assembly))

      if (!next) return acc
      if (owners.length > 1) {
        acc.assembly.add(next.assembly)
        return acc
      }

      const file = relative(folder(picked.path), item.path)
      if (!file || compile(file) || projectChange(file)) {
        acc.assembly.add(next.assembly)
        return acc
      }

      acc.exact.add(file)
      return acc
    },
    { exact: new Set<string>(), assembly: new Set<string>() } satisfies OutputFilter,
  )
}

function asset(file: string, name: string) {
  const path = norm(file)
  return (
    path === `${name}.dll` ||
    path === `${name}.exe` ||
    path === `${name}.pdb` ||
    path === `${name}.xml` ||
    path === `${name}.deps.json` ||
    path === `${name}.runtimeconfig.json` ||
    path.startsWith(`${name}.XmlSerializers.`) ||
    path === `bin/${name}.dll` ||
    path === `bin/${name}.exe` ||
    path === `bin/${name}.pdb` ||
    path === `bin/${name}.xml` ||
    path === `bin/${name}.deps.json` ||
    path === `bin/${name}.runtimeconfig.json` ||
    path.startsWith(`bin/${name}.XmlSerializers.`)
  )
}

function allow(file: string, filter: OutputFilter) {
  const path = norm(file)
  if (filter.exact.has(path)) return true
  return [...filter.assembly].some((item) => asset(path, item))
}

function scope(list: Candidate[], kind: Kind | "auto") {
  const supported = list.filter((item) => item.kind !== "dotnet")
  return (kind === "auto" ? supported : supported.filter((item) => item.kind === kind)).sort((a, b) =>
    a.path.localeCompare(b.path),
  )
}

function linked(path: string, target: string, map: Map<string, ProjectInfo>, memo: Map<string, boolean>, seen = new Set<string>()) {
  const key = `${path}>${target}`
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  if (path === target) {
    memo.set(key, true)
    return true
  }
  if (seen.has(path)) {
    memo.set(key, false)
    return false
  }

  seen.add(path)
  const item = map.get(path)
  const value = !!item?.refs.some((ref) => linked(ref, target, map, memo, seen))
  memo.set(key, value)
  return value
}

function impacted(files: SourceFile[], candidates: Candidate[], list: ProjectInfo[]) {
  const touched = [...new Map(files.flatMap((item) => hits(item, list).map((part) => [part.path, part]))).values()]
  if (touched.length === 0) return []

  const map = new Map(list.map((item) => [item.path, item]))
  const memo = new Map<string, boolean>()
  return candidates.filter((item) => touched.some((part) => linked(item.path, part.path, map, memo)))
}

function touched(files: SourceFile[], candidates: Candidate[], list: ProjectInfo[], kind: Kind | "auto") {
  const map = new Map(candidates.map((item) => [item.path, item]))
  return [...new Map(files.flatMap((item) => hits(item, list).map((part) => [part.path, part]))).values()]
    .map((item) => map.get(item.path))
    .filter((item): item is Candidate => !!item && (kind === "auto" || item.kind === kind))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function choose(list: Candidate[], info: ProjectInfo[], files: SourceFile[], input: DeltaInput): Picked {
  const kind = normalizeKind(input.kind)
  const filtered = scope(list, kind)

  if (input.project) {
    const target = norm(input.project)
    const hit = list.find((item) => item.path === target || item.path.endsWith(`/${target}`))
    if (!hit) throw fail(400, "The specified project file was not found. Copy the exact path from the candidate list.", { candidates: sample(filtered, 20) })
    if (kind === "auto") return { projects: [hit], warnings: [] }

    return {
      projects: [{
        ...hit,
        kind,
        title: title(kind),
      }],
      warnings:
        hit.kind === kind || hit.kind === "dotnet"
          ? []
          : [`Auto-detected project kind is ${hit.title}; this run will use your requested ${title(kind)} kind.`],
    }
  }

  const direct = touched(files, list, info, kind)
  if (direct.length > 1) {
    return {
      projects: direct,
      warnings: [`Project file was omitted, so ${direct.length} directly changed project files were selected from the commit.`],
    }
  }

  if (direct.length === 1) {
    return {
      projects: [direct[0]],
      warnings: [`Project file was omitted, so the directly changed project was selected from the commit: ${direct[0].path}.`],
    }
  }

  if (filtered.length === 1) return { projects: [filtered[0]], warnings: [] }
  if (filtered.length === 0) throw fail(400, "No deployable ASP.NET, MVC API, or WinForms project was found.", { candidates: sample(list, 20) })

  const matched = impacted(files, filtered, info)
  if (matched.length > 1) {
    return {
      projects: matched,
      warnings: [`Project file was omitted, so ${matched.length} target projects were auto-detected from commit changes.`],
    }
  }

  if (matched.length === 1) {
    return {
      projects: [matched[0]],
      warnings: [`Project file was omitted, so the target project was auto-detected from commit changes: ${matched[0].path}.`],
    }
  }

  return {
    projects: filtered,
    warnings: ["Multiple deployable projects were found, but commit changes could not narrow the scope. Delta packages will be generated for all deployable projects."],
  }
}
async function git(dir: string, ref: string) {
  const body = await run("git", ["rev-parse", `${ref}^{commit}`], dir)
  return body.stdout.trim()
}

async function previous(dir: string, ref: string) {
  return run("git", ["rev-parse", `${ref}^1`], dir)
    .then((body) => body.stdout.trim())
    .catch(() => "")
}

async function checkout(dir: string, ref: string) {
  await run("git", ["checkout", "--force", ref], dir)
  await run("git", ["clean", "-fdx"], dir)
}

function legacyWebProject(body: string) {
  return (
    body.match(/Microsoft\.WebApplication\.targets/i) !== null ||
    body.match(/\{349c5851-65df-11da-9384-00065b846f21\}/i) !== null ||
    body.match(/<UseIISExpress>\s*true\s*<\/UseIISExpress>/i) !== null
  )
}

function legacyDesktopProject(body: string) {
  return (
    body.match(/<TargetFrameworkVersion>\s*v[\d.]+\s*<\/TargetFrameworkVersion>/i) !== null &&
    body.match(/<Project\b[^>]*ToolsVersion=/i) !== null &&
    body.match(/<Import\b[^>]*Microsoft\.(CSharp|VisualBasic)\.targets/i) !== null &&
    body.match(/<Project\s+Sdk=/i) === null
  )
}

function webTargets(error: unknown) {
  return asError(error).message.includes("Microsoft.WebApplication.targets")
}

function restoreIssue(error: unknown) {
  const body = asError(error).message
  return body.includes("NuGet.targets") && (body.includes("error :") || body.includes("SolutionDir"))
}

function brief(error: unknown, count: number) {
  return asError(error).message
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.includes("error :") || /:\s*error\s+[A-Z]{2,}\d+:/i.test(item) || /\berror\s+MSB\d+:/i.test(item))
    .slice(0, count)
}

function escape(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hintPaths(body: string) {
  return [...body.matchAll(/<HintPath>\s*([^<]+?)\s*<\/HintPath>/gi)]
    .map((item) => item[1]?.trim())
    .filter((item): item is string => !!item)
}

function suffix(left: string, right: string) {
  const a = norm(left).split("/")
  const b = norm(right).split("/")
  let count = 0

  while (count < a.length && count < b.length) {
    if (a[a.length - count - 1]?.toLowerCase() !== b[b.length - count - 1]?.toLowerCase()) break
    count += 1
  }

  return count
}

function unresolvedTarget(input: string) {
  const index = input.indexOf("->")
  return norm(index < 0 ? input.trim() : input.slice(index + 2).trim())
}

function packagePath(input: string) {
  const path = unresolvedTarget(input).toLowerCase()
  return path === "packages" || path.startsWith("packages/") || path.includes("/packages/")
}

function absoluteHint(input: string) {
  const path = input.trim().replaceAll("\\", "/")
  return /^[a-z]:\//i.test(path) || path.startsWith("//")
}

function externalHint(input: string) {
  const path = input.trim().replaceAll("\\", "/").toLowerCase()
  return absoluteHint(input) || path.startsWith("浠诲姟/") || path.includes("/浠诲姟/") || path.startsWith("婧愮爜/") || path.includes("/婧愮爜/") || path.startsWith("123婧愮爜/") || path.includes("/123婧愮爜/")
}

function graphPath(file: string, roots: Set<string>) {
  const path = norm(file).toLowerCase()
  return [...roots].some((root) => path === root || path.startsWith(`${root}/`))
}

function hintScore(file: string, target: string, owner: string, roots: Set<string>) {
  const path = norm(file).toLowerCase()
  const ownerDir = folder(owner).toLowerCase()
  let score = suffix(file, target) * 100

  if (ownerDir && (path === ownerDir || path.startsWith(`${ownerDir}/`))) score += 80
  if (graphPath(path, roots)) score += 60
  if (path.includes("/dll/")) score += 40
  if (path.includes("/common/")) score += 30
  if (path.includes("/other/")) score += 20
  if (path.includes("/lib/")) score += 10
  if (path.includes("/packages/")) score += 5
  return score
}

function unresolvedMessage(project: string, unresolved: string[]) {
  const files = [...new Set(unresolved.map((item) => norm(item)))]
  const packages = files.filter((item) => packagePath(item))
  const binary = files.filter(
    (item) => !packages.includes(item) && unresolvedTarget(item).toLowerCase().includes("/bin/") && unresolvedTarget(item).toLowerCase().endsWith(".dll"),
  )
  const refs = files.filter((item) => !packages.includes(item) && !binary.includes(item))
  const lines = [`经典 .NET Framework 项目 ${project} 仍有依赖无法在当前源码仓库中解析，无法在干净 Git 克隆中完成构建。`, ""]

  if (packages.length) {
    lines.push("NuGet/Packages 依赖在还原后仍未找到：")
    lines.push(...sample(packages, 20).map((item) => `- ${item}`))
    lines.push("这通常表示当前 NuGet 源不完整，或项目锁定的包版本已经无法 restore。")
    lines.push("")
  }

  if (refs.length) {
    lines.push("缺失的 HintPath 依赖：")
    lines.push(...sample(refs, 20).map((item) => `- ${item}`))
    lines.push("")
  }

  if (binary.length) {
    lines.push("缺失的预编译项目输出：")
    lines.push(...sample(binary, 20).map((item) => `- ${item}`))
    lines.push("这通常表示项目依赖本地或已编译 DLL，而不是可从源码直接还原的 ProjectReference/NuGet 依赖。")
    lines.push("")
  }

  if (packages.length) {
    lines.push("请确认当前机器可访问正确的 NuGet 源，并且对应包版本可以成功 restore。")
  }

  if (refs.length || binary.length) {
    lines.push("请补齐这些 DLL 到仓库中，或将该项目改造成可从纯源码构建后再生成增量包。")
  }

  return lines.join("\n").trim()
}

function msbuildArgs(input: string) {
  return split(input).reduce(
    (acc, item) => {
      if (item.startsWith("/")) {
        acc.args.push(item)
        return acc
      }

      if (item.startsWith("-p:")) {
        acc.args.push(`/p:${item.slice(3)}`)
        return acc
      }

      if (item.startsWith("--property:")) {
        acc.args.push(`/p:${item.slice("--property:".length)}`)
        return acc
      }

      acc.skipped.push(item)
      return acc
    },
    { args: [] as string[], skipped: [] as string[] },
  )
}

let studio:
  | Promise<{
      msbuild: string
      tools: string
      version: string
    }>
  | undefined

async function visualStudioBuild() {
  if (studio) return studio

  studio = (async () => {
    const nodePath = await path()
    const vswhere = process.env["ProgramFiles(x86)"]
      ? nodePath.join(process.env["ProgramFiles(x86)"] || "", "Microsoft Visual Studio", "Installer", "vswhere.exe")
      : ""

    const find = async (query: string) => {
      if (!vswhere || !(await exists(vswhere))) return ""
      const body = await run(vswhere, ["-latest", "-products", "*", "-find", query]).catch(() => undefined)
      return body?.stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || ""
    }

    const msbuild = await find("MSBuild\\**\\Bin\\MSBuild.exe")
    if (!msbuild) {
      throw fail(500, "当前机器缺少 Visual Studio MSBuild，无法构建经典 .NET Framework 项目。请安装 Visual Studio 2022 Build Tools 或 Community。")
    }

    const targets = await find("MSBuild\\Microsoft\\VisualStudio\\*\\WebApplications\\Microsoft.WebApplication.targets")
    const tools = targets ? nodePath.dirname(nodePath.dirname(targets)) : ""
    const version = tools ? nodePath.basename(tools).replace(/^v/i, "") || "17.0" : "17.0"
    return { msbuild, tools, version }
  })()

  return studio
}

async function visualStudioWebBuild() {
  const tool = await visualStudioBuild()
  if (tool.tools) return tool
  throw fail(
    500,
    "Detected an ASP.NET Web Application project, but Visual Studio MSBuild WebApplications targets are missing. Install Visual Studio 2022 Build Tools with the Web workload and try again.",
  )
}

function buildPlatform(body: string, extra: { args: string[] }) {
  const picked = extra.args.find((item) => item.match(/^\/p:Platform=/i))
  if (picked) return picked.slice(picked.indexOf("=") + 1).trim().replaceAll(" ", "") || "AnyCPU"
  if (body.match(/<PlatformTarget>\s*x86\s*<\/PlatformTarget>/i) !== null) return "x86"
  if (body.match(/Release\|x86/i) !== null) return "x86"
  return "AnyCPU"
}

async function solutionFile(dir: string, project: string) {
  const [{ readdir }, nodePath] = await Promise.all([fs(), path()])
  const root = nodePath.resolve(dir)
  let current = nodePath.dirname(nodePath.join(root, project))

  while (current.startsWith(root)) {
    const hit = await readdir(current, { withFileTypes: true })
      .then((items) => items.find((item) => item.isFile() && item.name.endsWith(".sln")))
      .catch(() => undefined)

    if (hit) return nodePath.join(current, hit.name)
    if (current === root) return ""
    current = nodePath.dirname(current)
  }

  return ""
}

async function solutionDir(dir: string, project: string) {
  const nodePath = await path()
  const file = await solutionFile(dir, project)
  return file ? nodePath.dirname(file) : nodePath.resolve(dir)
}

async function copyDir(from: string, to: string) {
  const [{ cp, mkdir, rm }, nodePath] = await Promise.all([fs(), path()])
  await rm(to, { recursive: true, force: true })
  await mkdir(nodePath.dirname(to), { recursive: true })
  await cp(from, to, { recursive: true, force: true })
}

async function projectRefs(dir: string, project: string, seen = new Set<string>()) {
  const nodePath = await path()
  const current = norm(project)
  if (seen.has(current)) return []
  seen.add(current)

  const body = await text(nodePath.join(dir, current))
  const refs = [...body.matchAll(/<ProjectReference\b[^>]*Include="([^"]+)"/gi)]
    .map((item) => item[1]?.trim())
    .filter((item): item is string => !!item)
    .map((item) => norm(nodePath.normalize(nodePath.join(folder(current) || ".", item))))

  const nested = await Promise.all(refs.map((item) => projectRefs(dir, item, seen)))
  return [current, ...nested.flat()]
}

async function hydrateLegacyDependencies(dir: string, project: string) {
  const [{ copyFile, mkdir }, nodePath] = await Promise.all([fs(), path()])
  const list = await walk(dir, dir, false)
  const warnings: string[] = []
  const unresolved: string[] = []
  const projects = await projectRefs(dir, project)
  const roots = new Set(projects.map((item) => folder(item).toLowerCase()).filter(Boolean))

  for (const owner of projects) {
    const body = await text(nodePath.join(dir, owner))
    const rootDir = folder(owner)

    for (const item of hintPaths(body)) {
      const target = absoluteHint(item) ? norm(item) : norm(nodePath.normalize(nodePath.join(rootDir || ".", item)))
      const full = absoluteHint(item) ? nodePath.normalize(item) : nodePath.resolve(dir, rootDir || ".", item)
      if (await exists(full)) continue
      if (packagePath(target)) {
        unresolved.push(`${owner} -> ${target}`)
        continue
      }

      const matches = list
        .filter((file) => nodePath.basename(file).toLowerCase() === nodePath.basename(target).toLowerCase() && norm(file) !== target)
        .map((file) => ({ file, score: hintScore(file, target, owner, roots) }))
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))

      const best = matches[0]
      const next = matches[1]
      const resolved = !!best && (
        (best.score >= 200 && (!next || next.score < best.score)) ||
        ((externalHint(item) || best.file.toLowerCase().includes("/dll/") || best.file.toLowerCase().includes("/common/") || best.file.toLowerCase().includes("/other/")) &&
          best.score >= 140 &&
          (!next || next.score + 20 <= best.score))
      )

      if (resolved && best) {
        await mkdir(nodePath.dirname(full), { recursive: true })
        await copyFile(nodePath.join(dir, best.file), full)
        warnings.push(`已为 ${owner} 自动补齐缺失依赖 ${target}，来源：${best.file}。`)
        continue
      }

      unresolved.push(`${owner} -> ${target}`)
    }
  }

  return { warnings, unresolved: [...new Set(unresolved)] }
}

async function legacyDesktopRestore(
  dir: string,
  project: string,
  input: DeltaInput,
  tool: Awaited<ReturnType<typeof visualStudioBuild>>,
  platform: string,
  solution: string,
  root: string,
) {
  const nodePath = await path()

  try {
    await run(
      tool.msbuild,
      [
        solution || nodePath.resolve(dir, project),
        "/t:Restore",
        `/p:Configuration=${input.configuration || "Release"}`,
        `/p:Platform=${solution ? platform.replaceAll("AnyCPU", "Any CPU") : platform}`,
        "/p:RestorePackagesConfig=true",
        `/p:SolutionDir=${root.endsWith(nodePath.sep) ? root : `${root}${nodePath.sep}`}`,
      ],
      dir,
    )
  } catch (error) {
    throw fail(
      500,
      [
        "经典 .NET Framework 项目 NuGet 还原失败。",
        "请确认当前机器可访问配置的 NuGet 源，并检查 packages.config / nuget.config。",
        ...brief(error, 12),
      ].join("\n"),
    )
  }
}

function outputPath(body: string, configuration: string, platform: string) {
  const token = platform.replaceAll(" ", "")
  const pattern = new RegExp(`<PropertyGroup[^>]*Condition="[^"]*'${escape(configuration)}\\|${escape(token)}'[^"]*"[^>]*>([\\s\\S]*?)<\\/PropertyGroup>`, "i")
  const scoped = body.match(pattern)?.[1] || ""
  const exact = scoped.match(/<OutputPath>\s*([^<]+?)\s*<\/OutputPath>/i)?.[1]?.trim()
  if (exact) return exact
  const shared = body.match(/<OutputPath>\s*([^<]+?)\s*<\/OutputPath>/i)?.[1]?.trim()
  if (shared) return shared
  return token === "AnyCPU" ? `bin\\${configuration}\\` : `bin\\${token}\\${configuration}\\`
}

async function projectOutputDir(dir: string, project: string, configuration: string, platform: string) {
  const nodePath = await path()
  const body = await text(nodePath.join(dir, project))
  const output = outputPath(body, configuration, platform)
  return nodePath.join(dir, nodePath.dirname(project), nodePath.normalize(output))
}

async function packageDir(dir: string, project: string, input: DeltaInput) {
  const nodePath = await path()
  return nodePath.join(dir, nodePath.dirname(project), "obj", input.configuration || "Release", "Package", "PackageTmp")
}
async function legacyPublish(dir: string, project: string, out: string, input: DeltaInput, fallback: boolean) {
  const nodePath = await path()
  const tool = await visualStudioWebBuild()
  const extra = msbuildArgs(input.publish_args || "")
  const root = await solutionDir(dir, project)

  try {
    await run(
      tool.msbuild,
      [
        nodePath.resolve(dir, project),
        "/restore",
        "/t:Build",
        `/p:Configuration=${input.configuration || "Release"}`,
        "/p:DeployOnBuild=true",
        "/p:WebPublishMethod=FileSystem",
        `/p:PublishUrl=${nodePath.resolve(out)}`,
        `/p:SolutionDir=${root.endsWith(nodePath.sep) ? root : `${root}${nodePath.sep}`}`,
        "/p:DeleteExistingFiles=true",
        "/p:RestorePackagesConfig=true",
        `/p:VisualStudioVersion=${tool.version}`,
        `/p:VSToolsPath=${tool.tools}`,
        ...extra.args,
      ],
      dir,
    )
  } catch (error) {
    if (!restoreIssue(error)) throw error
    throw fail(
      500,
      [
        "ASP.NET Web Application requires Visual Studio MSBuild plus complete NuGet target support.",
        "Confirm this machine can restore from nuget.org and has the required Build Tools components and packages directory.",
        ...brief(error, 8),
      ].join("\n"),
    )
  }

  const pkg = await packageDir(dir, project, input)

  if (await exists(pkg)) {
    await copyDir(pkg, out)
  }

  if ((await walk(out, out, false)).length === 0) {
    throw fail(500, "ASP.NET Web Application publish finished without a deployable output directory. Check the web packaging result.")
  }

  return {
    tool: "msbuild" as const,
    warnings: [
      fallback
        ? "dotnet publish is missing Microsoft.WebApplication.targets, so Visual Studio MSBuild was selected automatically."
        : "Detected an ASP.NET Web Application project and selected Visual Studio MSBuild.",
      ...(extra.skipped.length
        ? [`Skipped unsupported dotnet publish arguments for ASP.NET Web Application: ${extra.skipped.join(" ")}`]
        : []),
    ],
  }
}

async function legacyDesktopPublish(dir: string, project: string, out: string, input: DeltaInput) {
  const nodePath = await path()
  const tool = await visualStudioBuild()
  const extra = msbuildArgs(input.publish_args || "")
  const body = await text(nodePath.join(dir, project))
  const platform = buildPlatform(body, extra)
  const solution = await solutionFile(dir, project)
  const root = await solutionDir(dir, project)
  await legacyDesktopRestore(dir, project, input, tool, platform, solution, root)
  const hydrated = await hydrateLegacyDependencies(dir, project)

  try {
    await run(
      tool.msbuild,
      [
        solution || nodePath.resolve(dir, project),
        "/restore",
        "/t:Build",
        `/p:Configuration=${input.configuration || "Release"}`,
        `/p:Platform=${solution ? platform.replaceAll("AnyCPU", "Any CPU") : platform}`,
        "/p:RestorePackagesConfig=true",
        `/p:SolutionDir=${root.endsWith(nodePath.sep) ? root : `${root}${nodePath.sep}`}`,
        ...extra.args,
      ],
      dir,
    )
  } catch (error) {
    if (restoreIssue(error)) {
      throw fail(
        500,
        [
          "经典 .NET Framework 桌面项目需要 Visual Studio MSBuild 和完整的本地依赖。",
          "请确认当前机器已安装 Visual Studio 2022 Build Tools/Community，并且仓库已包含所需 DLL。",
          ...brief(error, 12),
        ].join("\n"),
      )
    }

    if (hydrated.unresolved.length > 0) {
      throw fail(
        500,
        [
          unresolvedMessage(project, hydrated.unresolved),
          ...brief(error, 12),
        ].filter(Boolean).join("\n\n"),
      )
    }

    throw error
  }

  const built = await projectOutputDir(dir, project, input.configuration || "Release", platform)
  if (!(await exists(built))) {
    throw fail(500, `经典桌面项目构建完成，但未找到输出目录：${norm(built)}`)
  }

  await copyDir(built, out)
  if ((await walk(out, out, false)).length === 0) {
    throw fail(500, "经典桌面项目构建完成，但发布输出目录为空。")
  }

  return {
    tool: "msbuild" as const,
    warnings: [
      `Detected a classic .NET Framework desktop project and selected Visual Studio MSBuild (${platform}).`,
      ...hydrated.warnings,
      ...(hydrated.unresolved.length ? [`Build continued with ${hydrated.unresolved.length} unresolved HintPath references and relied on MSBuild/local machine assembly resolution.`] : []),
      ...(extra.skipped.length ? [`Skipped unsupported publish arguments for classic desktop build: ${extra.skipped.join(" ")}`] : []),
    ],
  }
}
async function publish(dir: string, project: string, out: string, input: DeltaInput) {
  const nodePath = await path()
  const { mkdir } = await fs()
  await mkdir(out, { recursive: true })
  const body = await text(nodePath.join(dir, project))

  if (legacyWebProject(body)) {
    return legacyPublish(dir, project, out, input, false)
  }

  if (legacyDesktopProject(body)) {
    return legacyDesktopPublish(dir, project, out, input)
  }

  const args = [
    "publish",
    project,
    "-c",
    input.configuration || "Release",
    "-o",
    nodePath.resolve(out),
    ...split(input.publish_args || ""),
  ]

  try {
    await run("dotnet", args, dir)
    return {
      tool: "dotnet" as const,
      warnings: [],
    }
  } catch (error) {
    if (!webTargets(error)) throw error
    return legacyPublish(dir, project, out, input, true)
  }
}
async function scan(dir: string) {
  const nodePath = await path()
  const list = await walk(dir, dir, false)
  const entries = await Promise.all(
    list.map(async (file) => {
      const item = await hashFile(nodePath.join(dir, file))
      return {
        path: file,
        hash: item.hash,
        size: item.size,
      } satisfies Entry
    }),
  )

  return new Map(entries.map((item) => [item.path, item]))
}

async function write(root: string, file: string, buffer: Buffer) {
  const [{ mkdir, writeFile }, nodePath] = await Promise.all([fs(), path()])
  const target = nodePath.join(root, file)
  await mkdir(nodePath.dirname(target), { recursive: true })
  await writeFile(target, buffer)
}

async function zip(dir: string, file: string) {
  const nodePath = await path()

  if (process.platform === "win32") {
    const source = nodePath.join(dir, "*").replaceAll("'", "''")
    const target = file.replaceAll("'", "''")
    await run("powershell", ["-NoLogo", "-NoProfile", "-Command", `Compress-Archive -Path '${source}' -DestinationPath '${target}' -Force`])
    return
  }

  await run("tar", ["-czf", file, "-C", nodePath.dirname(dir), nodePath.basename(dir)])
}

async function pack(job: string, prev: string, next: string, filter?: OutputFilter) {
  const [{ mkdir, rm, writeFile }, nodePath] = await Promise.all([fs(), path()])
  const dir = nodePath.join(job, "delta")
  const zipFile = nodePath.join(job, "delta.zip")
  await rm(dir, { recursive: true, force: true })
  await rm(zipFile, { force: true })
  await mkdir(nodePath.join(dir, "add"), { recursive: true })
  await mkdir(nodePath.join(dir, "replace"), { recursive: true })

  const [left, right] = await Promise.all([scan(prev), scan(next)])
  const files = [...new Set([...left.keys(), ...right.keys()])].sort().filter((file) => (filter ? allow(file, filter) : true))
  const changes = await Promise.all(
    files.flatMap(async (file) => {
      const before = left.get(file)
      const after = right.get(file)

      if (!before && after) {
        const data = await hashFile(nodePath.join(next, file))
        await write(nodePath.join(dir, "add"), file, data.buffer)
        return [{ path: file, type: "add", hash: after.hash, size: after.size } satisfies OutputFile]
      }

      if (before && !after) {
        return [{ path: file, type: "remove", hash: before.hash, size: before.size } satisfies OutputFile]
      }

      if (!before || !after || before.hash === after.hash) return []

      const data = await hashFile(nodePath.join(next, file))
      await write(nodePath.join(dir, "replace"), file, data.buffer)
      return [{ path: file, type: "replace", hash: after.hash, size: after.size } satisfies OutputFile]
    }),
  ).then((items) => items.flat())

  await writeFile(
    nodePath.join(dir, "remove.txt"),
    changes
      .filter((item) => item.type === "remove")
      .map((item) => item.path)
      .join("\n") + (changes.some((item) => item.type === "remove") ? "\n" : ""),
    "utf8",
  )

  const manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    counts: {
      total: changes.length,
      add: changes.filter((item) => item.type === "add").length,
      replace: changes.filter((item) => item.type === "replace").length,
      remove: changes.filter((item) => item.type === "remove").length,
    },
    files: changes,
  }

  await writeFile(nodePath.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")
  return { dir, zipFile, files: changes, counts: manifest.counts }
}

function notes(data: {
  repo: string
  from: string
  to: string
  project: Candidate
  configuration: string
  source: { files: SourceFile[]; additions: number; deletions: number; blockers: string[] }
  output: { files: OutputFile[]; add: number; replace: number; remove: number }
  warnings: string[]
  strategy: { mode: Mode; reason: string }
  risk: Risk
}) {
  const lines = [
    "# Delta Package Notes",
    "",
    `- Repository: \`${hide(data.repo)}\``, 
    `- Commit range: \`${short(data.from)}\` -> \`${short(data.to)}\``, 
    `- Project: \`${data.project.path}\``, 
    `- Kind: \`${data.project.title}\``, 
    `- Configuration: \`${data.configuration}\``, 
    `- Risk: \`${data.risk}\``, 
    `- Strategy: \`${data.strategy.mode}\``, 
    "",
    data.strategy.reason,
    "",
    "## Source Changes",
    `- Files: ${data.source.files.length}`, 
    `- Added lines: ${data.source.additions}`, 
    `- Deleted lines: ${data.source.deletions}`, 
    `- High-risk items: ${data.source.blockers.length ? data.source.blockers.join(", ") : "none"}`, 
    "",
    "## Publish Output",
    `- Files: ${data.output.files.length}`, 
    `- Added: ${data.output.add}`, 
    `- Replaced: ${data.output.replace}`, 
    `- Removed: ${data.output.remove}`, 
    "",
  ]

  if (data.warnings.length) {
    lines.push("## Warnings")
    lines.push(...data.warnings.map((item) => `- ${item}`))
    lines.push("")
  }

  if (data.source.files.length) {
    lines.push("## Changed Files")
    lines.push(...sample(data.source.files, 40).map((item) => `- [${item.status}] ${item.path}${item.previous ? ` <- ${item.previous}` : ""}`))
    lines.push("")
  }

  if (data.output.files.length) {
    lines.push("## Output Files")
    lines.push(...sample(data.output.files, 40).map((item) => `- [${item.type}] ${item.path}`))
    lines.push("")
  }

  lines.push("## Windows Deployment")
  lines.push(
    `- \`powershell -ExecutionPolicy Bypass -File .\\apply-delta.ps1 -DeltaPath .\\delta.zip -TargetRoot ${target(data.project.kind)}\``,
  )
  lines.push("- For ASP.NET / MVC API, extract delta.zip into the publish directory and verify in a staging slot first.")
  lines.push("- For WinForms, treat this package as controlled xcopy validation rather than a direct installer replacement.")
  lines.push("")
  return lines.join("\n")
}

function target(kind: Kind) {
  if (kind === "winforms") return "C:\\apps\\MyWinForms"
  return "C:\\svc\\MyApp\\publish"
}

async function copyApply(job: string) {
  const [{ copyFile, stat }, nodePath] = await Promise.all([fs(), path()])
  const source = nodePath.resolve(process.cwd(), "script", "windows", "apply-delta.ps1")
  const target = nodePath.join(job, "apply-delta.ps1")

  if (!(await exists(source))) return null
  await copyFile(source, target)
  const meta = await stat(target)
  return { file: target, size: meta.size }
}

async function replaceDir() {
  const [{ mkdir }, nodePath] = await Promise.all([fs(), path()])
  const base = process.cwd()
  const dir = nodePath.join(base, "ai_replace")
  await mkdir(dir, { recursive: true })
  return dir
}

async function saveReplaceZip(job: string, project: string, file: string) {
  const [{ copyFile }, nodePath] = await Promise.all([fs(), path()])
  const dir = await replaceDir()
  const name = `${nodePath.basename(job)}-${slug(project)}.zip`
  const target = nodePath.join(dir, name)
  await copyFile(file, target)
  return target
}

async function archiveJob(job: string) {
  const [{ mkdir }, nodePath] = await Promise.all([fs(), path()])
  const dir = nodePath.join(await replaceDir(), "_jobs", nodePath.basename(job))
  await mkdir(dir, { recursive: true })
  return dir
}

function savedZip(job: string, data: Stored) {
  return `${job}-${slug("results" in data ? "merged-delta" : data.project.path)}.zip`
}

async function archiveArtifacts(job: string, data: Stored) {
  const [{ copyFile, mkdir, rm }, nodePath] = await Promise.all([fs(), path()])
  const dir = await archiveJob(job)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const files = [...new Set(listed(data).map((item) => item.name).filter((name) => name !== "delta.zip"))]
  await Promise.all(
    files.map(async (name) => {
      const source = nodePath.join(job, name)
      const target = nodePath.join(dir, name)
      await mkdir(nodePath.dirname(target), { recursive: true })
      await copyFile(source, target)
    }),
  )
}

async function removeCompletedJob(job: string) {
  const { rm } = await fs()
  await rm(job, { recursive: true, force: true })
}

async function resultDir(job: string) {
  const nodePath = await path()
  const live = nodePath.join(await root(), safe(job, "job"))
  if (await exists(nodePath.join(live, "result.json"))) return live
  return archiveJob(job)
}

async function resultFile(job: string, name: string, data: Stored) {
  const nodePath = await path()
  const live = nodePath.join(await root(), job, name)
  if (await exists(live)) return live
  if (name === "delta.zip") return nodePath.join(await replaceDir(), savedZip(job, data))
  return nodePath.join(await archiveJob(job), name)
}
async function mergeBatchPackage(args: {
  job: string
  built: Array<{
    dir: string
    result: Stored
  }>
}) {
  const [{ copyFile, mkdir, readFile, rm, writeFile }, nodePath] = await Promise.all([fs(), path()])
  const dir = nodePath.join(args.job, "delta")
  const zipFile = nodePath.join(args.job, "delta.zip")
  await rm(dir, { recursive: true, force: true })
  await rm(zipFile, { force: true })
  await mkdir(nodePath.join(dir, "add"), { recursive: true })
  await mkdir(nodePath.join(dir, "replace"), { recursive: true })

  const warnings: string[] = []
  const merged = new Map<string, { file: OutputFile; source?: string }>()

  for (const item of args.built) {
    const manifest = JSON.parse(await readFile(nodePath.join(item.dir, "delta", "manifest.json"), "utf8")) as {
      files: OutputFile[]
    }

    for (const file of manifest.files) {
      const path = norm(file.path)
      const hit = merged.get(path)

      if (hit && (hit.file.hash !== file.hash || hit.file.type !== file.type)) {
        warnings.push(`Merged batch delta path collision detected for ${path}; ${item.result.project.path} was used as the winning source.`)
      }

      merged.set(path, {
        file: { ...file, path },
        source: file.type === "remove" ? undefined : nodePath.join(item.dir, "delta", file.type, path),
      })
    }
  }

  const files = [...merged.values()].map((item) => item.file).sort((a, b) => a.path.localeCompare(b.path))
  const remove = files.filter((item) => item.type === "remove").map((item) => item.path)

  await Promise.all(
    [...merged.values()].flatMap((item) => {
      const source = item.source
      if (!source || item.file.type === "remove") return []
      const target = nodePath.join(dir, item.file.type, item.file.path)
      return [mkdir(nodePath.dirname(target), { recursive: true }).then(() => copyFile(source, target))]
    }),
  )

  await writeFile(nodePath.join(dir, "remove.txt"), remove.join("\n") + (remove.length ? "\n" : ""), "utf8")
  await writeFile(
    nodePath.join(dir, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        created_at: new Date().toISOString(),
        counts: {
          total: files.length,
          add: files.filter((item) => item.type === "add").length,
          replace: files.filter((item) => item.type === "replace").length,
          remove: remove.length,
        },
        files,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )

  await zip(dir, zipFile)
  await copyFile(nodePath.join(dir, "manifest.json"), nodePath.join(args.job, "manifest.json"))
  const script = await copyApply(args.job)
  const saved = await saveReplaceZip(args.job, "merged-delta", zipFile)
  warnings.push(`Merged delta package zip was automatically saved to ${saved}.`)

  const id = nodePath.basename(args.job)
  const url = (file: string) => `/api/delta?job=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`
  return {
    warnings: [...new Set(warnings)],
    artifacts: [
      {
        name: "delta.zip",
        label: "merged delta package",
        url: url("delta.zip"),
        size: await size(nodePath.join(args.job, "delta.zip")),
      },
      {
        name: "manifest.json",
        label: "manifest",
        url: url("manifest.json"),
        size: await size(nodePath.join(args.job, "manifest.json")),
      },
      ...(script
        ? [
            {
              name: "apply-delta.ps1",
              label: "Windows apply script",
              url: url("apply-delta.ps1"),
              size: script.size,
            },
          ]
        : []),
    ],
  }
}
async function size(file: string) {
  const { stat } = await fs()
  return stat(file).then((item) => item.size)
}

async function pruneTemporaryFiles(args: {
  job: string
  multi: boolean
  project_dirs?: string[]
}) {
  const [{ rm }, nodePath] = await Promise.all([fs(), path()])
  const targets = [
    nodePath.join(args.job, "repo"),
    nodePath.join(args.job, "delta"),
    nodePath.join(args.job, "publish-from"),
    nodePath.join(args.job, "publish-to"),
    ...(args.multi
      ? [
          nodePath.join(args.job, "batch-publish-from"),
          nodePath.join(args.job, "batch-publish-to"),
        ]
      : []),
    ...((args.project_dirs || []).flatMap((dir) => [
      nodePath.join(dir, "publish-from"),
      nodePath.join(dir, "publish-to"),
      nodePath.join(dir, "delta"),
      nodePath.join(dir, "delta.zip"),
      nodePath.join(dir, "apply-delta.ps1"),
    ])),
  ]

  await Promise.allSettled(targets.map((target) => rm(target, { recursive: true, force: true })))
}

function listed(data: Stored) {
  return "results" in data ? [...data.artifacts, ...data.results.flatMap((item) => item.artifacts)] : data.artifacts
}

function summary(data: { repo: string; from: string; to: string; warnings: string[]; results: ProjectStored[] }) {
  const lines = [
    "# Delta Package Summary",
    "",
    `- Repository: \`${hide(data.repo)}\``,
    `- Commit range: \`${short(data.from)}\` -> \`${short(data.to)}\``,
    `- Projects: ${data.results.length}`,
    "",
    "## Projects",
    ...data.results.map((item) => `- \`${item.project.path}\`: ${item.output.total} files (${item.output.add} add / ${item.output.replace} replace / ${item.output.remove} remove), risk=${item.risk}`),
    "",
  ]

  if (data.warnings.length) {
    lines.push("## Warnings")
    lines.push(...data.warnings.map((item) => `- ${item}`))
    lines.push("")
  }

  lines.push("## Notes")
  lines.push("- The merged batch delta.zip is stored at the job root.")
  lines.push("- Project-level notes and result files are still kept under the projects/ directory for troubleshooting.")
  lines.push("")
  return lines.join("\n")
}

async function buildProject(args: {
  job: string
  key: string
  created: string
  repo_dir: string
  input: DeltaInput
  picked: Candidate
  range: string
  to_ref: string
  from_ref: string
  to_input: string
  from_input?: string
  files: SourceFile[]
  totals: { additions: number; deletions: number }
  info: ProjectInfo[]
  warnings: string[]
  save_zip: boolean
}) {
  const [{ mkdir, rm, writeFile }, nodePath] = await Promise.all([fs(), path()])
  const dir = args.key ? nodePath.join(args.job, "projects", args.key) : args.job
  const prev = nodePath.join(dir, "publish-from")
  const next = nodePath.join(dir, "publish-to")
  await rm(prev, { recursive: true, force: true })
  await rm(next, { recursive: true, force: true })
  await mkdir(prev, { recursive: true })
  await mkdir(next, { recursive: true })

  const warnings = [...args.warnings]
  if (args.picked.kind === "winforms" && process.platform !== "win32") {
    warnings.push("Current environment is not Windows; WinForms publish may fail or may not produce a deployable directory.")
  }

  await checkout(args.repo_dir, args.to_ref)
  const toBuild = await publish(args.repo_dir, args.picked.path, next, args.input)
  warnings.push(...toBuild.warnings)

  const fromBuild = args.from_ref
    ? await (async () => {
        await checkout(args.repo_dir, args.from_ref)
        if (!(await exists(nodePath.join(args.repo_dir, args.picked.path)))) return undefined
        return publish(args.repo_dir, args.picked.path, prev, args.input).then((item) => {
          warnings.push(...item.warnings)
          return item
        })
      })()
    : undefined

  if (!fromBuild) {
    warnings.push("The starting commit does not contain this project file, so the target output will be treated as a first deployment.")
    await rm(prev, { recursive: true, force: true })
    await mkdir(prev, { recursive: true })
  }

  const build_tool = toBuild.tool === "msbuild" || fromBuild?.tool === "msbuild" ? "msbuild" : "dotnet"
  const kept = filter(args.files, args.picked, args.info)
  const matched = blockers(args.files)

  if (kept.assembly.size > 0 || kept.exact.size > 0) {
    warnings.push(`已按源码改动裁剪增量输出，仅保留 ${kept.assembly.size} 个项目程序集和 ${kept.exact.size} 个站点文件路径。`)
  } else if (args.files.length > 0) {
    warnings.push("未识别到可裁剪的发布输出，本次仍按完整发布差异生成增量包。")
  }

  const strategy = mode(args.picked.kind, matched)
  const patch = await pack(dir, prev, next, kept.assembly.size > 0 || kept.exact.size > 0 ? kept : undefined)
  const level = risk(args.picked.kind, matched, args.files, patch.files)
  await zip(nodePath.join(dir, "delta"), patch.zipFile)
  if (args.save_zip) {
    const saved = await saveReplaceZip(args.job, args.picked.path, patch.zipFile)
    warnings.push(`??? zip ?????? ${saved}?`)
  }
  const alert = [...new Set(warnings)]
  const markdown = notes({
    repo: args.input.repo,
    from: args.range,
    to: args.to_ref,
    project: args.picked,
    configuration: args.input.configuration || "Release",
    source: {
      files: args.files,
      additions: args.totals.additions,
      deletions: args.totals.deletions,
      blockers: matched,
    },
    output: {
      files: patch.files,
      add: patch.counts.add,
      replace: patch.counts.replace,
      remove: patch.counts.remove,
    },
    warnings: alert,
    strategy,
    risk: level,
  })

  await writeFile(nodePath.join(dir, "notes.md"), markdown, "utf8")
  await writeFile(nodePath.join(dir, "delta", "notes.md"), markdown, "utf8")
  await writeFile(
    nodePath.join(dir, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        created_at: args.created,
        repo: hide(args.input.repo),
        from: args.range,
        to: args.to_ref,
        project: {
          ...args.picked,
          build_tool,
        },
        risk: level,
        strategy,
        source: {
          additions: args.totals.additions,
          deletions: args.totals.deletions,
          blockers: matched,
          files: args.files,
        },
        output: {
          total: patch.files.length,
          add: patch.counts.add,
          replace: patch.counts.replace,
          remove: patch.counts.remove,
          files: patch.files,
        },
        warnings: alert,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
  await zip(nodePath.join(dir, "delta"), nodePath.join(dir, "delta.zip"))

  const script = await copyApply(dir)
  const prefix = args.key ? `projects/${args.key}/` : ""
  const name = (file: string) => `${prefix}${file}`
  const url = (file: string) => `/api/delta?job=${encodeURIComponent(nodePath.basename(args.job))}&file=${encodeURIComponent(name(file))}`
  const result = {
    job: nodePath.basename(args.job),
    created_at: args.created,
    repo: hide(args.input.repo),
    from: {
      input: args.from_input || `${args.to_input}^1`,
      resolved: args.range,
      short: short(args.range),
    },
    to: {
      input: args.to_input,
      resolved: args.to_ref,
      short: short(args.to_ref),
    },
    project: {
      path: args.picked.path,
      name: args.picked.name,
      kind: args.picked.kind,
      title: args.picked.title,
      configuration: args.input.configuration || "Release",
      build_tool,
    },
    strategy,
    risk: level,
    warnings: alert,
    source: {
      total: args.files.length,
      additions: args.totals.additions,
      deletions: args.totals.deletions,
      blockers: matched,
      files: sample(args.files, 120),
    },
    output: {
      total: patch.files.length,
      add: patch.counts.add,
      replace: patch.counts.replace,
      remove: patch.counts.remove,
      files: sample(patch.files, 120),
    },
    command: `powershell -ExecutionPolicy Bypass -File .\\apply-delta.ps1 -DeltaPath .\\delta.zip -TargetRoot ${target(args.picked.kind)}`,
    artifacts: [
      {
        name: name("delta.zip"),
        label: "delta package",
        url: url("delta.zip"),
        size: await size(nodePath.join(dir, "delta.zip")),
      },
      {
        name: name("manifest.json"),
        label: "manifest",
        url: url("manifest.json"),
        size: await size(nodePath.join(dir, "manifest.json")),
      },
      {
        name: name("notes.md"),
        label: "notes",
        url: url("notes.md"),
        size: await size(nodePath.join(dir, "notes.md")),
      },
      {
        name: name("result.json"),
        label: "result json",
        url: url("result.json"),
        size: 0,
      },
      ...(script
        ? [
            {
              name: name("apply-delta.ps1"),
              label: "Windows apply script",
              url: url("apply-delta.ps1"),
              size: script.size,
            },
          ]
        : []),
    ],
  } satisfies ProjectStored

  await persist(dir, result)
  const artifact = result.artifacts.find((item) => item.name === name("result.json"))
  if (artifact) artifact.size = await size(nodePath.join(dir, "result.json"))
  await persist(dir, result)
  return result
}

async function persist(job: string, data: Stored) {
  const [{ writeFile }, nodePath] = await Promise.all([fs(), path()])
  const file = nodePath.join(job, "result.json")
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8")
}

async function load(job: string) {
  const [{ readFile }, nodePath] = await Promise.all([fs(), path()])
  const file = nodePath.join(job, "result.json")
  const text = await readFile(file, "utf8").catch(() => "")
  if (!text) throw fail(404, "Task result not found.")
  return JSON.parse(text) as Stored
}

export async function createDelta(input: DeltaInput) {
  if (!input.repo?.trim()) throw fail(400, "请先填写 Git 仓库地址。")
  if (!input.to?.trim()) throw fail(400, "请先填写目标提交或标签。")

  await Promise.all([
    run("git", ["--version"]).catch(() => {
      throw fail(500, "git is not available in the current environment, so the test page cannot clone the repository.")
    }),
    run("dotnet", ["--version"]).catch(() => {
      throw fail(500, "dotnet is not available in the current environment, so the test page cannot run publish.")
    }),
  ])

  const [{ mkdtemp }, nodePath, crypto] = await Promise.all([fs(), path(), import("node:crypto")])
  const base = await root()
  await cleanup(base)
  const job = await mkdtemp(nodePath.join(base, `job-${Date.now()}-${crypto.randomUUID().slice(0, 8)}-`))
  const repo = nodePath.join(job, "repo")

  try {
    await run("git", ["clone", input.repo, repo])
    await run("git", ["config", "advice.detachedHead", "false"], repo).catch(() => undefined)

    const toInput = input.to.trim()
    const fromInput = input.from?.trim()
    const toRef = await git(repo, toInput)
    const fromRef = fromInput ? await git(repo, fromInput) : await previous(repo, toRef)
    const range = fromRef || "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    const diff = await Promise.all([
      run("git", ["-c", "core.quotepath=false", "diff", "--name-status", "-M", range, toRef], repo),
      run("git", ["-c", "core.quotepath=false", "diff", "--numstat", range, toRef], repo),
    ])
    const files = source(diff[0].stdout)
    const totals = stat(diff[1].stdout)
    await checkout(repo, toRef)
    const [items, info] = await Promise.all([projects(repo), detail(repo)])
    const picked = choose(items, info, files, input)
    const warnings = [
      ...picked.warnings,
      ...(fromInput
        ? []
        : fromRef
          ? [`未填写起始提交，已自动使用目标提交 ${short(toRef)} 的上一个提交 ${short(fromRef)}。`]
          : ["目标提交没有上一个提交，本次将把当前发布结果视为首次发布。"]),
    ]
    const created = new Date().toISOString()
    const built = [] as Array<{ dir: string; result: ProjectStored }>

    for (const [index, item] of picked.projects.entries()) {
      const key = picked.projects.length > 1 ? `${String(index + 1).padStart(2, "0")}-${slug(item.path)}` : ""
      built.push({
        dir: key ? nodePath.join(job, "projects", key) : job,
        result: await buildProject({
          job,
          key,
          created,
          repo_dir: repo,
          input,
          picked: item,
          range,
          to_ref: toRef,
          from_ref: fromRef,
          to_input: toInput,
          from_input: fromInput,
          files,
          totals,
          info,
          warnings,
          save_zip: picked.projects.length === 1,
        }),
      })
    }

    if (built.length === 1) {
      await archiveArtifacts(job, built[0].result)
      await removeCompletedJob(job)
      return built[0].result
    }

    const results = built.map((item) => ({
      ...item.result,
      artifacts: item.result.artifacts.filter((part) => !part.name.endsWith("delta.zip") && !part.name.endsWith("apply-delta.ps1")),
    }))
    const merged = await mergeBatchPackage({ job, built })

    const { writeFile } = await fs()
    const batchWarnings = [...new Set([...warnings, ...merged.warnings])]
    await writeFile(nodePath.join(job, "summary.md"), summary({ repo: input.repo, from: range, to: toRef, warnings: batchWarnings, results }), "utf8")
    const result = {
      job: nodePath.basename(job),
      created_at: created,
      repo: hide(input.repo),
      from: {
        input: fromInput || `${toInput}^1`,
        resolved: range,
        short: short(range),
      },
      to: {
        input: toInput,
        resolved: toRef,
        short: short(toRef),
      },
      warnings: batchWarnings,
      artifacts: [
        ...merged.artifacts,
        {
          name: "summary.md",
          label: "batch summary",
          url: `/api/delta?job=${encodeURIComponent(nodePath.basename(job))}&file=${encodeURIComponent("summary.md")}`,
          size: await size(nodePath.join(job, "summary.md")),
        },
        {
          name: "result.json",
          label: "result json",
          url: `/api/delta?job=${encodeURIComponent(nodePath.basename(job))}&file=${encodeURIComponent("result.json")}`,
          size: 0,
        },
      ],
      results,
    } satisfies BatchStored

    await persist(job, result)
    const artifact = result.artifacts.find((item) => item.name === "result.json")
    if (artifact) artifact.size = await size(nodePath.join(job, "result.json"))
    await persist(job, result)
    await archiveArtifacts(job, result)
    await removeCompletedJob(job)
    return result
  } catch (error) {
    const next = asError(error)
    if (next.status) throw next
    throw fail(500, next.message)
  }
}

export async function readDelta(job: string) {
  return load(await resultDir(job))
}

export async function fileDelta(job: string, file: string) {
  const [{ readFile }, nodePath] = await Promise.all([fs(), path()])
  const id = safe(job, "job")
  const name = safePath(file, "file")
  const data = await readDelta(id)
  const hit = listed(data).find((item) => item.name === name)
  if (!hit) throw fail(404, "Artifact record not found.")
  const full = await resultFile(id, name, data)
  if (!(await exists(full))) throw fail(404, "Artifact file does not exist.")
  const body = await readFile(full)
  return {
    body,
    name: hit.name,
    type:
      name.endsWith(".zip")
        ? "application/zip"
        : name.endsWith(".json")
          ? "application/json; charset=utf-8"
          : name.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "text/plain; charset=utf-8",
  }
}












