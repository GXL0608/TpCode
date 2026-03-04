export namespace UserPassword {
  const letter = /[A-Za-z]/
  const digit = /\d/

  export async function hash(input: string) {
    return Bun.password.hash(input)
  }

  export async function verify(input: string, hash: string) {
    return Bun.password.verify(input, hash)
  }

  export function valid(input: string) {
    if (input.length < 8) return false
    if (!letter.test(input)) return false
    if (!digit.test(input)) return false
    return true
  }
}
