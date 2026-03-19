import { unlink } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { MAX_AUDIO_BYTES } from "./voice"
import { MessageV2 } from "./message-v2"

const log = Log.create({ service: "session.voice-transcribe" })
const MAX_TEXT_CHARS = 24_000
const MAX_SEGMENT_CHARS = 2_000
const MAX_SEGMENTS = 512
const SEGMENT_GAP_SECONDS = 1.5
const DEFAULT_WHITELIST = ["HIS", "LIS", "PACS"]
const WORKER_SCRIPT = fileURLToPath(new URL("./voice-transcribe-local.py", import.meta.url))

type Segment = {
  start: number
  end: number
  text: string
}

type Transcript = {
  text: string
  engine: string
  segments?: Segment[]
}

type SttMode = "local_pool" | "remote_dedicated"

type SttState = {
  mode: SttMode
  local: boolean
  prewarm: boolean
  ready: boolean
  warming: boolean
  concurrency: number
  queue: number
  workers: {
    total: number
    ready: number
    busy: number
  }
}

type LocalWorkerJob = {
  id: string
  audio: string
  language?: string
  resolve: (value: Transcript | undefined) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

type LocalWorker = {
  id: number
  proc: ReturnType<typeof Bun.spawn>
  buffer: string
  stderr: string
  ready: boolean
  current?: LocalWorkerJob
  startup?: {
    resolve: (worker: LocalWorker) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
}

const pool = {
  workers: [] as LocalWorker[],
  queue: [] as LocalWorkerJob[],
  starting: undefined as Promise<void> | undefined,
  nextWorkerID: 0,
  nextJobID: 0,
}

function parseDataUrl(url: string) {
  const comma = url.indexOf(",")
  if (comma < 0) throw new Error("Invalid audio data URL")
  const header = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  if (!payload) throw new Error("Audio payload is empty")
  return { header, payload }
}

function audioSize(url: string) {
  const parsed = parseDataUrl(url)
  const bytes = audioBytes(parsed)
  if (bytes.length === 0) throw new Error("Audio payload is empty")
  return bytes.length
}

function audioBytes(parsed: { header: string; payload: string }) {
  return parsed.header.includes(";base64")
    ? Buffer.from(parsed.payload, "base64")
    : Buffer.from(decodeURIComponent(parsed.payload), "utf-8")
}

function extension(mime: string) {
  if (mime.includes("webm")) return "webm"
  if (mime.includes("ogg")) return "ogg"
  if (mime.includes("mpeg")) return "mp3"
  if (mime.includes("wav")) return "wav"
  if (mime.includes("mp4")) return "mp4"
  return "webm"
}

function envFlag(keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = process.env[key]?.trim().toLowerCase()
    if (!value) continue
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
  }
  return fallback
}

function envInt(keys: string[], fallback: number, min: number, max: number) {
  for (const key of keys) {
    const raw = process.env[key]?.trim()
    if (!raw) continue
    const value = Math.trunc(Number(raw))
    if (!Number.isFinite(value)) continue
    return Math.min(max, Math.max(min, value))
  }
  return fallback
}

function sttMode(): SttMode {
  return process.env.TPCODE_STT_MODE?.trim().toLowerCase() === "remote_dedicated" ? "remote_dedicated" : "local_pool"
}

function localEnabled() {
  if (sttMode() === "remote_dedicated") return false
  return envFlag(["TPCODE_LOCAL_STT_ENABLED"], true)
}

function localPython() {
  if (process.env.TPCODE_LOCAL_STT_PYTHON?.trim()) {
    return [process.env.TPCODE_LOCAL_STT_PYTHON.trim()]
  }
  if (process.platform === "win32") return ["py", "-3"]
  return ["python3"]
}

function localPythonEnv() {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  }
}

function localModel() {
  return process.env.TPCODE_LOCAL_STT_MODEL?.trim() || "small"
}

function localLanguage() {
  const value = process.env.TPCODE_LOCAL_STT_LANGUAGE?.trim()
  return value || undefined
}

function prewarmEnabled() {
  return envFlag(["TPCODE_LOCAL_STT_PREWARM"], true)
}

function localConcurrency() {
  return envInt(["TPCODE_STT_CONCURRENCY", "TPCODE_LOCAL_STT_CONCURRENCY"], 1, 1, 4)
}

function localQueueMax() {
  return envInt(["TPCODE_STT_QUEUE_MAX", "TPCODE_LOCAL_STT_QUEUE_MAX"], 16, 1, 128)
}

function localTimeoutMs() {
  return envInt(["TPCODE_LOCAL_STT_TIMEOUT_MS"], 30_000, 1_000, 300_000)
}

function remoteTimeoutMs() {
  return envInt(["TPCODE_STT_TIMEOUT_MS"], 20_000, 1_000, 300_000)
}

function trimText(input: string) {
  const text = input.trim()
  if (!text) return ""
  if (text.length <= MAX_TEXT_CHARS) return text
  return text.slice(0, MAX_TEXT_CHARS)
}

function trimSegmentText(input: string) {
  const text = input.trim()
  if (!text) return ""
  if (text.length <= MAX_SEGMENT_CHARS) return text
  return text.slice(0, MAX_SEGMENT_CHARS)
}

function toSecond(input: unknown) {
  const value = typeof input === "number" ? input : Number(input)
  if (!Number.isFinite(value)) return
  if (value < 0) return 0
  return Math.round(value * 1000) / 1000
}

function joinSegmentText(left: string, right: string) {
  const a = left.trim()
  const b = right.trim()
  if (!a) return b
  if (!b) return a
  const latin = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)
  return latin ? `${a} ${b}` : `${a}${b}`
}

function textFromSegments(input: Segment[]) {
  return trimText(input.map((item) => item.text).reduce(joinSegmentText, ""))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function whitelistTerms() {
  const env = process.env.TPCODE_STT_WHITELIST?.trim()
  const extra = env
    ? env
        .split(/[,\n;|]/)
        .map((item) => item.trim())
        .filter((item) => !!item)
    : []
  const list = [...DEFAULT_WHITELIST, ...extra]
  return [...new Set(list)]
}

function applyWhitelist(input: string) {
  const text = trimText(input)
  if (!text) return ""
  const list = whitelistTerms()
  return list.reduce((out, term) => {
    const next = term.trim()
    if (!next) return out
    if (/^[A-Za-z0-9_-]+$/.test(next)) {
      return out.replace(new RegExp(`\\b${escapeRegExp(next)}\\b`, "gi"), next)
    }
    return out.replace(new RegExp(escapeRegExp(next), "gi"), next)
  }, text)
}

function applyWhitelistToSegments(input: Segment[]) {
  return input.map((item) => ({
    ...item,
    text: trimSegmentText(applyWhitelist(item.text)),
  }))
}

function normalizeSegments(input: unknown) {
  if (!Array.isArray(input)) return []
  const base = input
    .map((item) => {
      if (!item || typeof item !== "object") return
      const row = item as Record<string, unknown>
      const text = trimSegmentText(String(row.text ?? ""))
      if (!text) return
      const start = toSecond(row.start)
      const end = toSecond(row.end)
      if (start === undefined || end === undefined) return
      return {
        start,
        end: end < start ? start : end,
        text,
      } satisfies Segment
    })
    .filter((item): item is Segment => !!item)
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end))

  return base.reduce((list, item) => {
    if (list.length === 0) {
      list.push(item)
      return list
    }
    const last = list[list.length - 1]
    const gap = item.start - last.end
    if (gap >= SEGMENT_GAP_SECONDS && list.length < MAX_SEGMENTS) {
      list.push(item)
      return list
    }
    last.end = Math.max(last.end, item.end)
    last.text = trimSegmentText(joinSegmentText(last.text, item.text))
    return list
  }, [] as Segment[])
}

function parseModel(model?: string) {
  if (!model?.trim()) return
  const [providerID, ...rest] = model.trim().split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

function workerError(worker: LocalWorker, message: string) {
  const detail = worker.stderr.trim()
  return new Error(detail ? `${message}: ${detail}` : message)
}

function clearJobTimer(job?: LocalWorkerJob) {
  if (!job?.timer) return
  clearTimeout(job.timer)
  job.timer = undefined
}

function removeWorker(worker: LocalWorker) {
  const index = pool.workers.findIndex((item) => item.id === worker.id)
  if (index >= 0) pool.workers.splice(index, 1)
}

function rejectStartup(worker: LocalWorker, error: Error) {
  if (!worker.startup) return
  clearTimeout(worker.startup.timer)
  const reject = worker.startup.reject
  worker.startup = undefined
  reject(error)
}

function dispatchJobs() {
  if (pool.queue.length === 0) return
  if (pool.workers.length < localConcurrency()) {
    void ensurePool()
  }
  for (const worker of pool.workers) {
    if (!worker.ready || worker.current) continue
    const job = pool.queue.shift()
    if (!job) return
    const stdin = worker.proc.stdin
    if (!stdin || typeof stdin === "number") {
      job.reject(workerError(worker, "Local STT worker stdin unavailable"))
      continue
    }
    worker.current = job
    job.timer = setTimeout(() => {
      if (worker.current?.id !== job.id) return
      worker.current = undefined
      job.reject(workerError(worker, `Local STT timed out after ${localTimeoutMs()}ms`))
      worker.proc.kill()
    }, localTimeoutMs())
    try {
      stdin.write(`${JSON.stringify({ type: "transcribe", id: job.id, audio: job.audio, language: job.language ?? "" })}\n`)
      stdin.flush()
    } catch (error) {
      clearJobTimer(job)
      worker.current = undefined
      job.reject(error instanceof Error ? error : new Error(String(error)))
      worker.proc.kill()
    }
  }
}

function settleWorker(worker: LocalWorker, raw: string) {
  const line = raw.trim()
  if (!line) return
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(line) as Record<string, unknown>
  } catch {
    worker.stderr = [worker.stderr, line].filter(Boolean).join("\n").slice(-4_000)
    return
  }
  if (payload.ready === true) {
    worker.ready = true
    if (worker.startup) {
      clearTimeout(worker.startup.timer)
      const resolve = worker.startup.resolve
      worker.startup = undefined
      resolve(worker)
    }
    dispatchJobs()
    return
  }
  const current = worker.current
  if (!current) return
  if (String(payload.id ?? "") !== current.id) return
  clearJobTimer(current)
  worker.current = undefined
  if (typeof payload.error === "string" && payload.error.trim()) {
    current.reject(workerError(worker, payload.error.trim()))
    dispatchJobs()
    return
  }
  const segments = applyWhitelistToSegments(normalizeSegments(payload.segments))
  const text = applyWhitelist(String(payload.text ?? "") || textFromSegments(segments))
  current.resolve(
    text
      ? {
          text,
          engine: String(payload.engine ?? "").trim() || `local_whisper:${localModel()}`,
          segments: segments.length ? segments : undefined,
        }
      : undefined,
  )
  dispatchJobs()
}

async function readStdout(worker: LocalWorker) {
  const stream = worker.proc.stdout
  if (!stream || typeof stream === "number") return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      worker.buffer += decoder.decode(value, { stream: true })
      let index = worker.buffer.indexOf("\n")
      while (index >= 0) {
        const line = worker.buffer.slice(0, index)
        worker.buffer = worker.buffer.slice(index + 1)
        settleWorker(worker, line)
        index = worker.buffer.indexOf("\n")
      }
    }
    const tail = worker.buffer + decoder.decode()
    worker.buffer = ""
    if (tail.trim()) settleWorker(worker, tail)
  } catch (error) {
    worker.stderr = [worker.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n").slice(-4_000)
  }
}

async function readStderr(worker: LocalWorker) {
  const stream = worker.proc.stderr
  if (!stream || typeof stream === "number") return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      worker.stderr = [worker.stderr, decoder.decode(value, { stream: true })].filter(Boolean).join("").slice(-4_000)
    }
    worker.stderr = [worker.stderr, decoder.decode()].filter(Boolean).join("").slice(-4_000)
  } catch (error) {
    worker.stderr = [worker.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n").slice(-4_000)
  }
}

function handleWorkerExit(worker: LocalWorker, code: number | null) {
  worker.ready = false
  removeWorker(worker)
  rejectStartup(worker, workerError(worker, `Local STT worker exited with code ${code ?? "unknown"}`))
  if (worker.current) {
    const current = worker.current
    clearJobTimer(current)
    worker.current = undefined
    current.reject(workerError(worker, `Local STT worker exited with code ${code ?? "unknown"}`))
  }
  if (pool.queue.length > 0 && localEnabled()) {
    void ensurePool()
  }
}

function spawnWorker() {
  return new Promise<LocalWorker>((resolve, reject) => {
    const proc = Bun.spawn({
      cmd: [...localPython(), WORKER_SCRIPT, "--worker", localModel()],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: localPythonEnv(),
    })
    const worker: LocalWorker = {
      id: ++pool.nextWorkerID,
      proc,
      buffer: "",
      stderr: "",
      ready: false,
      startup: {
        resolve,
        reject,
        timer: setTimeout(() => {
          rejectStartup(worker, workerError(worker, `Local STT worker startup timed out after ${localTimeoutMs()}ms`))
          proc.kill()
        }, localTimeoutMs()),
      },
    }
    pool.workers.push(worker)
    void readStdout(worker)
    void readStderr(worker)
    void proc.exited.then((code) => handleWorkerExit(worker, code))
  })
}

async function ensurePool() {
  if (!localEnabled()) return
  if (pool.starting) return pool.starting
  const missing = localConcurrency() - pool.workers.length
  if (missing <= 0) return
  pool.starting = Promise.all(
    Array.from({ length: missing }, async () => {
      await spawnWorker().catch((error) => {
        log.warn("local whisper worker failed to start", { error })
        return undefined
      })
    }),
  )
    .then(() => undefined)
    .finally(() => {
      pool.starting = undefined
      dispatchJobs()
    })
  return pool.starting
}

async function enqueueLocalJob(input: { audio: string; language?: string }) {
  await ensurePool()
  if (!pool.workers.some((worker) => worker.ready)) {
    throw new Error("Local STT worker unavailable")
  }
  if (pool.queue.length >= localQueueMax()) {
    throw new Error("Local STT queue is full")
  }
  return new Promise<Transcript | undefined>((resolve, reject) => {
    pool.queue.push({
      id: `local_stt_${++pool.nextJobID}`,
      audio: input.audio,
      language: input.language,
      resolve,
      reject,
    })
    dispatchJobs()
  })
}

async function resolveCandidates() {
  const list: Array<{ providerID: string; modelID: string }> = []
  const push = (item?: { providerID: string; modelID: string }) => {
    if (!item) return
    if (list.some((row) => row.providerID === item.providerID && row.modelID === item.modelID)) return
    list.push(item)
  }

  push(parseModel(process.env.TPCODE_STT_MODEL))

  const providers = (await Provider.list().catch(() => undefined)) ?? {}
  const preferred = ["openai", "opencode", "groq", "google", "anthropic"]
  for (const providerID of preferred) {
    const provider = providers[providerID]
    if (!provider) continue
    for (const modelID of Object.keys(provider.models)) {
      const lower = modelID.toLowerCase()
      if (!lower.includes("transcribe") && !lower.includes("whisper") && !lower.includes("speech")) continue
      push({ providerID, modelID })
    }
  }
  return list
}

async function transcribeWithLocalWhisper(input: { mime: string; data_url: string }) {
  if (!localEnabled()) return
  const parsed = parseDataUrl(input.data_url)
  const bytes = audioBytes(parsed)
  if (bytes.length === 0) return
  const file = path.join(tmpdir(), `opencode-stt-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension(input.mime)}`)
  await Bun.write(file, bytes)
  try {
    return await enqueueLocalJob({
      audio: file,
      language: localLanguage(),
    })
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

async function transcribeWithModel(input: {
  mime: string
  data_url: string
  providerID: string
  modelID: string
}) {
  const model = await Provider.getModel(input.providerID, input.modelID).catch(() => undefined)
  if (!model) return
  if (!model.capabilities.input.audio) return
  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) return

  const user: MessageV2.User = {
    id: "message_voice_transcribe",
    sessionID: "session_voice_transcribe",
    role: "user",
    time: {
      created: Date.now(),
    },
    agent: "build",
    model: {
      providerID: input.providerID,
      modelID: input.modelID,
    },
  }

  const messages = MessageV2.toModelMessages(
    [
      {
        info: user,
        parts: [
          {
            id: "part_voice_text",
            sessionID: user.sessionID,
            messageID: user.id,
            type: "text",
            text: "Transcribe this audio to plain text. Keep the original language. Do not add explanation.",
          },
          {
            id: "part_voice_file",
            sessionID: user.sessionID,
            messageID: user.id,
            type: "file",
            mime: input.mime,
            filename: "voice",
            url: input.data_url,
          },
        ],
      },
    ],
    model,
  )

  const result = await generateText({
    model: language,
    temperature: 0,
    maxOutputTokens: 1200,
    messages,
    abortSignal: AbortSignal.timeout(remoteTimeoutMs()),
  }).catch((error) => {
    log.warn("voice transcription generation failed", {
      error,
      providerID: model.providerID,
      modelID: model.id,
    })
    return
  })
  if (!result) return
  const text = applyWhitelist(result.text)
  if (!text) return
  return {
    text,
    engine: `llm_audio:${model.providerID}/${model.id}`,
    segments: undefined,
  } satisfies Transcript
}

export namespace SessionVoiceTranscribe {
  let warming: Promise<boolean> | undefined

  export function state() {
    const local = localEnabled()
    const prewarm = prewarmEnabled()
    const readyWorkers = pool.workers.filter((worker) => worker.ready).length
    return {
      mode: sttMode(),
      local,
      prewarm,
      ready: !local || !prewarm || readyWorkers > 0,
      warming: !!warming,
      concurrency: local ? localConcurrency() : 0,
      queue: pool.queue.length,
      workers: {
        total: pool.workers.length,
        ready: readyWorkers,
        busy: pool.workers.filter((worker) => !!worker.current).length,
      },
    } satisfies SttState
  }

  export function prewarm() {
    if (!warming) {
      warming = (async () => {
        if (!localEnabled() || !prewarmEnabled()) return false
        await ensurePool()
        return pool.workers.some((worker) => worker.ready)
      })()
        .catch((error) => {
          log.warn("local whisper prewarm failed", { error })
          return false
        })
        .finally(() => {
          warming = undefined
        })
    }
    return warming
  }

  export async function transcribe(input: {
    mime: string
    data_url: string
    providerID?: string
    modelID?: string
  }) {
    if (!input.mime.startsWith("audio/")) throw new Error(`Unsupported audio mime type: ${input.mime}`)
    const size = audioSize(input.data_url)
    if (size > MAX_AUDIO_BYTES) throw new Error(`Audio size exceeds max ${MAX_AUDIO_BYTES} bytes`)

    if (localEnabled()) {
      return (await transcribeWithLocalWhisper(input)) ?? {
        text: "",
        engine: "none",
        segments: undefined,
      }
    }

    const candidates = await resolveCandidates()
    for (const item of candidates) {
      const hit = await transcribeWithModel({
        mime: input.mime,
        data_url: input.data_url,
        providerID: item.providerID,
        modelID: item.modelID,
      })
      if (hit) return hit
    }
    return {
      text: "",
      engine: "none",
      segments: undefined,
    }
  }
}
