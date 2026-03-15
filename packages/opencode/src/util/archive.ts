import { $ } from "bun"
import path from "path"

export namespace Archive {
  /** 中文注释：跨平台创建 zip 压缩包，Windows 走 PowerShell，其他系统走 zip 命令。 */
  export async function createZip(input: { sourceDir: string; output: string }) {
    const sourceDir = path.resolve(input.sourceDir)
    const output = path.resolve(input.output)
    if (process.platform === "win32") {
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${path.join(sourceDir, "*")}' -DestinationPath '${output}' -Force`
      await $`powershell -NoProfile -NonInteractive -Command ${cmd}`.quiet()
      return
    }
    await $`zip -qr ${output} .`.quiet().cwd(sourceDir)
  }

  export async function extractZip(zipPath: string, destDir: string) {
    if (process.platform === "win32") {
      const winZipPath = path.resolve(zipPath)
      const winDestDir = path.resolve(destDir)
      // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
      const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
      await $`powershell -NoProfile -NonInteractive -Command ${cmd}`.quiet()
    } else {
      await $`unzip -o -q ${zipPath} -d ${destDir}`.quiet()
    }
  }
}
