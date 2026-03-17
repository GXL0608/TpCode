import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"

describe("Filesystem.driveMountPath", () => {
  afterEach(() => {
    delete process.env.TPCODE_WINDOWS_DRIVE_MAP
    delete process.env.TPCODE_SHARED_MOUNT_ROOT
  })

  test("maps configured Windows drive letters to mounted UNC shares on macOS/Linux", () => {
    process.env.TPCODE_WINDOWS_DRIVE_MAP = "Y=\\\\192.168.1.212\\TPCode"
    process.env.TPCODE_SHARED_MOUNT_ROOT = "/Volumes"

    const result = Filesystem.driveMountPath("Y:\\07慢病系统-JAVA\\后端")

    expect(result).toBe(path.join("/Volumes", "TPCode", "07慢病系统-JAVA", "后端"))
  })

  test("keeps unconfigured Windows drive letters unchanged", () => {
    expect(Filesystem.accessPath("Y:\\07慢病系统-JAVA\\后端")).toBe("Y:\\07慢病系统-JAVA\\后端")
  })
})
