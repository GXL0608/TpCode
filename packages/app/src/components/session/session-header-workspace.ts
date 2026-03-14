import type { Session } from "@opencode-ai/sdk/v2/client"

type WorkspaceSession = Partial<
  Pick<
  Session,
  "workspaceDirectory" | "workspaceBranch" | "workspaceKind" | "workspaceStatus" | "workspaceCleanupStatus" | "workspaceSummary"
  >
>

type State = {
  tone: "neutral" | "success" | "warning" | "error"
  label: "session.header.workspace.main" | "session.header.workspace.isolated" | "session.header.workspace.preparing" | "session.header.workspace.error"
}

export function workspaceState(input: { session?: WorkspaceSession; directory: string; projectRoot?: string }) {
  const session = input.session
  if (!session || !input.directory) return
  const root = input.projectRoot ?? input.directory
  const workspace = session.workspaceDirectory

  if (!workspace) {
    return {
      tone: "neutral",
      label: "session.header.workspace.main",
    } satisfies State
  }

  if (session.workspaceCleanupStatus === "failed") {
    return {
      tone: "error",
      label: "session.header.workspace.error",
    } satisfies State
  }

  if (session.workspaceStatus && session.workspaceStatus !== "ready") {
    return {
      tone: "warning",
      label: "session.header.workspace.preparing",
    } satisfies State
  }

  if (input.directory === workspace && workspace !== root) {
    return {
      tone: "success",
      label: "session.header.workspace.isolated",
    } satisfies State
  }

  if (workspace === root) {
    return {
      tone: "neutral",
      label: "session.header.workspace.main",
    } satisfies State
  }

  return {
    tone: "error",
    label: "session.header.workspace.error",
  } satisfies State
}

export function workspaceLines(input: { session: WorkspaceSession; directory: string; projectRoot?: string }) {
  const root = input.projectRoot ?? input.directory
  return {
    directory: input.directory,
    projectRoot: root,
    branch: input.session.workspaceBranch,
    kind: input.session.workspaceKind,
    summary: input.session.workspaceSummary,
    status: input.session.workspaceStatus,
  }
}
