import z from "zod"

export const WorkspaceKind = z.enum(["single_worktree", "batch_worktree"])
export type WorkspaceKind = z.infer<typeof WorkspaceKind>

export const BatchMember = z.object({
  name: z.string(),
  relative_path: z.string(),
  source_directory: z.string(),
  sandbox_directory: z.string(),
  branch: z.string(),
  source_kind: z.enum(["git", "copy"]).optional(),
  base_ref: z.string().optional(),
  default_branch: z.string().optional(),
  status: z.enum(["ready", "failed"]),
})
export type BatchMember = z.infer<typeof BatchMember>

export const BatchOverlayMount = z.object({
  solution_id: z.string(),
  solution_code: z.string(),
  mount_name: z.string(),
  source_directory: z.string(),
  overlay_directory: z.string(),
  // 中文注释：标记当前挂载来自 git worktree 还是普通复制目录，供 overlay 精确选择变更采集方式。
  source_kind: z.enum(["git", "copy"]).optional(),
})
export type BatchOverlayMount = z.infer<typeof BatchOverlayMount>

export const BatchOverlay = z.object({
  root: z.string(),
  manifest_path: z.string(),
  mounts: BatchOverlayMount.array(),
})
export type BatchOverlay = z.infer<typeof BatchOverlay>

export const BatchMeta = z.object({
  source_root: z.string().optional(),
  source_roots: z.array(z.string()).default([]),
  members: BatchMember.array(),
  overlay: BatchOverlay.optional(),
})
export type BatchMeta = z.infer<typeof BatchMeta>
