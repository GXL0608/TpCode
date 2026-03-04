import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { Flag } from "@/flag/flag"

type Data = {
  project_scan_root?: string
}

const filepath = path.join(Global.Path.data, "tp-system-settings.json")

async function read() {
  return (await Filesystem.readJson<Data>(filepath).catch(() => undefined)) ?? {}
}

async function write(data: Data) {
  await Filesystem.writeJson(filepath, data, 0o600)
}

export namespace AccountSystemSettingService {
  export async function projectScanRoot() {
    const env = Flag.TPCODE_PROJECT_SCAN_ROOT?.trim()
    if (env) return { project_scan_root: env, source: "env" as const }
    const data = await read()
    const value = data.project_scan_root?.trim()
    if (value) return { project_scan_root: value, source: "setting" as const }
    return { project_scan_root: "", source: "default" as const }
  }

  export async function setProjectScanRoot(input: { project_scan_root?: string }) {
    const value = input.project_scan_root?.trim() ?? ""
    const data = await read()
    if (value) data.project_scan_root = value
    else delete data.project_scan_root
    await write(data)
    if (value) process.env["TPCODE_PROJECT_SCAN_ROOT"] = value
    else delete process.env["TPCODE_PROJECT_SCAN_ROOT"]
    return { ok: true as const, project_scan_root: value || undefined }
  }
}
