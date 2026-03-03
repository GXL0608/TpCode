export {}

type RunResult = {
  changes: number
  lastInsertRowid: number
}

declare module "drizzle-orm/query-promise" {
  interface QueryPromise<T> {
    run(values?: Record<string, unknown>): Promise<RunResult>
    all(values?: Record<string, unknown>): Promise<T>
    get(
      values?: Record<string, unknown>,
    ): Promise<T extends Array<infer U> ? U | undefined : T extends readonly (infer U)[] ? U | undefined : unknown>
  }
}
