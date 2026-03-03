#!/usr/bin/env bun

import { TokenUsageService } from "../src/usage/service"
import { Database } from "../src/storage/db"

const parsed = Number(process.argv[2] ?? "")
const batchSize = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 500

console.log(`[token-usage] backfill started, batchSize=${batchSize}`)
const result = await TokenUsageService.backfillStepFinish({ batchSize })
console.log(
  `[token-usage] backfill finished scanned=${result.scanned} written=${result.written} failed=${result.failed}`,
)
await Database.close()
