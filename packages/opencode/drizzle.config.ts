import { defineConfig } from "drizzle-kit"
import { pgUrl } from "./src/storage/pg-url"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: pgUrl(process.env, (process.env.OPENCODE_CHANNEL ?? "local") === "local"),
  },
})
