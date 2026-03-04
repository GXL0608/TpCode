const phone = /^1[3-9]\d{9}$/
const letter = /[A-Za-z]/
const digit = /\d/

export const phoneRule = "手机号格式：11 位大陆手机号（示例：13800138000，可输入 +86）"
export const passwordRule = "密码规则：至少 8 位，且包含字母和数字"

function phoneText(input: string) {
  const value = input.trim().replace(/[\s-]/g, "")
  if (value.startsWith("+86")) return value.slice(3)
  if (value.startsWith("86") && value.length === 13) return value.slice(2)
  return value
}

export function phoneValid(input: string) {
  return phone.test(phoneText(input))
}

export function phoneError(input: string) {
  if (!input.trim()) return "请输入手机号"
  if (phoneValid(input)) return ""
  return "手机号格式不正确"
}

export function passwordValid(input: string) {
  if (input.length < 8) return false
  if (!letter.test(input)) return false
  if (!digit.test(input)) return false
  return true
}

export function passwordError(input: string) {
  if (!input) return "请输入密码"
  if (input.length < 8) return "密码至少 8 位"
  if (!letter.test(input)) return "密码需包含字母"
  if (!digit.test(input)) return "密码需包含数字"
  return ""
}
