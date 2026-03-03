import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    url: process.env.OPENCODE_DATABASE_URL ?? process.env.OPENCODE_PG_URL ?? "postgres://opencode:opencode@182.92.74.187:9124/opencode",
  },
})
