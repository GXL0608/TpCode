import { ProductSolutionService } from "../src/user/product-solution"

/** 中文注释：执行历史解决方案绑定关系回填，并打印本次迁移统计结果。 */
async function main() {
  const product_ids = Bun.argv.slice(2).map((item) => item.trim()).filter(Boolean)
  console.log(
    `[product-solution-binding] backfill started${product_ids.length > 0 ? ` product_ids=${product_ids.join(",")}` : ""}`,
  )
  const result = await ProductSolutionService.backfillBindings({
    product_ids,
  })
  console.log(`[product-solution-binding] backfill finished scanned=${result.scanned} created=${result.created}`)
}

await main()
