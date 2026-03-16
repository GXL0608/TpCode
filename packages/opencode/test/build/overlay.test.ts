import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { BuildOverlay } from "../../src/build/overlay"
import { tmpdir } from "../fixture/fixture"

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
})
