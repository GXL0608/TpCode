import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"

const defaults = {
  TPCODE_ACCOUNT_ENABLED: "1",
  TPCODE_REGISTER_MODE: "open",
  TPCODE_ACCOUNT_JWT_SECRET: "tpcode-local-dev-secret",
  TPCODE_ADMIN_PASSWORD: "TpCode@2026",
  OPENCODE_PG_SYNC_BOOTSTRAP: "remote",
} as const

export function applyServeDefaults() {
  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) process.env[key] = value
  }
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  handler: async (args) => {
    applyServeDefaults()

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    let workspaceSync: Array<ReturnType<typeof Workspace.startSyncing>> = []
    // Only available in development right now
    if (Installation.isLocal()) {
      workspaceSync = Project.list().map((project) => Workspace.startSyncing(project))
    }

    await new Promise(() => {})
    await server.stop()
    await Promise.all(workspaceSync.map((item) => item.stop()))
  },
})
