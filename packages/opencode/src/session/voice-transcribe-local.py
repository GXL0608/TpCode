import json
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
  sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
  sys.stderr.reconfigure(encoding="utf-8")


def load_whisper():
  try:
    from faster_whisper import WhisperModel
    return WhisperModel
  except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "faster-whisper"])
    from faster_whisper import WhisperModel
    return WhisperModel


def main():
  if len(sys.argv) < 2:
    print(json.dumps({"text": "", "engine": "local_whisper:none"}))
    return

  if sys.argv[1] == "--warmup":
    model_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else "small"
    load_whisper()(model_id, device="cpu", compute_type="int8")
    print(json.dumps({"text": "", "engine": f"local_whisper:{model_id}", "warmed": True}, ensure_ascii=False))
    return

  if len(sys.argv) < 3:
    print(json.dumps({"text": "", "engine": "local_whisper:none"}))
    return

  audio = sys.argv[1]
  model_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else "small"
  lang = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None

  WhisperModel = load_whisper()
  model = WhisperModel(model_id, device="cpu", compute_type="int8")
  segments, _ = model.transcribe(audio, language=lang, vad_filter=True)
  parsed = []
  full = []
  for item in segments:
    raw = item.text or ""
    if not raw.strip():
      continue
    start = float(item.start or 0.0)
    end = float(item.end or start)
    if end < start:
      end = start
    parsed.append({
      "start": start,
      "end": end,
      "text": raw.strip(),
    })
    full.append(raw)

  text = "".join(full).strip()
  print(json.dumps({"text": text, "engine": f"local_whisper:{model_id}", "segments": parsed}, ensure_ascii=False))


if __name__ == "__main__":
  main()
