import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BuildOverlay } from "../../src/build/overlay"
import { tmpdir } from "../fixture/fixture"
import { Glob } from "../../src/util/glob"

/** 中文注释：创建最小源码目录，供 overlay 合并视图和写入行为测试复用。 */
async function createSource(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await Bun.write(path.join(directory, "source.txt"), `${name}-source\n`)
  await Bun.write(path.join(directory, "keep.txt"), `${name}-keep\n`)
  await fs.mkdir(path.join(directory, "nested"), { recursive: true })
  await Bun.write(path.join(directory, "nested", "child.txt"), `${name}-child\n`)
  return directory
}

describe("build overlay", () => {
  afterEach(() => {
    mock.restore()
  })

  test("把源码绝对路径重新映射回当前 overlay 挂载目录", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    const overlay = await BuildOverlay.create({
      root: path.join(tmp.path, "overlay"),
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    expect(
      BuildOverlay.remapSourcePath({
        overlay,
        filePath: path.join(source, "nested", "child.txt"),
      }),
    ).toBe(path.join(overlay.root, "frontend", "nested", "child.txt"))
  })

  test("兼容 Windows 盘符路径的正反斜杠混用映射", async () => {
    const overlay = BuildOverlay.Info.parse({
      root: "/tmp/overlay-root",
      manifest_path: "/tmp/overlay-root/.tpcode-overlay-manifest.json",
      mounts: [
        {
          solution_id: "solution_cshis",
          solution_code: "cshis",
          mount_name: "CSHIS",
          source_directory: "Y:\\02HIS-CS\\CSHIS",
          overlay_directory: "/tmp/overlay-root/CSHIS",
        },
      ],
    })

    expect(
      BuildOverlay.remapSourcePath({
        overlay,
        filePath: "Y:/02HIS-CS/CSHIS/TPHY.UWin.HIS2Station/XtraFormLogin.cs",
      }),
    ).toBe(path.join("/tmp/overlay-root", "CSHIS", "TPHY.UWin.HIS2Station", "XtraFormLogin.cs"))
  })

  test("从源码视图读取文件，但只在 overlay 内保存修改文件", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    const overlay = await BuildOverlay.create({
      root: path.join(tmp.path, "overlay"),
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    const sourcePath = path.join(overlay.root, "frontend", "source.txt")
    expect(await BuildOverlay.readText({ overlay, filePath: sourcePath })).toBe("frontend-source\n")

    await BuildOverlay.writeText({
      overlay,
      filePath: sourcePath,
      content: "frontend-changed\n",
    })

    expect(await Bun.file(path.join(source, "source.txt")).text()).toBe("frontend-source\n")
    expect(await Bun.file(sourcePath).text()).toBe("frontend-changed\n")
    expect(await Bun.file(path.join(overlay.root, "frontend", "keep.txt")).exists()).toBe(false)

    const changes = await BuildOverlay.listChanges(overlay)
    expect(
      changes.map((item) => ({
        mount_name: item.mount_name,
        relative_path: item.relative_path,
        change_type: item.change_type,
      })),
    ).toEqual([
      {
        mount_name: "frontend",
        relative_path: "source.txt",
        change_type: "update",
      },
    ])
  })

  test("目录列表合并源码与 overlay，并隐藏删除标记文件", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    const overlay = await BuildOverlay.create({
      root: path.join(tmp.path, "overlay"),
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    await BuildOverlay.writeText({
      overlay,
      filePath: path.join(overlay.root, "frontend", "created.txt"),
      content: "created\n",
    })
    await BuildOverlay.deletePath({
      overlay,
      filePath: path.join(overlay.root, "frontend", "keep.txt"),
    })

    expect(await BuildOverlay.listDirectory({ overlay, directory: path.join(overlay.root, "frontend") })).toEqual([
      "created.txt",
      "nested/",
      "source.txt",
    ])
  })

  test("按 glob 前缀扫描时会跳过常见产物目录，避免把 node_modules 命中进结果", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    await fs.mkdir(path.join(source, "node_modules"), { recursive: true })
    await Bun.write(path.join(source, "node_modules", "LoginFake.txt"), "ignore\n")
    await fs.mkdir(path.join(source, "pages"), { recursive: true })
    await Bun.write(path.join(source, "pages", "LoginPage.txt"), "hit\n")
    const overlay = await BuildOverlay.create({
      root: path.join(tmp.path, "overlay"),
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    expect(
      await BuildOverlay.scanFiles({
        overlay,
        directory: overlay.root,
        pattern: "frontend/**/*Login*",
      }),
    ).toEqual([path.join(overlay.root, "frontend", "pages", "LoginPage.txt")])
  })

  test("扫描器异常返回空结果时仍保留 manifest 中已登记的改动", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    const overlay = await BuildOverlay.create({
      root: path.join(tmp.path, "overlay"),
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    const sourcePath = path.join(overlay.root, "frontend", "source.txt")
    await BuildOverlay.writeText({
      overlay,
      filePath: sourcePath,
      content: "frontend-changed\n",
    })

    spyOn(Glob, "scan").mockResolvedValue([])

    expect(
      (await BuildOverlay.listChanges(overlay)).map((item) => ({
        mount_name: item.mount_name,
        relative_path: item.relative_path,
        change_type: item.change_type,
      })),
    ).toEqual([
      {
        mount_name: "frontend",
        relative_path: "source.txt",
        change_type: "update",
      },
    ])
  })

  test("可以根据已写入 overlay 的文件路径补偿恢复 manifest", async () => {
    await using tmp = await tmpdir()
    const source = await createSource(tmp.path, "frontend")
    const overlay_root = path.join(tmp.path, "overlay")
    const overlay = await BuildOverlay.create({
      root: overlay_root,
      mounts: [
        {
          solution_id: "solution_frontend",
          solution_code: "frontend",
          mount_name: "frontend",
          source_directory: source,
        },
      ],
    })

    await Bun.write(path.join(overlay.root, "frontend", "source.txt"), "frontend-git-change\n")
    await Bun.write(overlay.manifest_path, JSON.stringify({ version: 1, changes: [] }, null, 2))

    await BuildOverlay.recordPaths({
      overlay,
      files: [path.join(overlay.root, "frontend", "source.txt")],
    })

    expect(
      (await BuildOverlay.listChanges(overlay)).map((item) => ({
        mount_name: item.mount_name,
        relative_path: item.relative_path,
        change_type: item.change_type,
      })),
    ).toEqual([
      {
        mount_name: "frontend",
        relative_path: "source.txt",
        change_type: "update",
      },
    ])
  })
})
