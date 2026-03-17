import { Database } from "./src/storage/db"
import { AccountProductService } from "./src/user/product"
import { ProductSolutionService } from "./src/user/product-solution"
import { AccountContextService } from "./src/user/context"
import { TpProjectUserAccessTable } from "./src/user/project-user-access.sql"
import { UserService } from "./src/user/service"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"

const tmp = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "ctxprod-"))

async function repo(name: string) {
  const d = path.join(tmp, name)
  await fs.mkdir(d, { recursive: true })
  await $`git init`.cwd(d).quiet()
  await Bun.write(path.join(d, "README.md"), `# ${name}`)
  await $`git add README.md`.cwd(d).quiet()
  await $`git -c user.name=TpCode -c user.email=tpcode@example.com commit -m init`.cwd(d).quiet()
  return d
}

const anchor = await repo("anchor")
const frontend = await repo("frontend")
const backend = await repo("backend")
await UserService.ensureSeed()
const app = (await import("./src/server/server")).Server.App()
const loginRes = await app.request("/account/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "admin", password: process.env.TPCODE_ADMIN_PASSWORD ?? "TpCode@2026" }),
})
const login = await loginRes.json() as any
const user_id = login.user.id as string
const product = await AccountProductService.create({ name: `产品上下文项目_${Date.now()}`, directory: anchor })
console.log("product", product)
if (!product.ok) process.exit(1)
const s1 = await ProductSolutionService.create({
  product_id: product.item.id,
  name: "前端方案",
  code: "frontend_scope",
  build_profile: { workdirs: ["frontend"], compile_command: "echo build", artifact_include: ["dist/**"] },
  roots: [{ root_type: "single_repo", directory: frontend, display_name: "前端", mount_name: "frontend", sort_order: 1 }],
})
const s2 = await ProductSolutionService.create({
  product_id: product.item.id,
  name: "后端方案",
  code: "backend_scope",
  build_profile: { workdirs: ["backend"], compile_command: "echo build", artifact_include: ["dist/**"] },
  roots: [{ root_type: "single_repo", directory: backend, display_name: "后端", mount_name: "backend", sort_order: 2 }],
})
console.log("solution ids", s1.ok && s1.item.primary_project_id, s2.ok && s2.item.primary_project_id)
await Database.use((db) =>
  db.insert(TpProjectUserAccessTable)
    .values([{ project_id: product.item.project_id!, user_id, mode: "allow" }])
    .onConflictDoNothing()
    .run(),
)
for (const project_id of [product.item.project_id, s1.ok ? s1.item.primary_project_id : undefined, s2.ok ? s2.item.primary_project_id : undefined].filter(Boolean) as string[]) {
  AccountContextService.invalidateProjectAccess({ user_id, project_id })
}
const listed = await AccountContextService.listProducts({ user_id })
console.log(JSON.stringify(listed.products.find((x) => x.id === product.item.id), null, 2))
