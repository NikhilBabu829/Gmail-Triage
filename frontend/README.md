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
| `/api/triage/summary` | GET | — | `[{ message_id, sender, summary }]` |
| `/api/rag/multimodal-query` | POST | `multipart/form-data` with `prompt` (string) and optional `image` (file) | `{ answer: string /* markdown */, sources: [{ message_id, sender, summary }] }` |

CORS must allow the dev origin (`http://localhost:5173`).

> These HTTP routes do not exist in `main.py` yet — it is currently a script, not a
> server. Until they are added, the UI loads and shows an "unreachable backend" toast.

## Layout

- `src/lib/api.ts` — the only place that talks to the backend.
- `src/lib/utils.ts` — `parseSender`, metric computation, search filter, markdown-to-speech stripping.
- `src/hooks/` — toasts, `SpeechRecognition` (STT), `speechSynthesis` (TTS).
- `src/components/` — `TopBar`, `TriageFeed` (+ `EmailCard`, `MetricCard`), `ChatPanel`
  (+ `ChatMessageBubble`, `SourcesAccordion`), `Toaster`, `ui.tsx` primitives.

## Notes

- Metrics (total / unique senders / financial) are computed client-side from the summary array;
  "financial" matches `invoice`, `receipt`, `bill`, `payment`, `subscription` or a currency symbol.
- Voice input uses `webkitSpeechRecognition`/`SpeechRecognition` — Chrome and Safari only. The mic
  button is disabled where unsupported, and blocked permissions raise a toast.
- The Auto-Read toggle persists in `localStorage`.
- On narrow screens the two panels become tabs; "Ask Copilot" switches to the chat tab.
