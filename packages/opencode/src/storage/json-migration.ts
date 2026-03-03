export namespace JsonMigration {
  export type Stats = {
    projects: number
    sessions: number
    messages: number
    parts: number
    todos: number
    permissions: number
    shares: number
    errors: string[]
  }

  export async function run(_db: unknown): Promise<Stats> {
    throw new Error("JSON migration is removed in PostgreSQL-only mode.")
  }
}
