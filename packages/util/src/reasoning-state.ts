export type ReasoningState = {
  open: boolean
  manual: true
}

export function resolveReasoningOpen(state: ReasoningState | undefined, working: boolean) {
  if (state?.manual) return state.open
  return working
}

export function resolveReasoningLabel(working: boolean) {
  return working ? "thinking" : "completed"
}

export function setReasoningManual(open: boolean): ReasoningState {
  return {
    open,
    manual: true,
  }
}
