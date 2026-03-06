# Voice Input Embedding Requirements

## Scope
This project supports voice input in web chat for:
- Desktop browsers
- Mobile browsers
- Embedded iframe
- Embedded WebView (Android/iOS)
- WeChat mini program `<web-view>` (with capability-dependent fallback)

## Host Requirements

### 1) iframe Hosts
- Serve the page over HTTPS.
- Add microphone capability on iframe:

```html
<iframe src="https://your-host/session/..." allow="microphone"></iframe>
```

### 2) Android WebView Hosts
- Request runtime microphone permission in host app.
- Implement/enable media capture permission callback in WebChromeClient.
- Ensure the embedded page is HTTPS.

### 3) iOS WebView Hosts
- Declare microphone usage description in app plist.
- Grant media capture permission to WKWebView (microphone).
- Ensure the embedded page is HTTPS.

### 4) WeChat Mini Program `<web-view>`
- Verify microphone capture and SpeechRecognition availability for actual target kernel/version.
- If recognition is unavailable, fallback to:
  - record + upload/store audio
  - manual text input

## Functional Behavior
- Max recording length: 60 seconds.
- Max audio payload: 3 MB.
- Recording is persisted with message context.
- Browser STT is best-effort:
  - supported containers: transcript auto-fill
  - unsupported containers: audio attachment still works, user enters text manually

## Troubleshooting
- `NotAllowedError`: host/container microphone permission not granted.
- Missing STT result: browser/container does not expose SpeechRecognition API.
- Audio playback issue in embedded env: verify host media permissions and HTTPS.
