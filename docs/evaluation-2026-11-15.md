# Voxraft evaluation — 15 November 2026

## Scope

This evaluation covers the current local build. The offline replay and local API benchmark used the local parser with all planner credentials and database URLs removed from the process environment. The API benchmark used an isolated SQLite database and in-process ASGI requests, so its timings exclude browser rendering, network transit, speech recognition, and remote model time. After explicit authorization, the seven saved cases were also replayed against the configured external planner. Browser and provider smoke observations listed separately came from the production-style local run earlier in this session.

## Results

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Frontend gates | Typecheck, 142/142 Vitest tests, production build passed after voice timing and fragment handling | Vite reported chunks over 500 kB; build still completed. |
| Backend gates | 122/122 pytest tests passed after the Mixed-canvas latency change | One Starlette/httpx deprecation warning. |
| Saved command replay, configured planner | **7/7 exact passes after the fix** | Five cases called the model and two history/layout commands completed locally. The earlier run passed 5/7. |
| Model-backed replay latency | Median 1,124 ms; p95 1,753 ms; range 927–1,753 ms (`n=5`) | Direct backend `plan()` elapsed time for the five model-backed cases in the passing run. Excludes browser and speech time. With two local cases included, seven-case median was 1,120 ms. |
| Saved command replay, offline | 3/7 exact passes | Ran `backend/replay.py` without provider credentials. Expected action fields and action order were compared; three cases also require `mode: llm`. This is a local-parser result, not live planner accuracy. |
| Local `/api/plan` latency | Median 2.3 ms; p95 7.2 ms; range 1.8–9.9 ms (`n=30`) | Authenticated in-process ASGI requests for `Add Redis` in Architecture. All 30 returned the expected single action. p95 is the 29th sorted sample. |
| Browser end-to-end smoke | Passed | Sign-up, canvas edits, undo/redo, autosave/reload, share/revoke, sign-out, sign-in, and dashboard restoration were exercised in an isolated local browser and database. No JavaScript console errors were observed. This was a scenario check, not a latency sample. |
| Security limit smoke | Passed | Oversized request returned 413; AI quota returned 429 after the allowed 60 requests. A revoked share link returned 404, and sign-out removed account-scoped recovery storage. |
| Configured planner smoke | Passed for two requests | A single `/api/plan` request returned `mode: llm` and one action; a single `/api/generate` request returned `mode: llm` and nine actions. These do not establish seven-case replay accuracy. |
| Synthetic voice smoke | Mixed | Gnani streaming returned the exact target sentence once. Two Gnani REST attempts returned HTTP 200 but transcribed the synthetic speech inaccurately. No physical microphone or real speaker sample was measured. |

## Configured planner replay details

| Saved case | Exact result | Time | Observation |
| --- | --- | ---: | --- |
| Missing separator between components | Pass | 1,753 ms | Produced all five components, with the standalone `front end` label canonicalized to `Frontend`. |
| Three component creation | Pass | 1,124 ms | Three expected nodes. |
| Isolated duplicate deletion | Pass | 1,331 ms | Deleted the isolated duplicate by ID. |
| Spatial language | Pass | 927 ms | Moved the correct node left of the gateway by ID. |
| Multiple connections in order | Pass | 1,120 ms | Produced both edges in order, with unique scene labels resolved to node IDs. |
| Repeated undo | Pass | <1 ms | Handled locally without a model call. |
| Arrange diagram | Pass | <1 ms | Handled locally without a model call. |

The strict score improved from **5/7 to 7/7** after canonicalizing the standalone `front end` component name and resolving unique existing node labels to IDs for planned edges. Ambiguous labels remain unresolved for editor clarification. The replay measures plan output; it does not apply the plan in the browser.

## Simple command latency improvement

On an unscoped Architecture or Mixed canvas, a single short `Add`/`Create` command now executes through the local parser. On Architecture, `Connect X to Y` also uses the local parser when both names match unique existing nodes. Pending corrections, ambiguous names, compound commands, scoped containers, and commands with extra placement or styling clauses still use the planner. These are common user edits; they do not change the seven saved replay cases, which have no confirmed diagram type.

With a provider key present, an isolated local ASGI benchmark used a fake key to verify that no external call occurred. Each command was requested 20 times through the authenticated `/api/plan` route:

Repeat the local measurement with `cd backend && ./.venv/bin/python benchmark_latency.py --samples 20`. It creates and removes a temporary SQLite database and replaces provider credentials in its own process.

| Command | Median | p95 | Range |
| --- | ---: | ---: | ---: |
| `Add Redis` on Architecture | 6.2 ms | 8.5 ms | 4.8–34.1 ms |
| `Add Redis` on Mixed | 5.5 ms | 6.5 ms | 4.7–7.3 ms |
| `Connect Frontend to API Gateway` on Architecture | 4.1 ms | 5.3 ms | 3.5–6.1 ms |

The earlier 1,124 ms median describes five different model-backed replay commands, so it is a scale reference rather than a controlled before/after comparison. Complex requests still have remote model latency. The new path was covered by focused tests for accepted and deferred commands, and the full backend suite passed.

## Offline replay details

| Saved case | Exact result | Observed difference |
| --- | --- | --- |
| Missing separator between components | Fail | Four nodes instead of five; `front end API gateway` was merged. |
| Three component creation | Fail | Three expected nodes were produced, but the saved case requires `mode: llm`; offline mode was `fallback`. |
| Isolated duplicate deletion | Pass | Selected the isolated duplicate by ID. |
| Spatial language | Fail | Direction was `left`, but action used labels instead of the expected node IDs; saved case also requires `mode: llm`. |
| Multiple connections in order | Fail | Two ordered edges were produced, but their endpoints were labels instead of the expected IDs. |
| Repeated undo | Pass | Returned `UNDO` with two steps. |
| Arrange diagram | Pass | Returned `ARRANGE`. |

The label-versus-ID differences need an application-level resolution check before treating them as user-visible failures. The merged component name is a clear local-parser miss. The replay expectations exercise model-backed interpretation for three cases, so the offline score must not be presented as the configured planner's score.

## End-to-end observations

In the browser smoke run, creating and editing an Architecture diagram, sharing it through a direct `/share/{token}` URL, revoking the link, and recovering the dashboard after sign-in all worked. The direct share URL initially returned 404; the frontend route was added to FastAPI and its deployment test before this evaluation. The public share excluded private logs and context. Review, Critique, and Design controls returned proposals; applying Design changed node colors. The live generation smoke created the named Web client, API service, and PostgreSQL database, though its four inferred edges were not checked against a detailed expected topology.

## Remaining measurements

The seven saved commands were sent to the configured external planner after the user explicitly authorized the payloads and API charges. Two real microphone samples were measured on the same Mixed canvas, one before and one after the local fast path was extended to Mixed:

| Spoken command | Path | Speech | Recognition | Queue | Command + view | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `Add Redis` before change | AI planner | 745 ms | 825 ms | 1 ms | 1,483 ms | ~3,054 ms |
| `Add Kafka` after change | Local parser | 715 ms | 756 ms | 1 ms | 118 ms | ~1,589 ms |

The first command log attributed 1,471 ms to planning; the second attributed 99 ms. The observed total fell by about 1,465 ms (48%), mainly in the command-and-view stage. These are two different utterances with one sample each, so the difference is a useful check of the path change, not a controlled latency distribution. Real-speech accuracy across commands, deployed-app behavior, and performance under concurrent users remain unmeasured.

An additional real-voice trial provided these mapped samples: `PostgreSQL database` about 3,830 ms, `An API Gateway, then connect it to the PostgreSQL database` about 7,452 ms, a correction about 4,140 ms, and two separate `Go back` commands about 1,100 and 1,118 ms. The 7,452 ms command included 5,088 ms of detected speech and 1,045 ms of recognition. The paused move produced a separate `Move the` planner entry (1,139 ms planning), although the user reported that the final diagram was correct. Other pasted activity lines were historical or could not be reliably mapped to a spoken command, so they were excluded from summary statistics.

The voice client now holds clearly incomplete final transcript fragments, joins a continuation received within four seconds, and asks for a repeat if no continuation arrives. This prevents fragments such as `Move the` from becoming standalone planner requests. Streaming and REST timing tests, fragment joining tests, and the full frontend suite pass. After refreshing, the user repeated the paused move and confirmed it appeared as one complete command. The latest local activity for that attempt recorded about 5,866 ms total: 3,520 ms detected speech, 1,011 ms recognition, and 1,335 ms command plus view (including 1,304 ms planning).

The editor now records a per-command voice total in **Command activity** after a changed diagram paints. It separates detected speech duration, recognition wait, time queued behind another command, and command plus view time. This is browser-observed elapsed time from first detected loud audio frame to the second animation frame after the scene update. It excludes autosave completion and cannot give a valid total when speech onset was not detected. More real microphone samples are needed to characterize typical latency.

To evaluate those remaining claims, test fixed real-speaker clips and the hosted deployment. Record action-level correctness, transcript accuracy, stage timings, and failures separately.
