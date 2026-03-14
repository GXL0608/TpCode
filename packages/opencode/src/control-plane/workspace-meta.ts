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

export const BatchMeta = z.object({
  source_root: z.string(),
  members: BatchMember.array(),
})
export type BatchMeta = z.infer<typeof BatchMeta>
