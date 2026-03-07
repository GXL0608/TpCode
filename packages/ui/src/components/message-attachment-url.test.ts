import { describe, expect, test } from "bun:test"
import { resolveMessageAttachmentUrl } from "./message-attachment-url"

describe("resolveMessageAttachmentUrl", () => {
  test("resolves relative session urls against the server base", () => {
    expect(
      resolveMessageAttachmentUrl({
        url: "/session/s1/voice/v1",
        base: "http://127.0.0.1:4096",
        token: "token-1",
      }),
    ).toBe("http://127.0.0.1:4096/session/s1/voice/v1?access_token=token-1")
  })

  test("keeps an existing access token", () => {
    expect(
      resolveMessageAttachmentUrl({
        url: "/session/s1/voice/v1?access_token=token-1",
        base: "http://127.0.0.1:4096",
        token: "token-2",
      }),
    ).toBe("http://127.0.0.1:4096/session/s1/voice/v1?access_token=token-1")
  })

  test("leaves data urls untouched", () => {
    expect(
      resolveMessageAttachmentUrl({
        url: "data:audio/webm;base64,abc",
        base: "http://127.0.0.1:4096",
        token: "token-1",
      }),
    ).toBe("data:audio/webm;base64,abc")
  })
})
