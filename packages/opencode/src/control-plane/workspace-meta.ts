import z from "zod"

export const WorkspaceKind = z.enum(["single_worktree", "batch_worktree"])
export type WorkspaceKind = z.infer<typeof WorkspaceKind>

export const BatchMember = z.object({
  name: z.string(),
  relative_path: z.string(),
  source_directory: z.string(),
  sandbox_directory: z.string(),
  branch: z.string(),
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
