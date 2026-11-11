# BolCanvas evaluation — 11 November 2026

## Scope and method

This is a measured local evaluation, not a claim about deployed performance. The frontend ran in an isolated Playwright browser context at `http://127.0.0.1:5173`; FastAPI ran locally without provider credentials. Each command was entered through the visible command field. Scene outcomes were checked against the autosaved canonical scene, including stable IDs, node coordinates, edges, context, and container membership. The 12 timed command samples measure from filling/submitting the text field until the changed scene appeared in LocalStorage; they include browser automation overhead. A separate 30-request sample measures local `/api/plan` round trips for one simple architecture command.

## Results

| Measure | Observed result | Interpretation |
| --- | --- | --- |
| Frontend checks | Typecheck, 111/111 Vitest tests, production build passed | No failing frontend gate in this run. |
| Backend checks | 69/69 pytest tests passed outside the sandbox | The deployment test timed out inside the restricted sandbox because static file requests stalled there; its original, unchanged test passed outside it. |
| Timed browser commands | 12/12 produced the expected scene outcome | Local parser and browser path only; the sample includes Architecture creation, nodes, edges, style, undo, redo, rename, and move. |
| Browser command latency | Median 74 ms; p95 118 ms; range 43–118 ms (`n=12`) | Text submission to autosaved scene on this machine. No speech or remote model latency. |
| Local planner latency | Median 4 ms; p95 6 ms; range 3–7 ms (`n=30`) | HTTP round trip for `Add Redis` with confirmed Architecture. |
| Unrelated node preservation | 3/3 targeted edits left every unrelated node byte-for-byte unchanged | Rename Auth, move Auth, and add Redis. Existing edge count stayed fixed for these edits. |
| Read-only proposals | Review, Critique, and Design previews left nodes and edges unchanged (3/3) | Applying Design then changed styles in one history step while preserving node and edge IDs and all positions. |
| Correction in local mode | 0/1 applied; the scene stayed unchanged | The local parser correctly returned “Corrections require a configured AI planner.” Live correction success is not measured. |
| Transcription failures | Empty audio → HTTP 400 (5 ms); missing credential → HTTP 503 (4 ms) | Both injected failures were handled explicitly. These are failure-path checks, not speech recognition accuracy. |

## Scenario checks

- **Architecture:** node creation, database cylinder, directed connections, style change, undo/redo, rename, move, Review, Critique, and Design worked. Review identified an unconnected Redis node. Critique left an already acceptable arrangement unchanged.
- **Mind map and conversion:** Food delivery became the root ellipse; Features and Payments formed arrowless branches while the root position stayed fixed. Conversion preview did not edit the scene. Applying Mind map → Hierarchy kept node IDs, mapped both branches to parent–child edges, and created one undo step.
- **Hierarchy:** `Put Platform under API Team` changed the parent relationship without moving any node.
- **Brainstorming:** `PostgreSQL` became a rectangular note, and adding another idea created no connection.
- **Flowchart:** Start and End became ellipses, the payment decision became a diamond, Yes/No sequence paths had arrowheads, and a Retry loop was retained.
- **Mixed containers:** Product Ideas used Mind map defaults while the canvas used Architecture defaults. `PostgreSQL` inside Product Ideas was a topic rectangle; `PostgreSQL database` on the canvas was a cylinder. An unqualified cross-type connection was rejected without changing the scene; an explicit association succeeded.
- **Persistence:** Save and Excalidraw export downloaded successfully. Import restored the saved context, node and edge IDs, relationships, container type, and central topic.

## Limits and next live measurements

Live provider calls were not included in these numbers. The automatic approval review blocked sending saved replay commands to the external configured planner because the payload destination and possible API charges needed specific approval. A separate approval is pending for a short computer-generated English sample to Gnani. Until those checks run, planner accuracy on free-form language, correction success with a model, speech-to-transcript latency, recognition failure rate, and microphone behavior on the deployed app remain unmeasured.

For an interview, describe the architecture choice precisely: text commands can execute through a fast local parser; complex commands and natural corrections require the configured planner; speech recognition adds a separate latency and failure path. The canonical scene lets us compare exact before/after node and edge state, so unrelated edits can be detected rather than inferred from a screenshot. The next evaluation should use a fixed set of spoken English commands, record exact transcripts and stage timings, then replay corrections against the same seeded scenes.
