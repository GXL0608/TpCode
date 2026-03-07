const NON_EMPTY_TEXT = /[^\s\u200B]/

export function hasPromptText(raw: string) {
  return NON_EMPTY_TEXT.test(raw)
}

export function shouldResetPromptDraft(input: {
  raw: string
  has_non_text: boolean
  image_count: number
  voice_count: number
}) {
  if (input.has_non_text) return false
  if (hasPromptText(input.raw)) return false
  if (input.image_count > 0) return false
  return input.voice_count === 0
}

export function shouldClearVoiceDraft(input: {
  raw: string
  has_non_text: boolean
  image_count: number
  voice_count: number
}) {
  if (input.has_non_text) return false
  if (hasPromptText(input.raw)) return false
  if (input.image_count > 0) return false
  return input.voice_count > 0
}
