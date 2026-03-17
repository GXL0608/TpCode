import { Workspace } from "@/control-plane/workspace"
import { type ProductSolutionItem } from "@/user/product-solution"
import { BuildOverlay } from "./overlay"

export namespace BuildCompileSandbox {
  export type Member = {
    directory: string
    name: string
    relative_path: string
    solution_id: string
    solution_code: string
  }

  /** 中文注释：为单个解决方案创建独立 compile sandbox，并在进入编译前应用 overlay 变更。 */
  export async function create(input: {
    projectID: string
    name: string
    sourceRoots: string[]
    members: Member[]
    overlay: BuildOverlay.Info
    changes: BuildOverlay.Change[]
    solution: ProductSolutionItem
  }) {
    const workspace = await Workspace.createBatch({
      projectID: input.projectID,
      sourceRoots: input.sourceRoots,
      members: input.members.map((item) => ({
        directory: item.directory,
        name: item.name,
        relative_path: item.relative_path,
      })),
      name: input.name,
    })
    const ready = workspace.meta?.members ?? []
    const applied = [] as BuildOverlay.Change[]
    for (const member of ready) {
      const changes = await BuildOverlay.applyToMount({
        overlay: input.overlay,
        changes: input.changes,
        solution_id: input.solution.id,
        mount_name: member.relative_path,
        target_directory: member.sandbox_directory,
      })
      applied.push(...changes)
    }
    return {
      workspace,
      applied,
    }
  }

  /** 中文注释：编译结束后清理独立 compile sandbox，避免磁盘持续累积完整工作副本。 */
  export async function remove(workspaceID: string) {
    await Workspace.removeBatch(workspaceID).catch(() => undefined)
  }
}
