import { describe, expect, test } from "bun:test"
import {
  fromOaCompatibleChunk,
  fromOaCompatibleResponse,
} from "../src/routes/zen/util/provider/openai-compatible"
import { getUpstreamErrorStatus, isUpstreamErrorResponse } from "../src/routes/zen/util/handler"

describe("fromOaCompatibleResponse", () => {
  test("keeps valid oa-compatible completions unchanged", () => {
    const result = fromOaCompatibleResponse({
      id: "chatcmpl_123",
      object: "chat.completion",
      created: 1_777_319_757,
      model: "MiniMax-M2.5",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "ok",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    })

    expect(result).toEqual({
      id: "chatcmpl_123",
      object: "chat.completion",
      created: expect.any(Number),
      model: "MiniMax-M2.5",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "ok",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    })
  })

  test("normalizes choices null payloads into standard error objects", () => {
    const result = fromOaCompatibleResponse({
      id: "05fff54dca591a63dc70864719ddbe75",
      object: "chat.completion",
      created: 1_777_319_757,
      model: "MiniMax-M2.5",
      choices: null,
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      base_resp: {
        status_code: 1000,
        status_msg: "unknown error, 520",
      },
    })

    expect(result).toEqual({
      type: "error",
      error: {
        type: "upstream_error",
        message: "unknown error, 520",
      },
    })
  })

  test("preserves standard error payloads", () => {
    const result = fromOaCompatibleResponse({
      error: {
        message: "provider exploded",
        type: "server_error",
      },
    })

    expect(result).toEqual({
      type: "error",
      error: {
        type: "server_error",
        message: "provider exploded",
      },
    })
  })
})

describe("fromOaCompatibleChunk", () => {
  test("normalizes malformed streaming error chunks", () => {
    const result = fromOaCompatibleChunk(
      'data: {"id":"abc","object":"chat.completion","created":1777319757,"model":"MiniMax-M2.5","choices":null,"base_resp":{"status_code":1000,"status_msg":"unknown error, 520"}}',
    )

    expect(result).toBe(
      'data: {"type":"error","error":{"type":"upstream_error","message":"unknown error, 520"}}',
    )
  })
})

describe("upstream error helpers", () => {
  test("detects standardized error payloads", () => {
    expect(
      isUpstreamErrorResponse({
        type: "error",
        error: {
          type: "upstream_error",
          message: "unknown error, 520",
        },
      }),
    ).toBe(true)
  })

  test("maps 200 malformed upstream payloads to 502", () => {
    expect(
      getUpstreamErrorStatus(200, {
        type: "error",
        error: {
          type: "upstream_error",
          message: "unknown error, 520",
        },
      }),
    ).toBe(502)
  })

  test("preserves non-200 upstream status codes", () => {
    expect(
      getUpstreamErrorStatus(520, {
        type: "error",
        error: {
          type: "upstream_error",
          message: "unknown error, 520",
        },
      }),
    ).toBe(520)
  })
})
