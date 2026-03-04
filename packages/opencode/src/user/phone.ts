export namespace UserPhone {
  const rule = /^1[3-9]\d{9}$/

  export function normalize(input: string) {
    const value = input.trim().replace(/[\s-]/g, "")
    const phone =
      value.startsWith("+86")
        ? value.slice(3)
        : value.startsWith("86") && value.length === 13
          ? value.slice(2)
          : value
    if (!rule.test(phone)) return
    return phone
  }
}
