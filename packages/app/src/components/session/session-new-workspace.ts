type State = {
  label: "session.new.workspace.main" | "session.new.workspace.shared"
  buildHint?: "session.new.workspace.build.main" | "session.new.workspace.build.shared"
}

export function newSessionWorkspaceState(input: {
  directory: string
  projectRoot?: string
  agent?: string
}) {
  const root = input.projectRoot ?? input.directory
  const shared = input.directory !== root
  if (input.agent === "build") {
    return {
      label: shared ? "session.new.workspace.shared" : "session.new.workspace.main",
      buildHint: shared ? "session.new.workspace.build.shared" : "session.new.workspace.build.main",
    } satisfies State
  }
  return {
    label: shared ? "session.new.workspace.shared" : "session.new.workspace.main",
    buildHint: undefined,
  } satisfies State
}
