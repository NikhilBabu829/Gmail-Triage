# Gmail Triage & Copilot — Frontend

React + TypeScript + Tailwind v4 dashboard for the Gmail triage agent.

## Running

```bash
npm install
cp .env.example .env   # set VITE_API_URL if the backend is not on :8000
npm run dev            # http://localhost:5173
```

`npm run build` type-checks and produces `dist/`.

## Backend contract

`VITE_API_URL` (default `http://localhost:8000`) must serve:

| Endpoint | Method | Body | Response |
| --- | --- | --- | --- |
| `/api/triage/run` | POST | `{}` | `{ status: "running" \| "completed", message: string }` |
| `/api/triage/summary` | GET | — | `[{ message_id, sender, summary }]` (not called on load — see below) |
| `/api/rag/multimodal-query` | POST | `multipart/form-data` with `prompt` (string) | `text/event-stream` (see below) |

CORS must allow the dev origin (`http://localhost:5173`).

### Where the feed's data comes from

The dashboard does **not** call the API on load. `GET /api/triage/summary` re-runs
`generate_summary` on every request, so loading the page used to trigger a fresh
summarisation pass. Instead, the `local-triage-summary` plugin in `vite.config.ts` reads the
`summary.json` the backend wrote and inlines it as the virtual module
`virtual:triage-summary`, which seeds the feed's initial state. First paint is therefore
instant, works with the backend stopped, and costs nothing.

The summary changes only on an explicit action:

| Action | What happens |
| --- | --- |
| Page load | reads `summary.json` from disk; **no** request |
| **Run Triage Now** | `POST /api/triage/run`, then `GET /api/triage/summary` to show the new result |
| Refresh icon | `GET /api/triage/summary` only, for pulling the latest by hand |

The plugin looks for `../summary.json` (the repo root, next to `main.py`) and then
`./summary.json`. In dev it watches that file, so re-running triage — which rewrites it —
reloads the page with the new data. A production `npm run build` inlines whatever the file
held at build time. If it is absent or malformed the feed starts empty and shows the
"Run First Triage" state; the build still succeeds.

### Voice is entirely client-side

Both directions run in the browser. The backend is not involved and needs no audio handling:
it only ever sees the `prompt` text field, whether that text was typed or dictated.

| Direction | API | Where |
| --- | --- | --- |
| Speech → text | `SpeechRecognition` / `webkitSpeechRecognition` | `src/hooks/useSpeechRecognition.ts` |
| Text → speech | `window.speechSynthesis` | `src/hooks/useSpeech.ts` |

Dictation is continuous with interim results: finalised phrases are appended to whatever is
already in the textarea, so you can mix typing and talking, and the interim text shows in the
red "Listening…" banner while you speak.

Two things the naive implementation gets wrong, both handled here:

- **Permission.** `SpeechRecognition.start()` does not reliably raise the browser's mic
  prompt. `start()` therefore calls `navigator.mediaDevices.getUserMedia({ audio: true })`
  first, which guarantees the prompt and — because the stream is held open for the duration —
  makes the browser show its own "microphone in use" indicator. The stream's tracks are
  stopped when dictation ends, so the mic is never left open.
- **Silence timeouts.** Chrome ends a recognition session after a few seconds of silence even
  with `continuous = true`, so pausing before you speak used to kill dictation with no sign.
  A `wantListening` ref records user intent, and `onend` starts a fresh session whenever the
  engine quits on its own. `no-speech` and `aborted` are treated as routine rather than fatal.
  A runaway guard (40 restarts/minute) switches dictation off with a toast instead of spinning.

The mic button is never silently disabled. Where dictation cannot run, clicking it explains
why — an insecure origin (opening the app over a LAN IP rather than `localhost`/HTTPS disables
the microphone APIs entirely), a browser without the Speech API (Firefox), a blocked
permission, a missing input device, or a browser that blocks the recognition service (Brave).

Playback reads the completed answer — `speechSynthesis` cannot consume a stream, so TTS waits
for the `done` frame rather than speaking each token. Markdown is stripped before speaking
(`stripMarkdown` in `src/lib/utils.ts`) so asterisks, backticks, table pipes and link syntax
aren't read aloud. "Auto-Read" in the top bar speaks every reply automatically and persists in
`localStorage`; each answer also has its own Listen/Stop control, and a global Stop appears in
the top bar while speech is playing.

No audio ever leaves the browser, so if you later want server-side STT/TTS (Whisper, a
neural voice) that would replace these hooks — nothing else in the app would change.

### Streaming the answer

The query route is a POST carrying form data, so the native `EventSource` (GET only) cannot
read it. `streamRagQuery` in `src/lib/api.ts` POSTs with `fetch` and pulls the reply off
`response.body.getReader()`, decoding SSE frames as they arrive. Frames handled:

| Event | `data` | Effect |
| --- | --- | --- |
| `token` | a JSON-encoded string | appended to the answer as it renders |
| `sources` | a JSON array of `{ message_id, sender, summary }` | fills "Referenced Emails" |
| `error` | string, or `{ message }` | aborts and surfaces a toast |
| `done` | `{}` | ends the stream |

`rag.py` currently emits only `token` and `done`. The `sources` frame is supported so citations
appear the moment the backend starts sending them — until then the accordion is simply omitted.
If the endpoint replies with `application/json` instead of a stream, the client falls back to
reading `{ answer, sources }` in one piece, so both shapes work.

A stream that closes without emitting any token (the "no relevant emails" path returns early
before yielding) renders an explanatory message rather than an empty bubble.

> **Backend gaps as of this commit.** `rag(query: str)` in `main.py` declares `query` as a
> *URL query-string* parameter, so the multipart body is never read and every request from
> this client is rejected with `422 {"loc":["query","query"],"msg":"Field required"}`. The
> body then calls `query.prompt` on that string, which raises `AttributeError` if the
> parameter is supplied. To match this client the handler needs `prompt: str = Form(...)`.
> `query_rag` also builds a `sources` list it never yields, and now calls `index_emails()` on
> every request, which re-embeds the whole corpus per query.

## Layout

- `src/lib/api.ts` — the only place that talks to the backend.
- `src/lib/utils.ts` — `parseSender`, metric computation, search filter, markdown-to-speech stripping.
- `src/hooks/` — toasts, `SpeechRecognition` (STT), `speechSynthesis` (TTS).
- `src/components/` — `TopBar`, `TriageFeed` (+ `EmailCard`, `MetricCard`), `ChatPanel`
  (+ `ChatMessageBubble`, `SourcesAccordion`), `Toaster`, `ui.tsx` primitives.

## Notes

- Metrics (total / unique senders / financial) are computed client-side from the summary array;
  "financial" matches `invoice`, `receipt`, `bill`, `payment`, `subscription` or a currency symbol.
- Voice input uses `webkitSpeechRecognition`/`SpeechRecognition` — see "Voice is entirely
  client-side" above for permission handling and browser support.
- The Auto-Read toggle persists in `localStorage`.
- On narrow screens the two panels become tabs; "Ask Copilot" switches to the chat tab.
