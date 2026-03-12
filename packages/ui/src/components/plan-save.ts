import type { AfterSavePlanFn, SavePlanFn, SavePlanSuccess } from "../context/data"

type Input = {
  saving: boolean
  sessionID: string
  messageID: string
  partID: string
  savePlan?: SavePlanFn
  afterSavePlan?: AfterSavePlanFn
  onSaving: (value: boolean) => void
  onSaved: () => void
}

/**
 * 直接提交计划保存，并在保存成功后触发后置反馈流程。
 */
export async function submitPlanSave(input: Input): Promise<SavePlanSuccess | false> {
  if (input.saving) return false
  const fn = input.savePlan
  if (!fn) return false

  input.onSaving(true)
  const result = await fn({
    sessionID: input.sessionID,
    messageID: input.messageID,
    partID: input.partID,
  })
  input.onSaving(false)

  if (!result.ok) return false

  input.onSaved()
  await input.afterSavePlan?.(result)
  return result
}
