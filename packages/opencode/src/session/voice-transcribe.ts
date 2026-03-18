import { generateText } from "ai"
import { tmpdir } from "os"
import path from "path"
import { unlink } from "fs/promises"
import { fileURLToPath } from "url"
import { MessageV2 } from "./message-v2"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { SessionVoice, MAX_AUDIO_BYTES } from "./voice"

const log = Log.create({ service: "session.voice-transcribe" })
const MAX_TEXT_CHARS = 24_000
const MAX_SEGMENT_CHARS = 2_000
const MAX_SEGMENTS = 512
const SEGMENT_GAP_SECONDS = 1.5
const DEFAULT_WHITELIST = ["HIS", "LIS", "PACS"]

type Segment = {
  start: number
  end: number
  text: string
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

function localEnabled() {
  const value = process.env.TPCODE_LOCAL_STT_ENABLED?.toLowerCase()
  if (value === undefined) return true
  return value === "true" || value === "1"
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

function prewarmEnabled() {
  const value = process.env.TPCODE_LOCAL_STT_PREWARM?.toLowerCase()
  if (value === undefined) return true
  return value === "true" || value === "1"
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

async function resolveCandidates(input: { providerID?: string; modelID?: string }) {
  const list: Array<{ providerID: string; modelID: string }> = []
  const push = (item?: { providerID: string; modelID: string }) => {
    if (!item) return
    if (list.some((x) => x.providerID === item.providerID && x.modelID === item.modelID)) return
    list.push(item)
  }

  push(input.providerID && input.modelID ? { providerID: input.providerID, modelID: input.modelID } : undefined)
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
  const script = fileURLToPath(new URL("./voice-transcribe-local.py", import.meta.url))
  await Bun.write(file, bytes)

  const py = localPython()
  const proc = Bun.spawn({
    cmd: [
      ...py,
      script,
      file,
      process.env.TPCODE_LOCAL_STT_MODEL ?? "small",
      process.env.TPCODE_LOCAL_STT_LANGUAGE ?? "",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: localPythonEnv(),
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  await unlink(file).catch(() => undefined)
  if (code !== 0) {
    log.warn("local whisper transcription failed", { code, error: err })
    return
  }
  const parsedResult = JSON.parse(out) as { text?: string; engine?: string; segments?: unknown }
  const segments = applyWhitelistToSegments(normalizeSegments(parsedResult.segments))
  const text = applyWhitelist(parsedResult.text ?? textFromSegments(segments))
  if (!text) return
  return {
    text,
    engine: parsedResult.engine?.trim() || `local_whisper:${process.env.TPCODE_LOCAL_STT_MODEL ?? "small"}`,
    segments: segments.length ? segments : undefined,
  }
}

async function prewarmLocalWhisper() {
  if (!localEnabled() || !prewarmEnabled()) return false
  const script = fileURLToPath(new URL("./voice-transcribe-local.py", import.meta.url))
  const py = localPython()
  const proc = Bun.spawn({
    cmd: [...py, script, "--warmup", process.env.TPCODE_LOCAL_STT_MODEL ?? "small"],
    stdout: "pipe",
    stderr: "pipe",
    env: localPythonEnv(),
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    log.warn("local whisper prewarm failed", { code, error: err })
    return false
  }
  log.info("local whisper prewarmed", {
    model: process.env.TPCODE_LOCAL_STT_MODEL ?? "small",
    output: out.trim(),
  })
  return true
}

async function transcribeWithModel(input: {
  mime: string
  data_url: string
  providerID: string
  modelID: string
}) {
  const model = await Provider.getModel(input.providerID, input.modelID).catch(() => undefined)
  if (!model) return
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
    abortSignal: AbortSignal.timeout(Number(process.env.TPCODE_STT_TIMEOUT_MS ?? "20000")),
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
  }
}

export namespace SessionVoiceTranscribe {
  let warming: Promise<boolean> | undefined

  export function prewarm() {
    if (!warming) {
      warming = prewarmLocalWhisper().finally(() => {
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

    const local = await transcribeWithLocalWhisper(input).catch((error) => {
      log.warn("local whisper unavailable", { error })
      return
    })
    if (local) return local
    const candidates = await resolveCandidates({
      providerID: input.providerID,
      modelID: input.modelID,
    })
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
