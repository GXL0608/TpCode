import type { APIEvent } from "@solidjs/start/server"
import { createDelta, fileDelta, readDelta, type DeltaInput } from "~/lib/delta-job"

function error(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      status: "status" in error && typeof error.status === "number" ? error.status : 500,
      candidates: "candidates" in error && Array.isArray(error.candidates) ? error.candidates : undefined,
    }
  }

  return {
    message: String(error),
    status: 500,
  }
}

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const job = url.searchParams.get("job")?.trim()
  const file = url.searchParams.get("file")?.trim()

  if (!job) {
    return Response.json({ error: "请通过 job 参数指定任务编号。" }, { status: 400 })
  }

  try {
    if (file) {
      const asset = await fileDelta(job, file)
      return new Response(asset.body, {
        headers: {
          "content-type": asset.type,
          "content-disposition": `attachment; filename="${asset.name}"`,
        },
      })
    }

    return Response.json(await readDelta(job))
  } catch (next) {
    const result = error(next)
    return Response.json({ error: result.message, candidates: result.candidates }, { status: result.status })
  }
}

export async function POST(event: APIEvent) {
  try {
    const body = (await event.request.json()) as DeltaInput
    return Response.json(await createDelta(body))
  } catch (next) {
    const result = error(next)
    return Response.json({ error: result.message, candidates: result.candidates }, { status: result.status })
  }
}
