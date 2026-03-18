import { onCleanup, onMount } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt, type ContentPart, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
export const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"]
const LARGE_PASTE_CHARS = 8000
const LARGE_PASTE_BREAKS = 120

function largePaste(text: string) {
  if (text.length >= LARGE_PASTE_CHARS) return true
  let breaks = 0
  for (const char of text) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks >= LARGE_PASTE_BREAKS) return true
  }
  return false
}

type PromptAttachmentsInput = {
  editor: () => HTMLDivElement | undefined
  isFocused: () => boolean
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  retakeImage?: () => void
}

const MAX_EDGE = 640
const MIN_BRIGHTNESS = 45
const MAX_BRIGHTNESS = 215
const MIN_BLUR_VARIANCE = 180
const MAX_BORDER_EDGE_RATIO = 0.62
const MAX_UPLOAD_BYTES = 200 * 1024
const MAX_ENCODE_EDGE = 1600

type QualityIssue = "blur" | "brightness" | "cropped"
type ImageSource = "camera" | "album" | "paste" | "drop"

function imageFromFile(file: File) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = "async"
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("image_load_failed"))
  })
  img.src = url
  return loaded.finally(() => URL.revokeObjectURL(url))
}

async function imageQuality(file: File) {
  if (typeof document === "undefined") return
  if (!file.type.startsWith("image/")) return
  const img = await imageFromFile(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1))
  const w = Math.max(32, Math.round(img.naturalWidth * scale))
  const h = Math.max(32, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return
  ctx.drawImage(img, 0, 0, w, h)
  const pix = ctx.getImageData(0, 0, w, h).data
  const gray = new Float32Array(w * h)

  let light = 0
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    const value = pix[p] * 0.299 + pix[p + 1] * 0.587 + pix[p + 2] * 0.114
    gray[i] = value
    light += value
  }
  light = light / Math.max(1, gray.length)

  let mean = 0
  let sum = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      count += 1
      const delta = lap - mean
      mean += delta / count
      sum += delta * (lap - mean)
    }
  }
  const blur = count > 1 ? sum / (count - 1) : 0

  const border = Math.max(8, Math.round(Math.min(w, h) * 0.08))
  let edgeTotal = 0
  let edgeBorder = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] -
        2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] -
        gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)]
      const gy =
        gray[(y - 1) * w + (x - 1)] +
        2 * gray[(y - 1) * w + x] +
        gray[(y - 1) * w + (x + 1)] -
        gray[(y + 1) * w + (x - 1)] -
        2 * gray[(y + 1) * w + x] -
        gray[(y + 1) * w + (x + 1)]
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag < 90) continue
      edgeTotal += 1
      if (x <= border || y <= border || x >= w - border - 1 || y >= h - border - 1) {
        edgeBorder += 1
      }
    }
  }
  const borderRatio = edgeTotal > 120 ? edgeBorder / edgeTotal : 0

  const issues: QualityIssue[] = []
  if (blur < MIN_BLUR_VARIANCE) issues.push("blur")
  if (light < MIN_BRIGHTNESS || light > MAX_BRIGHTNESS) issues.push("brightness")
  if (borderRatio > MAX_BORDER_EDGE_RATIO) issues.push("cropped")
  if (issues.length === 0) return
  return issues
}

function cropRegion(file: { width: number; height: number; gray: Float32Array }, focus: boolean) {
  if (!focus) {
    return {
      sx: 0,
      sy: 0,
      sw: file.width,
      sh: file.height,
    }
  }

  const w = file.width
  const h = file.height
  const border = Math.max(2, Math.round(Math.min(w, h) * 0.03))
  let left = w
  let top = h
  let right = 0
  let bottom = 0
  let count = 0

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -file.gray[(y - 1) * w + (x - 1)] +
        file.gray[(y - 1) * w + (x + 1)] -
        2 * file.gray[y * w + (x - 1)] +
        2 * file.gray[y * w + (x + 1)] -
        file.gray[(y + 1) * w + (x - 1)] +
        file.gray[(y + 1) * w + (x + 1)]
      const gy =
        file.gray[(y - 1) * w + (x - 1)] +
        2 * file.gray[(y - 1) * w + x] +
        file.gray[(y - 1) * w + (x + 1)] -
        file.gray[(y + 1) * w + (x - 1)] -
        2 * file.gray[(y + 1) * w + x] -
        file.gray[(y + 1) * w + (x + 1)]
      const mag = Math.sqrt(gx * gx + gy * gy)
      if (mag < 95) continue
      if (x <= border || y <= border || x >= w - border || y >= h - border) continue
      count += 1
      if (x < left) left = x
      if (y < top) top = y
      if (x > right) right = x
      if (y > bottom) bottom = y
    }
  }

  if (count < 180 || right <= left || bottom <= top) {
    return {
      sx: 0,
      sy: 0,
      sw: w,
      sh: h,
    }
  }

  const padX = Math.round((right - left + 1) * 0.12)
  const padY = Math.round((bottom - top + 1) * 0.12)
  const sx = Math.max(0, left - padX)
  const sy = Math.max(0, top - padY)
  const ex = Math.min(w, right + padX)
  const ey = Math.min(h, bottom + padY)
  return {
    sx,
    sy,
    sw: Math.max(1, ex - sx),
    sh: Math.max(1, ey - sy),
  }
}

function blobFromCanvas(canvas: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality)
  })
}

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  if (mime === "image/gif") return "gif"
  return "jpg"
}

function withExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, "")
  return `${base}.${ext}`
}

function sensitive(value: string) {
  const text = value.replace(/\s+/g, "")
  if (!text) return false
  if (/(?:身份证|证件号|idcard|identity|住院号|病案号|患者姓名|手机号|电话|mobile|patient)/i.test(text)) return true
  if (/(?:^|[^0-9])(1[3-9][0-9]{9})(?:[^0-9]|$)/.test(text)) return true
  if (/(?:^|[^0-9A-Za-z])([0-9]{17}[0-9Xx])(?:[^0-9A-Za-z]|$)/.test(text)) return true
  if (/(?:^|[^0-9])([0-9]{8,20})(?:[^0-9]|$)/.test(text)) return true
  return false
}

async function maskSensitive(canvas: HTMLCanvasElement) {
  if (typeof window === "undefined") return false
  const win = window as Window & {
    TextDetector?: new () => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string; boundingBox?: DOMRectReadOnly }>>
    }
  }
  if (!win.TextDetector) return false
  const result = await new win.TextDetector().detect(canvas).catch(() => [] as Array<{
    rawValue?: string
    boundingBox?: DOMRectReadOnly
  }>)
  if (result.length === 0) return false
  const ctx = canvas.getContext("2d")
  if (!ctx) return false

  let masked = false
  for (const item of result) {
    const text = String(item.rawValue ?? "").trim()
    const box = item.boundingBox
    if (!text || !box) continue
    if (!sensitive(text)) continue
    const x = Math.max(0, Math.floor(box.x - 2))
    const y = Math.max(0, Math.floor(box.y - 2))
    const w = Math.min(canvas.width - x, Math.ceil(box.width + 4))
    const h = Math.min(canvas.height - y, Math.ceil(box.height + 4))
    if (w <= 0 || h <= 0) continue
    ctx.fillStyle = "rgba(0,0,0,0.82)"
    ctx.fillRect(x, y, w, h)
    masked = true
  }
  return masked
}

function addWatermark(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const size = Math.max(14, Math.round(Math.min(canvas.width, canvas.height) / 20))
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((-20 * Math.PI) / 180)
  ctx.font = `${size}px sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const stepX = Math.max(120, Math.round(size * 8))
  const stepY = Math.max(80, Math.round(size * 4))
  for (let y = -canvas.height; y <= canvas.height; y += stepY) {
    for (let x = -canvas.width; x <= canvas.width; x += stepX) {
      ctx.fillStyle = "rgba(255,255,255,0.28)"
      ctx.fillText(text, x, y)
      ctx.strokeStyle = "rgba(0,0,0,0.18)"
      ctx.lineWidth = 1
      ctx.strokeText(text, x, y)
    }
  }
  ctx.restore()
}

async function optimizeImage(file: File, source: ImageSource) {
  if (!file.type.startsWith("image/")) return { file, cropped: false, compressed: false, masked: false }
  if (file.type === "image/gif") return { file, cropped: false, compressed: false, masked: false }

  const img = await imageFromFile(file)
  const scale = Math.min(1, MAX_ENCODE_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1))
  const w = Math.max(32, Math.round(img.naturalWidth * scale))
  const h = Math.max(32, Math.round(img.naturalHeight * scale))

  const prep = document.createElement("canvas")
  prep.width = w
  prep.height = h
  const prepCtx = prep.getContext("2d", { willReadFrequently: true })
  if (!prepCtx) return { file, cropped: false, compressed: false, masked: false }
  prepCtx.drawImage(img, 0, 0, w, h)
  const pix = prepCtx.getImageData(0, 0, w, h).data
  const gray = new Float32Array(w * h)
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    gray[i] = pix[p] * 0.299 + pix[p + 1] * 0.587 + pix[p + 2] * 0.114
  }

  const box = cropRegion({ width: w, height: h, gray }, source === "camera")
  const target = document.createElement("canvas")
  target.width = box.sw
  target.height = box.sh
  const ctx = target.getContext("2d")
  if (!ctx) return { file, cropped: false, compressed: false, masked: false }
  ctx.drawImage(prep, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh)
  const masked = await maskSensitive(target).catch(() => false)
  addWatermark(target, "内部使用-禁止外传")

  const preferred = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg"
  let best = await blobFromCanvas(target, preferred, preferred === "image/jpeg" ? 0.92 : undefined)
  if (!best) return { file, cropped: false, compressed: false, masked }

  const wasCropped = box.sx !== 0 || box.sy !== 0 || box.sw !== w || box.sh !== h
  if (best.size <= MAX_UPLOAD_BYTES) {
    const next = new File([best], withExt(file.name, extension(best.type || preferred)), {
      type: best.type || preferred,
      lastModified: file.lastModified,
    })
    return { file: next, cropped: wasCropped, compressed: next.size < file.size, masked }
  }

  for (const q of [0.88, 0.8, 0.72, 0.64, 0.56]) {
    const hit = await blobFromCanvas(target, "image/jpeg", q)
    if (!hit) continue
    best = hit
    if (hit.size <= MAX_UPLOAD_BYTES) break
  }

  const next = new File([best], withExt(file.name, "jpg"), {
    type: best.type || "image/jpeg",
    lastModified: file.lastModified,
  })
  return { file: next, cropped: wasCropped, compressed: next.size < file.size, masked }
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const prompt = usePrompt()
  const language = useLanguage()

  const addImageAttachment = async (file: File, source: ImageSource = "album") => {
    if (!ACCEPTED_FILE_TYPES.includes(file.type)) return
    if (file.type.startsWith("image/")) {
      const issues = await imageQuality(file).catch(() => undefined)
      if (issues?.length) {
        const zh = language.locale().startsWith("zh")
        const reason = issues
          .map((item) => {
            if (item === "blur") return zh ? "模糊度过高" : "image is blurry"
            if (item === "brightness") return zh ? "亮度异常" : "brightness is abnormal"
            return zh ? "画面可能截断" : "image may be cropped"
          })
          .join(zh ? "；" : "; ")
        showToast({
          title: zh ? "图片质量不佳，请重新拍摄" : "Image quality is poor, please retake",
          description: reason,
          actions: input.retakeImage
            ? [
                {
                  label: zh ? "重拍" : "Retake",
                  onClick: () => input.retakeImage?.(),
                },
                {
                  label: zh ? "取消" : "Dismiss",
                  onClick: "dismiss",
                },
              ]
            : undefined,
        })
        return
      }
    }
    const optimized = await optimizeImage(file, source).catch(() => ({
      file,
      cropped: false,
      compressed: false,
      masked: false,
    }))
    if (optimized.cropped && source === "camera") {
      showToast({
        title: language.locale().startsWith("zh") ? "已聚焦裁剪核心区域" : "Focused crop applied",
      })
    }
    if (optimized.masked) {
      showToast({
        title: language.locale().startsWith("zh") ? "检测到敏感信息，已自动脱敏" : "Sensitive info detected and masked",
      })
    }
    if (optimized.file.size > MAX_UPLOAD_BYTES) {
      showToast({
        title: language.locale().startsWith("zh") ? "图片过大，已尽量压缩" : "Image is large and has been compressed",
        description: language.locale().startsWith("zh") ? "建议重新拍摄更清晰的近景图片" : "Retake with a closer and clearer frame for best results.",
      })
    }

    const reader = new FileReader()
    reader.onload = () => {
      const editor = input.editor()
      if (!editor) return
      const dataUrl = reader.result as string
      const attachment: ImageAttachmentPart = {
        type: "image",
        id: uuid(),
        filename: optimized.file.name,
        mime: optimized.file.type || file.type,
        dataUrl,
      }
      const cursorPosition = prompt.cursor() ?? getCursorPosition(editor)
      prompt.set([...prompt.current(), attachment], cursorPosition)
    }
    reader.readAsDataURL(optimized.file)
  }

  const removeImageAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const handlePaste = async (event: ClipboardEvent) => {
    if (!input.isFocused()) return
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    const items = Array.from(clipboardData.items)
    const fileItems = items.filter((item) => item.kind === "file")
    const imageItems = fileItems.filter((item) => ACCEPTED_FILE_TYPES.includes(item.type))

    if (imageItems.length > 0) {
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) await addImageAttachment(file, "paste")
      }
      return
    }

    if (fileItems.length > 0) {
      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addImageAttachment(file, "paste")
        return
      }
    }

    if (!plainText) return

    if (largePaste(plainText)) {
      if (input.addPart({ type: "text", content: plainText, start: 0, end: 0 })) return
      input.focusEditor()
      if (input.addPart({ type: "text", content: plainText, start: 0, end: 0 })) return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, plainText)
    if (inserted) return

    input.addPart({ type: "text", content: plainText, start: 0, end: 0 })
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    for (const file of Array.from(dropped)) {
      if (ACCEPTED_FILE_TYPES.includes(file.type)) {
        await addImageAttachment(file, "drop")
      }
    }
  }

  onMount(() => {
    document.addEventListener("dragover", handleGlobalDragOver)
    document.addEventListener("dragleave", handleGlobalDragLeave)
    document.addEventListener("drop", handleGlobalDrop)
  })

  onCleanup(() => {
    document.removeEventListener("dragover", handleGlobalDragOver)
    document.removeEventListener("dragleave", handleGlobalDragLeave)
    document.removeEventListener("drop", handleGlobalDrop)
  })

  return {
    addImageAttachment,
    removeImageAttachment,
    handlePaste,
  }
}
