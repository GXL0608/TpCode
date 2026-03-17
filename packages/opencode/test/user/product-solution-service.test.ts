import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Database } from "../../src/storage/db"
import { TpProductSolutionBindingTable } from "../../src/user/product-solution-binding.sql"
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

/** 中文注释：按共享目录组件拼装稳定 UNC 路径，避免测试源码中的中文路径被反斜杠转义干扰。 */
function unc(...parts: string[]) {
  return ["", "", "192.168.1.202", ...parts].join("\\")
}

describe("product solution service", () => {
  afterEach(async () => {
    delete process.env.TPCODE_SHARED_MOUNT_ROOT
    await Database.use(async (db) => {
      await db.delete(TpProductSolutionRootTable).run()
      await db.delete(TpProductSolutionBindingTable).run()
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
          mount_name: "frontend-app",
          sort_order: 1,
        },
        {
          root_type: "single_repo",
          directory: backend,
          display_name: "后端",
          mount_name: "backend-api",
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
    expect(listed[0]?.roots.map((item) => item.mount_name)).toEqual(["frontend-app", "backend-api"])
    expect(listed[0]?.build_profile.compile_command).toBe("echo build")
  })

  test("allows products without bound directories and derives anchor project from solutions", async () => {
    await using tmp = await tmpdir()
    const frontend = await createRepo(tmp.path, "virtual-product-frontend")

    const product = await AccountProductService.create({
      name: "虚拟产品",
      directory: "",
    })

    expect(product.ok).toBe(true)
    if (!product.ok) return
    expect(product.item.project_id).toBeUndefined()

    const solution = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "虚拟产品前端",
      code: "virtual-product-frontend",
      build_profile: {
        workdirs: ["frontend"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: frontend,
          display_name: "前端",
          mount_name: "frontend",
          sort_order: 1,
        },
      ],
    })

    expect(solution.ok).toBe(true)
    if (!solution.ok) return
    const listed = await AccountProductService.list()
    const item = listed.find((row) => row.id === product.item.id)

    expect(item?.project_id).toBeTruthy()
    expect(item?.worktree).toBe(frontend)
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

  test("accepts UNC solution roots for products without bound directories", async () => {
    await using tmp = await tmpdir()
    process.env.TPCODE_SHARED_MOUNT_ROOT = tmp.path
    const share = path.join(tmp.path, "共享", "test_project", "aaa")
    await fs.mkdir(share, { recursive: true })

    const product = await AccountProductService.create({
      name: "UNC虚拟产品",
      directory: "",
    })

    expect(product.ok).toBe(true)
    if (!product.ok) return

    const created = await ProductSolutionService.create({
      product_id: product.item.id,
      name: "UNC目录方案",
      code: "unc-folder-solution",
      build_profile: {
        workdirs: ["aaa"],
        compile_command: "true",
        artifact_include: ["a.txt"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: unc("共享", "test_project", "aaa"),
          display_name: "UNC共享目录",
          mount_name: "aaa",
          sort_order: 1,
        },
      ],
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.item.roots[0]?.directory).toBe(unc("共享", "test_project", "aaa"))

    const listed = await AccountProductService.list()
    const item = listed.find((row) => row.id === product.item.id)
    expect(item?.project_id).toBeTruthy()
    expect(item?.worktree).toBe(share)
  })

  test("allows one solution to be bound by multiple products", async () => {
    await using tmp = await tmpdir()
    const productARepo = await createRepo(tmp.path, "product-a")
    const productBRepo = await createRepo(tmp.path, "product-b")
    const sharedApi = await createRepo(tmp.path, "shared-api")

    const productA = await AccountProductService.create({
      name: "产品A",
      directory: productARepo,
    })
    const productB = await AccountProductService.create({
      name: "产品B",
      directory: productBRepo,
    })

    expect(productA.ok).toBe(true)
    expect(productB.ok).toBe(true)
    if (!productA.ok || !productB.ok) return

    const solution = await ProductSolutionService.create({
      product_id: productA.item.id,
      name: "共享API",
      code: "shared-api",
      build_profile: {
        workdirs: ["shared-api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: sharedApi,
          display_name: "shared-api",
          sort_order: 1,
        },
      ],
    })

    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const bound = await ProductSolutionService.bind({
      product_id: productB.item.id,
      solution_id: solution.item.id,
    })

    expect(bound.ok).toBe(true)
    if (!bound.ok) return

    const productASolutions = await ProductSolutionService.list(productA.item.id)
    const productBSolutions = await ProductSolutionService.list(productB.item.id)

    expect(productASolutions).toHaveLength(1)
    expect(productBSolutions).toHaveLength(1)
    expect(productASolutions[0]?.id).toBe(solution.item.id)
    expect(productBSolutions[0]?.id).toBe(solution.item.id)

    const products = await AccountProductService.list()
    const itemA = products.find((item) => item.id === productA.item.id)
    const itemB = products.find((item) => item.id === productB.item.id)

    expect(itemA?.solutions?.map((item) => item.id)).toEqual([solution.item.id])
    expect(itemB?.solutions?.map((item) => item.id)).toEqual([solution.item.id])
  })

  test("unbinds a shared solution from one product without removing the solution", async () => {
    await using tmp = await tmpdir()
    const productARepo = await createRepo(tmp.path, "unbind-product-a")
    const productBRepo = await createRepo(tmp.path, "unbind-product-b")
    const sharedApi = await createRepo(tmp.path, "unbind-shared-api")

    const productA = await AccountProductService.create({
      name: "解绑产品A",
      directory: productARepo,
    })
    const productB = await AccountProductService.create({
      name: "解绑产品B",
      directory: productBRepo,
    })

    expect(productA.ok).toBe(true)
    expect(productB.ok).toBe(true)
    if (!productA.ok || !productB.ok) return

    const solution = await ProductSolutionService.create({
      product_id: productA.item.id,
      name: "解绑共享API",
      code: "unbind-shared-api",
      build_profile: {
        workdirs: ["unbind-shared-api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: sharedApi,
          display_name: "解绑共享API",
          mount_name: "unbind-shared-api",
          sort_order: 1,
        },
      ],
    })

    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const bound = await ProductSolutionService.bind({
      product_id: productB.item.id,
      solution_id: solution.item.id,
    })

    expect(bound.ok).toBe(true)
    if (!bound.ok) return

    const removed = await ProductSolutionService.unbind({
      product_id: productA.item.id,
      solution_id: solution.item.id,
    })

    expect(removed.ok).toBe(true)

    const productASolutions = await ProductSolutionService.list(productA.item.id)
    const productBSolutions = await ProductSolutionService.list(productB.item.id)
    const item = await ProductSolutionService.get(solution.item.id)

    expect(productASolutions).toHaveLength(0)
    expect(productBSolutions).toHaveLength(1)
    expect(productBSolutions[0]?.id).toBe(solution.item.id)
    expect(item?.id).toBe(solution.item.id)
  })

  test("lists solution library without duplicating shared bindings", async () => {
    await using tmp = await tmpdir()
    const productARepo = await createRepo(tmp.path, "library-product-a")
    const productBRepo = await createRepo(tmp.path, "library-product-b")
    const sharedApi = await createRepo(tmp.path, "library-shared-api")

    const productA = await AccountProductService.create({
      name: "方案库产品A",
      directory: productARepo,
    })
    const productB = await AccountProductService.create({
      name: "方案库产品B",
      directory: productBRepo,
    })

    expect(productA.ok).toBe(true)
    expect(productB.ok).toBe(true)
    if (!productA.ok || !productB.ok) return

    const solution = await ProductSolutionService.create({
      product_id: productA.item.id,
      name: "方案库共享API",
      code: "library-shared-api",
      build_profile: {
        workdirs: ["library-shared-api"],
        compile_command: "echo build",
        artifact_include: ["dist/**"],
      },
      roots: [
        {
          root_type: "single_repo",
          directory: sharedApi,
          display_name: "方案库共享API",
          mount_name: "library-shared-api",
          sort_order: 1,
        },
      ],
    })

    expect(solution.ok).toBe(true)
    if (!solution.ok) return

    const bound = await ProductSolutionService.bind({
      product_id: productB.item.id,
      solution_id: solution.item.id,
    })

    expect(bound.ok).toBe(true)
    if (!bound.ok) return

    const library = await ProductSolutionService.listLibrary()

    expect(library).toHaveLength(1)
    expect(library[0]?.id).toBe(solution.item.id)
  })

  test("backfill bindings becomes a no-op after legacy solution fields are removed", async () => {
    const first = await ProductSolutionService.backfillBindings()
    const second = await ProductSolutionService.backfillBindings()

    expect(first.created).toBe(0)
    expect(first.scanned).toBe(0)
    expect(second.created).toBe(0)
    expect(second.scanned).toBe(0)
  })
})
