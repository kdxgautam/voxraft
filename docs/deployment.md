# Deploy Voxraft to Google Cloud Run

The production container serves the built React app and FastAPI from one HTTPS origin. Browser calls to `/api/plan`, `/api/transcribe`, and `/api/voice/stream` therefore work without a separate frontend deployment or cross-origin authentication. FFmpeg is included for recorded-audio transcription.

**Current status:** Google Cloud Run is the production target, but no production host is currently configured. Pushes and pull requests run the frontend and backend checks and verify the production container build.

## Production architecture

- Cloud Run builds the root `Dockerfile` from the GitHub repository and serves the app publicly.
- Secret Manager provides provider credentials, database URLs, and the session-signing key.
- Neon Postgres remains the account and diagram store. Use its pooled URL for application traffic and direct URL for schema setup.
- Cloud Build deploys only when its manual trigger is run after GitHub CI passes.

Local SQLite is suitable for development only. Cloud Run's filesystem is ephemeral and must not hold production account data.

## One-time Google Cloud setup

In project `voxraft-production`:

1. Enable the Cloud Run Admin, Cloud Build, Artifact Registry, and Secret Manager APIs.
2. Create service account `voxraft-runner` without a downloaded key.
3. Give that service account **Secret Manager Secret Accessor** on these individual secrets:
   - `AUTH_SECRET_KEY`
   - `DATABASE_URL`
   - `DATABASE_URL_UNPOOLED`
   - `GNANI_API_KEY`
   - `OPENAI_API_KEY`
4. In Cloud Run, choose **Deploy container** and connect `kdxgautam/voxraft` through Cloud Build.
5. Select branch `^main$` and build `/Dockerfile` for the initial revision.
6. After the initial deployment, open **Cloud Build → Triggers**, edit the generated trigger, and change its event to **Manual invocation**.

Do not store provider keys in Git, ordinary environment variables, or variables prefixed with `VITE_`. Leave `GNANI_MOCK_TRANSCRIPT` unset in production.

## Cloud Run service settings

Create service `voxraft` in `asia-south1` with public unauthenticated access and request-based billing.

| Setting | Value |
| --- | --- |
| Runtime service account | `voxraft-runner` |
| Container port | `8080` |
| CPU | `1` |
| Memory | `512 MiB` |
| Request timeout | `360 seconds` |
| Maximum concurrency | `40` |
| Minimum instances | `0` |
| Maximum instances | `2` |
| Session affinity | Enabled |

Add ordinary environment variables:

| Variable | Value |
| --- | --- |
| `FORWARDED_ALLOW_IPS` | `*` |
| `GNANI_LANGUAGE` | `en-IN` |
| `GNANI_MODEL` | `prisma-v3.0` |
| `GNANI_STREAM_MODEL` | `prisma-v3.0` |

Expose each Secret Manager secret under the environment variable with the same name. Pin an enabled numeric secret version so a rotation requires an explicit revision.

After the first deployment, copy the exact `https://…run.app` service URL, add it as `VOICE_ALLOWED_ORIGINS` without a trailing slash, and deploy a new revision. Add a custom HTTPS origin to the same comma-separated variable when a custom domain is introduced.

## CI and releases

GitHub Actions runs three checks on pull requests and pushes to `main`:

- **Frontend checks** install locked npm dependencies, typecheck, test, and build.
- **Backend checks** install locked Python dependencies and run pytest on Python 3.12, matching production.
- **Container build** builds the production Dockerfile, starts the image, and probes `/api/health`.

Protect `main` with a GitHub ruleset that requires all three checks. To release, wait for the checks to pass, open **Cloud Build → Triggers**, select the manual Voxraft trigger, click **Run**, and deploy the accepted `main` commit. Cloud Build must not deploy automatically on every push because its trigger does not wait for GitHub Actions.

The API returns HTTP 429 when an account exceeds 60 AI feature requests, 600 diagram commands, or 60 REST transcriptions per hour. Local parser commands count only toward the diagram command limit. Voice is limited to 10 starts per account per hour, two concurrent sessions, and five minutes per session. Global hourly limits and account sign-up limits also apply. An account can hold up to 50 diagrams. Requests over 3.5 MB are rejected before parsing (16 MB for audio uploads). Set spending limits in the OpenAI and Gnani provider accounts as a second cap on charges.

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

- The HTTPS app opens and `/api/health` returns `{"status":"ok"}`.
- `/pcm-worklet.js` loads successfully.
- Sign up, sign out, sign in, password change, account project restore, and text creation work.
- Connection, undo, save/import, and reload work.
- A real voice session reaches **Listening** and transcribes one new spoken command.
- The transcript produces one diagram edit, and the session stops cleanly.
- A second browser signed in to the same account loads the same project list from Neon.
- Cloud Run logs contain no startup, secret-access, or database errors.

Use **Save** to retain a portable project copy in addition to the Neon account copy.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cloud Build fails | Open **Cloud Build → History** and verify the build identity can build the Dockerfile and write to Artifact Registry. |
| Cloud Run returns 403 | Confirm unauthenticated invocation is enabled and `allUsers` has **Cloud Run Invoker**. |
| Revision does not become ready | Check Cloud Run logs, container port `8080`, service account selection, and secret access. |
| Voice immediately switches to REST | Check `GNANI_API_KEY`, provider connectivity, and that `VOICE_ALLOWED_ORIGINS` exactly matches the Cloud Run URL. |
| Microphone unavailable | Open the HTTPS app directly and allow browser microphone access. |
| Planner failure | Check the configured planner credentials and quota. A configured planner failure is surfaced to avoid silently interpreting a command differently. |
| REST transcription failure | Check Gnani credentials and model availability. The container already includes FFmpeg. |
| Text works but speech never appears | Confirm the recording is real, `GNANI_MOCK_TRANSCRIPT` is unset, and the API key belongs to the intended Gnani account. |
