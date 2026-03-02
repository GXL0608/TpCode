export namespace UserPassword {
  export async function hash(input: string) {
    return Bun.password.hash(input)
  }

  export async function verify(input: string, hash: string) {
    return Bun.password.verify(input, hash)
  }

  export function valid(input: string) {
    if (input.length < 8) return false
    return true
  }
}
