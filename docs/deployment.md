# Deploy Voxraft

The production container serves the built React app and FastAPI from one HTTPS origin. Browser calls to `/api/plan`, `/api/transcribe`, and `/api/voice/stream` therefore work without a separate frontend URL or proxy configuration. FFmpeg is included for recorded-audio transcription.

**Current status:** No production host is currently configured. Pushes and pull requests run the frontend and backend checks and verify the production container build.

## Optional Render setup

1. Keep the GitHub repository private. Connect it to Render and allow Render access to this repository.
2. Create a Blueprint from the repository's `render.yaml`, or create a Docker web service using the root `Dockerfile` and health path `/api/health`.
3. Set `DATABASE_URL` to the pooled connection string for the linked Neon production branch and `DATABASE_URL_UNPOOLED` to its direct connection string. Both are runtime secrets in Render; the local `.env.local` is git-ignored and is not uploaded by the Blueprint.
4. Set `GNANI_API_KEY` as a runtime secret. Set `OPENAI_API_KEY` for the AI planner; basic text commands work without it. If using another supported planner, configure its variables from `backend/.env.example` instead.
5. Leave `GNANI_MOCK_TRANSCRIPT` unset in production. Never put provider keys in Git or variables prefixed with `VITE_`.
6. Open the resulting HTTPS URL and run the voice and text checks in the deployment acceptance section below.

The Blueprint creates a free web service and generates `AUTH_SECRET_KEY`. The database is the existing Neon production branch, so the Blueprint does not create a second PostgreSQL database. Render's free web service can sleep after 15 idle minutes and may take about a minute to wake up. Open the app before recording and allow it to finish starting. [Render free service behaviour](https://render.com/docs/free)

The API returns HTTP 429 when an account exceeds 60 AI requests or 60 REST transcriptions per hour. Voice is limited to 10 starts per account per hour, two concurrent sessions, and five minutes per session. Global hourly limits and account sign-up limits also apply. An account can hold up to 50 diagrams. Requests over 3.5 MB are rejected before parsing (16 MB for audio uploads). Set spending limits in the OpenAI and Gnani provider accounts as a second cap on charges.

Render supplies `RENDER_EXTERNAL_URL`, which the relay accepts as the app's WebSocket origin. For a custom domain, also set `VOICE_ALLOWED_ORIGINS` to the exact HTTPS origin; separate multiple origins with commas. [Render environment variables](https://render.com/docs/environment-variables)

## Local production check

From the repository root:

```bash
docker build -t voxraft .
docker run --rm -p 127.0.0.1:8000:8000 \
  --env-file .env.local \
  --env-file backend/.env \
  -e AUTH_SECRET_KEY=replace-with-a-random-secret-at-least-32-characters \
  -e VOICE_ALLOWED_ORIGINS=http://localhost:8000 \
  voxraft
```

Open `http://localhost:8000`. `GET /api/health` should return `{"status":"ok"}`. This endpoint checks that the application is running; it does not test provider credentials or spend API credits.

## Deployment acceptance

- The HTTPS app opens and `/pcm-worklet.js` loads successfully.
- Sign up, sign out, sign in, password change, account project restore, and text creation work.
- Connection, undo, save/import, and reload work.
- A real voice session reaches **Listening** and transcribes a new spoken command.
- The transcript produces one diagram edit, and the session stops cleanly.
- The production repository and deployment runner have the access needed for automated releases.

Each signed-in account can hold up to 50 projects in Neon Postgres. A second browser signed in to the same account loads the same project list. Use **Save** to retain a portable copy as well. Local SQLite is suitable for development, but an ephemeral host filesystem must not be used as the deployed account store.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Loading screen after inactivity on Render | Wait for the free Render instance to wake. |
| Voice immediately switches to REST | Check `GNANI_API_KEY`, provider connectivity, and the WebSocket origin. The relay accepts the exact Render URL or an explicitly configured origin. |
| Microphone unavailable | Open the HTTPS app directly and allow browser microphone access. |
| Planner failure | Check the configured planner credentials and quota. A configured planner failure is surfaced to avoid silently interpreting a command differently. |
| REST transcription failure | Check Gnani credentials and model availability. The container already includes FFmpeg. |
| Text works but speech never appears | Confirm the recording is real, `GNANI_MOCK_TRANSCRIPT` is unset, and the API key belongs to the intended Gnani account. |
