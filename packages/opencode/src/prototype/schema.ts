import z from "zod"

export const PrototypeSourceType = z.enum(["manual_upload", "playwright_capture"]).meta({
  ref: "PrototypeSourceType",
})

export const PrototypeStatus = z.enum(["ready", "archived", "deleted"]).meta({
  ref: "PrototypeStatus",
})

export const PrototypeTestResult = z.enum(["passed", "failed", "unknown"]).meta({
  ref: "PrototypeTestResult",
})

export const PrototypeVariant = z.enum(["original", "thumbnail"]).meta({
  ref: "PrototypeVariant",
})

export const PrototypeViewport = z
  .object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    device_scale_factor: z.number().int().positive().optional(),
  })
  .meta({
    ref: "PrototypeViewport",
  })

export const PrototypeItem = z
  .object({
    id: z.string(),
    session_id: z.string(),
    message_id: z.string().optional(),
    user_id: z.string().optional(),
    org_id: z.string().optional(),
    department_id: z.string().optional(),
    agent_mode: z.string(),
    title: z.string(),
    description: z.string().optional(),
    route: z.string().optional(),
    page_key: z.string(),
    viewport_width: z.number().optional(),
    viewport_height: z.number().optional(),
    device_scale_factor: z.number().optional(),
    mime: z.string(),
    size_bytes: z.number(),
    storage_driver: z.string(),
    storage_key: z.string(),
    image_url: z.string(),
    thumbnail_url: z.string(),
    source_type: PrototypeSourceType,
    source_url: z.string().optional(),
    test_run_id: z.string().optional(),
    test_result: PrototypeTestResult.optional(),
    version: z.number(),
    is_latest: z.boolean(),
    status: PrototypeStatus,
    time_created: z.number(),
    time_updated: z.number(),
  })
  .meta({
    ref: "PrototypeItem",
  })

export const PrototypeListResult = z
  .object({
    items: z.array(PrototypeItem),
  })
  .meta({
    ref: "PrototypeListResult",
  })

export const PrototypeDetailResult = z
  .object({
    ok: z.literal(true),
    prototype: PrototypeItem,
  })
  .meta({
    ref: "PrototypeDetailResult",
  })

export const PrototypeSaveResult = z
  .object({
    ok: z.literal(true),
    prototype: PrototypeItem,
  })
  .meta({
    ref: "PrototypeSaveResult",
  })

export const PrototypeDeleteResult = z
  .object({
    ok: z.literal(true),
  })
  .meta({
    ref: "PrototypeDeleteResult",
  })

export const PrototypeUploadInput = z
  .object({
    agent_mode: z.string().optional(),
    saved_plan_id: z.string().optional(),
    message_id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    route: z.string().optional(),
    page_key: z.string().min(1),
    filename: z.string().min(1),
    content_type: z.string().min(1),
    data_base64: z.string().min(1),
    viewport: PrototypeViewport.optional(),
    source_url: z.string().optional(),
    test_run_id: z.string().optional(),
    test_result: PrototypeTestResult.optional(),
  })
  .meta({
    ref: "PrototypeUploadInput",
  })

export const PrototypeCaptureInput = z
  .object({
    agent_mode: z.string().optional(),
    saved_plan_id: z.string().optional(),
    message_id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    route: z.string().optional(),
    page_key: z.string().min(1),
    source_url: z.string().url(),
    wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    ready_selector: z.string().optional(),
    delay_ms: z.number().int().min(0).max(15000).optional(),
    viewport: PrototypeViewport.optional(),
    test_run_id: z.string().optional(),
    test_result: PrototypeTestResult.optional(),
  })
  .meta({
    ref: "PrototypeCaptureInput",
  })
