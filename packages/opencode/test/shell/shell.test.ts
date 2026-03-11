import { describe, expect, test } from "bun:test"
import { Shell } from "../../src/shell/shell"

describe("Shell.info", () => {
  test("classifies Windows bash.exe as posix", () => {
    expect(Shell.info("C:\\Program Files\\Git\\bin\\bash.exe", "win32").family).toBe("posix")
  })

  test("classifies Windows /usr/bin/bash as posix", () => {
    const info = Shell.info("/usr/bin/bash", "win32")
    expect(info.name).toBe("bash")
    expect(info.family).toBe("posix")
  })

  test("classifies Windows cmd.exe as cmd", () => {
    expect(Shell.info("C:\\Windows\\System32\\cmd.exe", "win32").family).toBe("cmd")
  })

  test("classifies Windows powershell.exe as powershell", () => {
    expect(Shell.info("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32").family).toBe(
      "powershell",
    )
  })

  test("classifies Windows pwsh.exe as powershell", () => {
    expect(Shell.info("C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32").family).toBe("powershell")
  })

  test("classifies Linux bash as posix", () => {
    expect(Shell.info("/bin/bash", "linux").family).toBe("posix")
  })

  test("classifies macOS zsh as posix", () => {
    expect(Shell.info("/bin/zsh", "darwin").family).toBe("posix")
  })

  test("falls back unknown Windows shells to cmd", () => {
    expect(Shell.info("C:\\tools\\unknown-shell.exe", "win32").family).toBe("cmd")
  })

  test("falls back unknown Unix shells to posix", () => {
    expect(Shell.info("/opt/custom-shell", "linux").family).toBe("posix")
  })
})
