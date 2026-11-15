# Voxraft — Gnani internship submission

## Deliverables

The participant requires a **private Git repository**, **demo video**, and **deployed app**. Keep the repository private. The [submission form](https://forms.cloud.microsoft/pages/responsepage.aspx?id=2OcffmZAkUasdAANYYVwjQGaBzel_ZVOv4Z5BmzbI1xUQUVGMTcyOVlSWlJKWUFNRE5ZVzM3OUQ4OC4u&route=shorturl), inspected in the browser, specifically asks for a project URL containing a solution pitch no longer than one page and a **2–3 minute demo video**. It does not display a GitHub reviewer username; obtain the designated reviewer from the organiser's instructions before granting access.

Use the [one-page PDF](../output/pdf/voxraft-solution-pitch.pdf) as the short pitch; [solution-pitch.md](solution-pitch.md) is the editable text version. The README also opens with the pitch. The form asks for your name, registered email, teammate's registered email for a team entry, and institution. It offers a field for the public demo post. The official challenge page describes that public post as part of submission; include it.

The [official challenge page](https://www.gnani.ai/internship) gives the closing time as **November 10, 2026, 11:59 PM IST**. Publish the working demo on LinkedIn or X before submitting, tag Gnani AI, and include `#GnaniAI` and `#GreatIndianAIInternshipChallenge`. The public post and private code repository serve different purposes. Verified public engagement is part of shortlisting; interviews assess individuals.

Complete these fields with real links and contributions before submitting:

- GitHub project URL: https://github.com/kdxgautam/voxraft (matches the configured Git remote; confirm reviewer access before submission).
- Deployed app: https://voxraft.16-4-87-134.nip.io (AWS Lightsail; automated deployment from `main`).
- Demo video: pending recording with a real microphone.
- Public demo post: pending publication.
- Contribution: state what each participant actually implemented and tested.

## Project explanation

**Title:** Voxraft — speak your architecture.

**Problem and users:** Developers and students often explain a system out loud while manually drawing its components and connections. Voxraft lets them turn those spoken instructions into an editable architecture diagram and keep refining the same diagram as the explanation develops.

**How it works:** Gnani Prisma converts speech into command text. A planner converts the command and the current diagram context into structured actions. Voxraft validates the actions, resolves the intended components, and applies the complete edit as one undoable operation. Users can create and connect components, insert a cache between services, move or rename blocks, change colours, and undo changes. Ambiguous references can trigger a follow-up question instead of selecting a component arbitrarily.

**Gnani integration:** The backend uses the official `gnani-vachana` Python SDK for streaming speech recognition and the Gnani REST transcription endpoint as a fallback. The default configured model is `prisma-v3.0`, with English transcription (`en-IN`). Current component names are sent as recognition hints. The browser sends 16 kHz mono PCM audio to the backend; API credentials stay on the server.

**Other technology:** React, TypeScript, Excalidraw, FastAPI, and an optional OpenAI planner. Basic text commands have a deterministic parser. Save/import preserves the project and editing history; Excalidraw export provides an editable drawing.

Check the deployed environment before naming the planner or model in the final submission. Browser speech synthesis reads clarification questions; this project does not currently integrate Gnani Timbre or Evon.

## Main submission video: 2–3 minutes

Aim for about 2 minutes 30 seconds. Rehearse the sequence before recording and leave real response times visible.

| Time | Show and explain |
| --- | --- |
| 0:00–0:20 | Show the deployed app URL. “When I explain a system, I want the diagram to keep up. Voxraft lets developers and students create and edit architecture diagrams by speaking.” |
| 0:20–0:45 | Start voice, wait for Listening, then say “Create a frontend, a backend and a database.” Pause for the three nodes. Say “Connect frontend to backend and backend to database.” Show the two connections. |
| 0:45–1:10 | Say “Insert Redis between backend and database.” Explain that this rewires an existing connection. Say “Move Redis above database.” Show that the command edits the current diagram. |
| 1:10–1:35 | Select the database block and say “Make this orange.” Then say “Undo.” Show the colour reverting. If recognition needs a retry, keep the recovery visible. |
| 1:35–1:55 | Stop voice. Move a block manually. Save the project and show the Excalidraw export option. Explain that the result stays editable. |
| 1:55–2:20 | Explain: “Gnani Prisma transcribes the audio. FastAPI relays the stream. A planner returns structured edits, which the client validates before updating a scene with stable IDs and undo history.” Show the relevant code or repository briefly. |
| 2:20–2:30 | State current scope: English voice, account-backed project autosave, streaming with a REST fallback. End on the working diagram and app name. |

Record your screen and microphone together. Keep provider keys and environment files off screen. The final video should show actual speech recognition on the deployed app, not an automated text-command recording.

## Optional 60-second social clip

This is a rehearsal target. Keep real processing delays visible; shorten the command sequence if your measured run takes longer.

| Time | Screen and speech |
| --- | --- |
| 0–6 s | Show the deployed URL and empty canvas. Say: “Voxraft turns spoken architecture instructions into a diagram you can keep editing.” |
| 6–18 s | Start the voice session and wait for **Listening**. Say: “Create a frontend, a backend and a database.” Show the transcript and three nodes. |
| 18–30 s | Say: “Connect frontend to backend and backend to database.” Wait for both arrows. |
| 30–42 s | Say: “Insert Redis between backend and database.” Show the new component and changed connections. |
| 42–50 s | Say: “Undo.” Show the earlier three-component diagram returning. |
| 50–60 s | Stop voice and save. Say: “Gnani Prisma handles speech recognition. Validated actions update the canvas, with undo and export built in.” |

Use a second, longer recording if the submission allows it: demonstrate selecting a node and saying “make this green,” speaking over a clarification to answer it, correcting a connection with “Wait, no, connect Auth to PostgreSQL,” moving a block manually, and saving/reimporting a project. To show the Architecture Review Agent, connect three services to one database, say “Review this diagram,” inspect the highlighted evidence, and accept **Add replica**. Corrections need the AI planner; the review reports whether it used the agent or rule-based fallback. Rehearse the spoken interruption with your actual microphone before recording it.

Before recording, run the same sequence on the **deployed HTTPS URL** with your actual microphone. Confirm that `GNANI_MOCK_TRANSCRIPT` is unset, the transcript matches your speech, edits run once and in order, and stopping releases the microphone. Record the browser and your microphone audio together. A text-only or mocked demonstration does not establish that the Gnani integration works.

## Public post draft

I built Voxraft for the Great Indian AI Internship Challenge: a voice controlled architecture canvas for developers and students.

Say “create a frontend, backend and database,” connect them, then insert Redis into the diagram. Each instruction edits the same canvas, and changes can be undone or exported.

Gnani Prisma handles speech recognition through its streaming SDK, with REST transcription as a fallback. The diagram engine validates structured edits and keeps stable component IDs so follow-up commands can refer to the existing diagram.

The video shows the working app. Try it: https://voxraft.16-4-87-134.nip.io

[Mention Gnani AI's official account using the platform's account picker. Attach the real demo video and adjust wording to match what the recording actually demonstrates.]

#GnaniAI #GreatIndianAIInternshipChallenge

## Interview preparation

| Likely question | Concrete answer to explain in your own words |
| --- | --- |
| Why keep a separate scene model? | Nodes and edges have stable IDs. Voice edits, manual canvas changes, undo, and project saving all operate on the same model; the rendering library is not the source of command semantics. |
| What does Gnani do versus the planner? | Gnani transcribes audio. The planner maps text and diagram context to an action schema. Client validation and reference resolution decide whether those actions can safely apply. |
| How do you avoid duplicate or out-of-order edits? | Only completed transcript events enter a serial queue. Segment IDs suppress repeated events; stopping aborts queued work. |
| What happens when a reference is ambiguous? | Candidate node IDs are retained with the pending command. A name, selection, or ordinal answer resolves the edit. |
| What happens when streaming fails? | The relay and browser attempt reconnects. The browser can segment recordings using silence and send them to the REST transcription endpoint. This requires FFmpeg on the server. |
| How do you prevent half-applied commands? | Actions execute against a copied scene. The new scene is committed only after the entire batch succeeds. |
| What are the limitations? | The voice configuration is English-only; live accuracy depends on audio and network conditions. Complex commands require a planner. Diagrams autosave to private accounts, but collaborative editing and verified multilingual support are not available. |
| How did you measure performance? | Command Activity records approximate transcription, planning, scene-edit, and next-view timings. Report measurements from your actual rehearsal, not model benchmark numbers. |

## Validation record

Validation on November 10, 2026: 45 frontend tests and 34 backend tests passed, including production routing and WebSocket origin checks. The production Docker build passed. A real browser exercised text creation, connections, inserting Redis, colour changes, arrangement, undo, save, clear, import, and reload against the built container, with no uncaught browser errors. The [screenshot](demo-screenshot.png) comes from that text-command check and is not evidence of live speech recognition.

Real-provider smoke check: one synthetic English sample saying “Create a frontend, a backend and a database” was transcribed correctly through both Gnani REST and streaming from the production container. The configured planner returned the expected three node-creation actions. This checks integration with a synthetic sample, not real microphone quality or overall recognition accuracy.

Current local validation on November 15, 2026: 142 frontend and 122 backend tests passed, and all seven saved planner replay cases passed against the configured model. Local microphone trials exercised multi-step editing, corrections, undo, and a paused command; [measured timings and limitations](evaluation-2026-11-15.md) are recorded separately. The final public recording and deployed HTTPS microphone check are still pending. No general recognition accuracy, user adoption, or accessibility-testing results are claimed here.
