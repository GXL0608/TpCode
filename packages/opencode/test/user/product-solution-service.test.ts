import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Database } from "../../src/storage/db"
import { TpProductTable } from "../../src/user/product.sql"
import { TpProductSolutionRootTable } from "../../src/user/product-solution-root.sql"
import { TpProductSolutionTable } from "../../src/user/product-solution.sql"
import { AccountProductService } from "../../src/user/product"
import { ProductSolutionService } from "../../src/user/product-solution"
import { tmpdir } from "../fixture/fixture"

/** 中文注释：创建一个最小 git 仓库目录，供产品与解决方案测试复用。 */
async function createRepo(root: string, name: string) {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await $`git init`.cwd(directory).quiet()
  await Bun.write(path.join(directory, "README.md"), `# ${name}\n`)
  await $`git add README.md`.cwd(directory).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m ${`init ${name}`}`.cwd(directory).quiet()
  return directory
}

describe("product solution service", () => {
  afterEach(async () => {
    await Database.use(async (db) => {
      await db.delete(TpProductSolutionRootTable).run()
      await db.delete(TpProductSolutionTable).run()
      await db.delete(TpProductTable).run()
    })
  })

  test("creates a product solution with multiple roots and returns nested roots in list", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "frontend")
    const backend = await createRepo(tmp.path, "backend")

    const product = await AccountProductService.create({
      name: "院感系统",
      directory: frontend,
    })

    expect(product.ok).toBe(true)
    if (!product.ok) return

    const created = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "基础平台",
      code: "base-platform",
      build_profile: {
        workdirs: ["."],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          sort_order: 1,
        },
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          sort_order: 2,
        },
      ],
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.item.roots).toHaveLength(2)

    const listed = await ProductSolutionService.list(product.item.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe("基础平台")
    expect(listed[0]?.roots.map((item) => item.display_name)).toEqual(["前端", "后端"])
    expect(listed[0]?.build_profile.compile_command).toBe("echo build")
  })

  test("supports virtual_group roots with explicit member directories", async () => {
    await using tmp = await tmpdir()
    const shared = await createRepo(tmp.path, "shared-backend")
    const api = await createRepo(tmp.path, "shared-api")

    const product = await AccountProductService.create({
      name: "医护系统",
      directory: shared,
    })

    expect(product.ok).toBe(true)
    if (!product.ok) return

    const created = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "共享后端",
      code: "shared-backend",
      build_profile: {
        workdirs: ["shared-backend", "shared-api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "virtual_group",
          directory: "shared-group",
          display_name: "共享目录组",
          sort_order: 1,
          meta: {
            directories: [shared, api],
          },
        },
      ],
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.item.roots[0]?.meta?.directories).toEqual([shared, api])
  })
})
