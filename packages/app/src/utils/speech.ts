import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"

// Minimal types to avoid relying on non-standard DOM typings
type RecognitionResult = {
  length?: number
  0?: { transcript: string }
  item?: (index: number) => { transcript: string } | undefined
  isFinal: boolean
}

type RecognitionEvent = {
  results: ArrayLike<RecognitionResult>
  resultIndex: number
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  processLocally?: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

const COMMIT_DELAY = 250
const START_RETRY_DELAY = 150
const START_RETRY_LIMIT = 80
const STOP_SETTLE_DELAY = 1200
const SPACE = /\s+/g
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u
const LEADING_PUNCTUATION = /^[,.;!?，。！？、；：)\]}'"”’]/u
const TRAILING_PUNCTUATION = /[(\[{'"“‘]$/u

export const normalizeRecognitionText = (input: string) => input.replace(SPACE, " ").trim()

const shouldSkipJoinSpace = (base: string, addition: string) => {
  const left = base.at(-1) ?? ""
  const right = addition[0] ?? ""
  if (!left || !right) return true
  if (NO_SPACE_SCRIPT.test(left) || NO_SPACE_SCRIPT.test(right)) return true
  if (LEADING_PUNCTUATION.test(addition)) return true
  if (TRAILING_PUNCTUATION.test(base)) return true
  return false
}

export const appendRecognitionText = (base: string, addition: string) => {
  const trimmed = normalizeRecognitionText(addition)
  if (!trimmed) return base
  if (!base) return trimmed
  if (shouldSkipJoinSpace(base, trimmed)) return `${base}${trimmed}`
  return `${base} ${trimmed}`
}

const overlap = (base: string, next: string) => {
  const size = Math.min(base.length, next.length)
  for (let index = size; index > 0; index -= 1) {
    if (base.slice(-index) === next.slice(0, index)) return index
  }
  return 0
}

const compactRecognitionText = (input: string) => normalizeRecognitionText(input).replace(SPACE, "")

export const extractRecognitionSuffix = (committed: string, hypothesis: string) => {
  const base = normalizeRecognitionText(committed)
  const next = normalizeRecognitionText(hypothesis)
  if (!next) return ""
  if (!base) return next
  if (next === base) return ""
  if (next.startsWith(base)) return normalizeRecognitionText(next.slice(base.length))
  const size = overlap(base, next)
  if (size > 0) return normalizeRecognitionText(next.slice(size))
  if (NO_SPACE_SCRIPT.test(base) || NO_SPACE_SCRIPT.test(next)) {
    const compactBase = compactRecognitionText(base)
    const compactNext = compactRecognitionText(next)
    if (compactNext === compactBase) return ""
    if (compactNext.startsWith(compactBase)) return compactNext.slice(compactBase.length)
    const compactSize = overlap(compactBase, compactNext)
    if (compactSize > 0) return compactNext.slice(compactSize)
  }
  if (base.includes(next)) return ""
  return next
}

const resultAt = (results: ArrayLike<RecognitionResult>, index: number) => {
  const direct = results[index]
  if (direct) return direct
  const withItem = results as ArrayLike<RecognitionResult> & { item?: (index: number) => RecognitionResult | undefined }
  return withItem.item?.(index)
}

const alternativeAt = (result: RecognitionResult, index: number) => {
  const direct = result[index as 0]
  if (direct) return direct
  return result.item?.(index)
}

const transcriptFromResults = (results: ArrayLike<RecognitionResult>, finalOnly: boolean, from = 0) => {
  let text = ""
  for (let index = Math.max(0, from); index < results.length; index += 1) {
    const result = resultAt(results, index)
    if (!result) continue
    if (finalOnly && !result.isFinal) continue
    const transcript = normalizeRecognitionText(alternativeAt(result, 0)?.transcript || "")
    if (!transcript) continue
    text = appendRecognitionText(text, transcript)
  }
  return text
}

export function createSpeechRecognition(opts?: {
  lang?: string
  localFirst?: boolean
  onFinal?: (text: string) => void
  onInterim?: (text: string) => void
  onError?: (error: string) => void
}) {
  const ctor = getSpeechRecognitionCtor<Recognition>(typeof window === "undefined" ? undefined : window)
  const hasSupport = Boolean(ctor)

  const [store, setStore] = createStore({
    isRecording: false,
    committed: "",
    interim: "",
  })

  const isRecording = () => store.isRecording
  const committed = () => store.committed
  const interim = () => store.interim

  let recognition: Recognition | undefined
  let shouldContinue = false
  let committedText = ""
  let sessionCommitted = ""
  let pendingHypothesis = ""
  let lastInterimSuffix = ""
  let shrinkCandidate: string | undefined
  let commitTimer: number | undefined
  let restartTimer: number | undefined
  let stopTimer: number | undefined
  let startRetries = 0
  let starting = false
  let stopping = false
  let settleWaiters: Array<() => void> = []
  let starts = 0
  let results = 0
  let errors = 0
  let ends = 0
  let lastError = ""
  const localPreferred = Boolean(opts?.localFirst)
  let localSupported = false
  let localActive = false

  const cancelPendingCommit = () => {
    if (commitTimer === undefined) return
    clearTimeout(commitTimer)
    commitTimer = undefined
  }

  const clearRestart = () => {
    if (restartTimer === undefined) return
    window.clearTimeout(restartTimer)
    restartTimer = undefined
  }

  const clearStopTimer = () => {
    if (stopTimer === undefined) return
    window.clearTimeout(stopTimer)
    stopTimer = undefined
  }

  const shouldRetryStart = (error: unknown) => {
    if (error instanceof DOMException) {
      if (error.name === "InvalidStateError") return true
      if (error.name === "AbortError") return true
      if (error.name === "NotAllowedError") return true
      if (error.name === "SecurityError") return true
    }
    if (!(error instanceof Error)) return false
    const message = error.message.toLowerCase()
    if (message.includes("already started")) return true
    if (message.includes("invalid state")) return true
    if (message.includes("not-allowed")) return true
    if (message.includes("permission")) return true
    return false
  }

  const failStart = () => {
    shouldContinue = false
    starting = false
    setStore("isRecording", false)
    settleDone()
    if (opts?.onError) opts.onError("start-failed")
  }

  const startRecognition = () => {
    if (!recognition) return
    if (store.isRecording || starting) return
    starting = true
    try {
      recognition.start()
      startRetries = 0
    } catch (error) {
      starting = false
      if (!shouldContinue) return
      if (!shouldRetryStart(error)) {
        failStart()
        return
      }
      if (startRetries >= START_RETRY_LIMIT) {
        failStart()
        return
      }
      startRetries += 1
      scheduleRestart()
    }
  }

  const scheduleRestart = () => {
    clearRestart()
    if (!shouldContinue) return
    if (!recognition) return
    restartTimer = window.setTimeout(() => {
      restartTimer = undefined
      if (!shouldContinue) return
      if (!recognition) return
      startRecognition()
    }, START_RETRY_DELAY)
  }

  const settleDone = () => {
    clearStopTimer()
    stopping = false
    const waiters = settleWaiters
    settleWaiters = []
    for (const waiter of waiters) waiter()
  }

  const reset = () => {
    shouldContinue = false
    stopping = false
    clearRestart()
    clearStopTimer()
    cancelPendingCommit()
    sessionCommitted = ""
    pendingHypothesis = ""
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    committedText = ""
    startRetries = 0
    starting = false
    settleDone()
    setStore("isRecording", false)
    setStore("committed", "")
    setStore("interim", "")
    if (opts?.onInterim) opts.onInterim("")
  }

  const commitSegment = (segment: string) => {
    const nextCommitted = appendRecognitionText(committedText, segment)
    if (nextCommitted === committedText) return
    committedText = nextCommitted
    setStore("committed", committedText)
    if (opts?.onFinal) opts.onFinal(segment.trim())
  }

  const promotePending = () => {
    if (!pendingHypothesis) return
    const suffix = extractRecognitionSuffix(sessionCommitted, pendingHypothesis)
    if (!suffix) {
      pendingHypothesis = ""
      return
    }
    sessionCommitted = appendRecognitionText(sessionCommitted, suffix)
    commitSegment(suffix)
    pendingHypothesis = ""
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setStore("interim", "")
    if (opts?.onInterim) opts.onInterim("")
  }

  const applyInterim = (suffix: string, hypothesis: string) => {
    cancelPendingCommit()
    pendingHypothesis = hypothesis
    lastInterimSuffix = suffix
    shrinkCandidate = undefined
    setStore("interim", suffix)
    if (opts?.onInterim) {
      opts.onInterim(suffix ? appendRecognitionText(committedText, suffix) : "")
    }
    if (!suffix) return
    const snapshot = hypothesis
    commitTimer = window.setTimeout(() => {
      if (pendingHypothesis !== snapshot) return
      const currentSuffix = extractRecognitionSuffix(sessionCommitted, pendingHypothesis)
      if (!currentSuffix) return
      sessionCommitted = appendRecognitionText(sessionCommitted, currentSuffix)
      commitSegment(currentSuffix)
      pendingHypothesis = ""
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setStore("interim", "")
      if (opts?.onInterim) opts.onInterim("")
    }, COMMIT_DELAY)
  }

  if (ctor) {
    recognition = new ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = opts?.lang || (typeof navigator !== "undefined" ? navigator.language : "en-US")
    if (localPreferred && "processLocally" in recognition) {
      localSupported = true
      try {
        recognition.processLocally = true
        localActive = true
      } catch {}
    }

    recognition.onresult = (event: RecognitionEvent) => {
      results += 1
      if (!event.results.length) return

      const start = event.resultIndex ?? 0
      const from = start >= event.results.length ? 0 : Math.max(0, start)
      const aggregatedFinal = transcriptFromResults(event.results, true, from)
      const snapshot = transcriptFromResults(event.results, false, from)

      if (aggregatedFinal) {
        cancelPendingCommit()
        const finalSuffix = extractRecognitionSuffix(sessionCommitted, aggregatedFinal)
        if (finalSuffix) {
          sessionCommitted = appendRecognitionText(sessionCommitted, finalSuffix)
          commitSegment(finalSuffix)
        }
      }

      cancelPendingCommit()

      if (!snapshot) {
        shrinkCandidate = undefined
        applyInterim("", "")
        return
      }

      const suffix = extractRecognitionSuffix(sessionCommitted, snapshot)

      if (!suffix) {
        if (!lastInterimSuffix) {
          shrinkCandidate = undefined
          applyInterim("", snapshot)
          return
        }
        if (shrinkCandidate === "") {
          applyInterim("", snapshot)
          return
        }
        shrinkCandidate = ""
        pendingHypothesis = snapshot
        return
      }

      if (lastInterimSuffix && suffix.length < lastInterimSuffix.length) {
        if (shrinkCandidate === suffix) {
          applyInterim(suffix, snapshot)
          return
        }
        shrinkCandidate = suffix
        pendingHypothesis = snapshot
        return
      }

      shrinkCandidate = undefined
      applyInterim(suffix, snapshot)
    }

    recognition.onerror = (e: { error: string }) => {
      errors += 1
      lastError = e.error
      clearRestart()
      clearStopTimer()
      cancelPendingCommit()
      starting = false
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      if ((e.error === "no-speech" || e.error === "aborted") && shouldContinue) {
        setStore("isRecording", false)
        setStore("interim", "")
        if (opts?.onInterim) opts.onInterim("")
        scheduleRestart()
        return
      }
      if (e.error !== "aborted" && opts?.onError) opts.onError(e.error)
      shouldContinue = false
      setStore("isRecording", false)
      settleDone()
    }

    recognition.onstart = () => {
      starts += 1
      clearRestart()
      clearStopTimer()
      startRetries = 0
      starting = false
      if (!shouldContinue) {
        setStore("isRecording", false)
        settleDone()
        try {
          recognition?.stop()
        } catch {}
        return
      }
      sessionCommitted = ""
      pendingHypothesis = ""
      cancelPendingCommit()
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setStore("interim", "")
      if (opts?.onInterim) opts.onInterim("")
      setStore("isRecording", true)
    }

    recognition.onend = () => {
      ends += 1
      clearRestart()
      clearStopTimer()
      cancelPendingCommit()
      starting = false
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setStore("isRecording", false)
      if (shouldContinue) {
        scheduleRestart()
        return
      }
      settleDone()
    }
  }

  const start = () => {
    if (!recognition) return
    if (store.isRecording && !stopping) return
    if (starting) return
    stopping = false
    clearRestart()
    shouldContinue = true
    startRetries = 0
    sessionCommitted = ""
    pendingHypothesis = ""
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setStore("interim", "")
    startRecognition()
  }

  const stop = () => {
    if (!recognition) return
    shouldContinue = false
    starting = false
    stopping = true
    startRetries = 0
    clearRestart()
    clearStopTimer()
    promotePending()
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setStore("isRecording", false)
    setStore("interim", "")
    if (opts?.onInterim) opts.onInterim("")
    stopTimer = window.setTimeout(() => {
      if (!stopping) return
      try {
        recognition.abort?.()
      } catch {}
      setStore("isRecording", false)
      settleDone()
    }, STOP_SETTLE_DELAY)
    try {
      recognition.stop()
    } catch {}
  }

  const settle = (timeout = 800) => {
    if (!recognition || (!store.isRecording && !stopping)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        settleWaiters = settleWaiters.filter((item) => item !== done)
        resolve()
      }, timeout)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      settleWaiters.push(done)
    })
  }

  const waitUntilRecording = (timeout = 2200) => {
    if (!recognition) return Promise.resolve(false)
    if (store.isRecording) return Promise.resolve(true)
    const deadline = Date.now() + Math.max(0, timeout)
    return new Promise<boolean>((resolve) => {
      const tick = () => {
        if (store.isRecording) {
          resolve(true)
          return
        }
        if (Date.now() >= deadline) {
          resolve(store.isRecording)
          return
        }
        window.setTimeout(tick, 50)
      }
      tick()
    })
  }

  const setLang = (next: string) => {
    if (!recognition) return
    recognition.lang = next
    if (!localPreferred || !localSupported) return
    try {
      recognition.processLocally = true
      localActive = true
    } catch {}
  }

  onCleanup(() => {
    shouldContinue = false
    starting = false
    stopping = false
    startRetries = 0
    clearRestart()
    clearStopTimer()
    promotePending()
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    settleDone()
    setStore("interim", "")
    if (opts?.onInterim) opts.onInterim("")
    try {
      recognition?.stop()
    } catch {}
  })

  return {
    isSupported: () => hasSupport,
    isRecording,
    committed,
    interim,
    reset,
    settle,
    waitUntilRecording,
    setLang,
    debug: () => ({
      starts,
      results,
      errors,
      ends,
      should_continue: shouldContinue,
      starting,
      stopping,
      is_recording: store.isRecording,
      committed: store.committed.length,
      interim: store.interim.length,
      last_error: lastError,
      local_preferred: localPreferred,
      local_supported: localSupported,
      local_active: localActive,
    }),
    start,
    stop,
  }
}
