import { WorktreeAdaptor } from "./worktree"
import type { Config } from "../config"
import type { Adaptor } from "./types"

export function getAdaptor(config: Config): Adaptor {
  switch (config.type) {
    case "worktree":
      return WorktreeAdaptor
    case "batch_worktree":
      return {
        async create() {
          throw new Error("batch_worktree must be created through Workspace.createBatch")
        },
        async remove() {
          throw new Error("batch_worktree must be removed through Workspace.removeBatch")
        },
        async request() {
          throw new Error("batch_worktree does not support request")
        },
      }
  }
}
