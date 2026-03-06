import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { getSpeechRecognitionCtor } from "@/utils/runtime-adapters"

// Minimal types to avoid relying on non-standard DOM typings
type RecognitionResult = {
  0: { transcript: string }
  isFinal: boolean
}

type RecognitionEvent = {
  results: RecognitionResult[]
  resultIndex: number
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

const COMMIT_DELAY = 250
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

const transcriptFromResults = (results: RecognitionResult[], finalOnly: boolean) => {
  let text = ""
  for (const result of results) {
    if (finalOnly && !result.isFinal) continue
    const transcript = normalizeRecognitionText(result[0]?.transcript || "")
    if (!transcript) continue
    text = appendRecognitionText(text, transcript)
  }
  return text
}

export function createSpeechRecognition(opts?: {
  lang?: string
  onFinal?: (text: string) => void
  onInterim?: (text: string) => void
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
  let stopping = false
  let settleWaiters: Array<() => void> = []

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

  const scheduleRestart = () => {
    clearRestart()
    if (!shouldContinue) return
    if (!recognition) return
    restartTimer = window.setTimeout(() => {
      restartTimer = undefined
      if (!shouldContinue) return
      if (!recognition) return
      try {
        recognition.start()
      } catch {}
    }, 150)
  }

  const settleDone = () => {
    stopping = false
    const waiters = settleWaiters
    settleWaiters = []
    for (const waiter of waiters) waiter()
  }

  const reset = () => {
    shouldContinue = false
    stopping = false
    clearRestart()
    cancelPendingCommit()
    sessionCommitted = ""
    pendingHypothesis = ""
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    committedText = ""
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

    recognition.onresult = (event: RecognitionEvent) => {
      if (!event.results.length) return

      const aggregatedFinal = transcriptFromResults(event.results, true)
      const snapshot = transcriptFromResults(event.results, false)

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
      clearRestart()
      cancelPendingCommit()
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      if (e.error === "no-speech" && shouldContinue) {
        setStore("interim", "")
        if (opts?.onInterim) opts.onInterim("")
        scheduleRestart()
        return
      }
      shouldContinue = false
      setStore("isRecording", false)
      settleDone()
    }

    recognition.onstart = () => {
      clearRestart()
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
      clearRestart()
      cancelPendingCommit()
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
    stopping = false
    clearRestart()
    shouldContinue = true
    sessionCommitted = ""
    pendingHypothesis = ""
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setStore("interim", "")
    try {
      recognition.start()
    } catch {}
  }

  const stop = () => {
    if (!recognition) return
    shouldContinue = false
    stopping = true
    clearRestart()
    promotePending()
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setStore("interim", "")
    if (opts?.onInterim) opts.onInterim("")
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

  const setLang = (next: string) => {
    if (!recognition) return
    recognition.lang = next
  }

  onCleanup(() => {
    shouldContinue = false
    stopping = false
    clearRestart()
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
    setLang,
    start,
    stop,
  }
}
