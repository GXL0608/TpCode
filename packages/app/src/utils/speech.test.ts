import { afterEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { appendRecognitionText, createSpeechRecognition, extractRecognitionSuffix, normalizeRecognitionText } from "./speech"

type FakeResult = {
  0: { transcript: string }
  isFinal: boolean
}

type FakeEvent = {
  results: ArrayLike<FakeResult>
  resultIndex: number
}

let failStarts = 0
let startError = "InvalidStateError: recognition has already started"
let abortOnStop = false
let startDelay = 0
let latest: FakeRecognition | undefined

class FakeRecognition {
  continuous = false
  interimResults = false
  lang = "en-US"
  onresult: ((e: FakeEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null
  starts = 0
  stops = 0

  constructor() {
    latest = this
  }

  start = () => {
    this.starts += 1
    if (failStarts > 0) {
      failStarts -= 1
      throw new Error(startError)
    }
    if (startDelay > 0) {
      setTimeout(() => this.onstart?.(), startDelay)
      return
    }
    this.onstart?.()
  }

  stop = () => {
    this.stops += 1
    if (!abortOnStop) {
      this.onend?.()
      return
    }
    setTimeout(() => this.onerror?.({ error: "aborted" }), 0)
    setTimeout(() => this.onend?.(), 0)
  }
}

const installRecognition = () => {
  const host = window as Window & { webkitSpeechRecognition?: new () => FakeRecognition }
  host.webkitSpeechRecognition = FakeRecognition
}

const clearRecognition = () => {
  const host = window as Window & { webkitSpeechRecognition?: new () => FakeRecognition }
  delete host.webkitSpeechRecognition
  latest = undefined
  failStarts = 0
  startError = "InvalidStateError: recognition has already started"
  abortOnStop = false
  startDelay = 0
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  clearRecognition()
})

describe("speech transcript merge", () => {
  test("normalizes repeated whitespace", () => {
    expect(normalizeRecognitionText("  hello   world  ")).toBe("hello world")
  })

  test("joins latin segments with spaces", () => {
    expect(appendRecognitionText("hello", "world")).toBe("hello world")
  })

  test("joins CJK segments without synthetic spaces", () => {
    expect(appendRecognitionText("你好", "世界")).toBe("你好世界")
    expect(appendRecognitionText("こんにちは", "世界")).toBe("こんにちは世界")
  })

  test("extracts suffix when chinese hypothesis extends committed text", () => {
    expect(extractRecognitionSuffix("今天 天气", "今天天气不错")).toBe("不错")
    expect(extractRecognitionSuffix("你好", "你好世界")).toBe("世界")
  })

  test("treats a fresh stable phrase as new content after restart", () => {
    expect(extractRecognitionSuffix("你好世界", "今天继续")).toBe("今天继续")
  })

  test("does not duplicate text already covered by committed transcript", () => {
    expect(extractRecognitionSuffix("hello world", "world")).toBe("")
    expect(extractRecognitionSuffix("你好世界", "世界")).toBe("")
  })
})

describe("speech controller recovery", () => {
  test("ignores duplicate start while recognition is still starting", async () => {
    installRecognition()
    startDelay = 520
    const errors: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onError: (error) => errors.push(error),
      }),
    }))

    root.speech.start()
    root.speech.start()
    await wait(120)

    expect(latest?.starts).toBe(1)
    expect(errors.includes("start-failed")).toBe(false)

    await wait(620)
    expect(root.speech.isRecording()).toBe(true)

    root.dispose()
  })

  test("ignores delayed onstart after stop and does not get stuck in recording state", async () => {
    installRecognition()
    startDelay = 300
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition(),
    }))

    root.speech.start()
    root.speech.stop()
    await wait(420)

    expect(root.speech.isRecording()).toBe(false)

    root.dispose()
  })

  test("retries transient start failures instead of emitting start-failed", async () => {
    installRecognition()
    failStarts = 1
    const errors: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onError: (error) => errors.push(error),
      }),
    }))

    root.speech.start()
    await wait(220)

    expect(latest?.starts).toBeGreaterThanOrEqual(2)
    expect(root.speech.isRecording()).toBe(true)
    expect(errors.includes("start-failed")).toBe(false)

    root.dispose()
  })

  test("retries permission-race start failures", async () => {
    installRecognition()
    failStarts = 2
    startError = "NotAllowedError: Permission denied"
    const errors: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onError: (error) => errors.push(error),
      }),
    }))

    root.speech.start()
    await wait(520)

    expect(latest?.starts).toBeGreaterThanOrEqual(3)
    expect(root.speech.isRecording()).toBe(true)
    expect(errors.includes("start-failed")).toBe(false)

    root.dispose()
  })

  test("ignores stale aborted event during quick stop/start recovery", async () => {
    installRecognition()
    abortOnStop = true
    const errors: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onError: (error) => errors.push(error),
      }),
    }))

    root.speech.start()
    failStarts = 1
    root.speech.stop()
    root.speech.start()
    await wait(420)

    expect(root.speech.isRecording()).toBe(true)
    expect(errors.includes("aborted")).toBe(false)
    expect(errors.includes("start-failed")).toBe(false)

    root.dispose()
  })

  test("restarts after no-speech without getting stuck in fake recording state", async () => {
    installRecognition()
    const errors: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onError: (error) => errors.push(error),
      }),
    }))

    root.speech.start()
    expect(root.speech.isRecording()).toBe(true)
    const starts = latest?.starts ?? 0

    latest?.onerror?.({ error: "no-speech" })
    await wait(240)

    expect((latest?.starts ?? 0) > starts).toBe(true)
    expect(root.speech.isRecording()).toBe(true)
    expect(errors.includes("no-speech")).toBe(false)

    root.dispose()
  })

  test("handles array-like result list on first recognition event", async () => {
    installRecognition()
    const finals: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onFinal: (text) => finals.push(text),
      }),
    }))

    root.speech.start()
    latest?.onresult?.({
      results: {
        0: { 0: { transcript: "first attempt works" }, isFinal: true },
        length: 1,
      },
      resultIndex: 0,
    })
    await wait(20)

    expect(root.speech.committed()).toBe("first attempt works")
    expect(finals).toEqual(["first attempt works"])

    root.dispose()
  })

  test("handles item-only result lists from speech recognition", async () => {
    installRecognition()
    const finals: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onFinal: (text) => finals.push(text),
      }),
    }))

    root.speech.start()
    latest?.onresult?.({
      results: {
        length: 1,
        item: (index: number) => {
          if (index !== 0) return
          return {
            isFinal: true,
            item: (n: number) => {
              if (n !== 0) return
              return { transcript: "item api transcript" }
            },
          } as unknown as FakeResult
        },
      } as unknown as ArrayLike<FakeResult>,
      resultIndex: 0,
    })
    await wait(20)

    expect(root.speech.committed()).toBe("item api transcript")
    expect(finals).toEqual(["item api transcript"])

    root.dispose()
  })

  test("falls back to index 0 when resultIndex is out of bounds", async () => {
    installRecognition()
    const finals: string[] = []
    const root = createRoot((dispose) => ({
      dispose,
      speech: createSpeechRecognition({
        onFinal: (text) => finals.push(text),
      }),
    }))

    root.speech.start()
    latest?.onresult?.({
      results: {
        0: { 0: { transcript: "out of range still captured" }, isFinal: true },
        length: 1,
      },
      resultIndex: 3,
    })
    await wait(20)

    expect(root.speech.committed()).toBe("out of range still captured")
    expect(finals).toEqual(["out of range still captured"])

    root.dispose()
  })
})
