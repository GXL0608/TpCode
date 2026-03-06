declare module "oracledb" {
  export type BindParameters = Record<string, string | number>

  export type ExecuteOptions = {
    autoCommit?: boolean
  }

  export type ExecuteResult = {
    rowsAffected?: number
  }

  export type Connection = {
    execute(sql: string, binds?: BindParameters, options?: ExecuteOptions): Promise<ExecuteResult>
    close(): Promise<void>
  }

  export function getConnection(input: {
    user: string
    password: string
    connectString: string
  }): Promise<Connection>
}
