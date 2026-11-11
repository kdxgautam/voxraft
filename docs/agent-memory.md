# Agent memory and orchestration

## What exists

The canonical scene is the agents' source of truth. It records diagram type, purpose, nodes, edges, container scopes, selected elements, and undo history. The command planner also receives the last unchanged command and actions for corrections. Review, Layout Critic, and Visual Design are separate read-only agents; their proposals apply only after user approval and are rejected when the scene changes.

The **Diagram decisions** list adds explicit project memory. Notes are short, visible, editable, saved with the project, and sent with `diagram_context` to the planner and agents. The app does not silently infer lasting user preferences or share notes across projects. Review rules use only a narrow, named failover note to avoid repeating a replica suggestion; other notes inform model reasoning but do not override the graph or authorize edits.

## Where multiple agents help

| User request | Coordinator | Specialist work | Result |
| --- | --- | --- | --- |
| “Review and improve this diagram” | Capture one immutable scene snapshot | Review graph and measure layout in parallel; Visual Design only if styling is explicitly requested | One grouped report with separate evidence and previews |
| “Why did this command fail?” | Reuse transcript, selected IDs, and recent actions | A recovery specialist proposes one clarification or dry-run candidate | User picks a candidate before any edit |
| “Explain this system” | Capture scene and decisions | An explainer traces real paths; Review can supply a verified issue if requested | Grounded walkthrough with uncertain assumptions labeled |

Each specialist should receive the same scene version and project notes. The coordinator should validate every cited node and edge ID, collect at most one result per specialist, and never let specialists edit the canvas directly. If the scene changes, discard the whole bundle. Apply each accepted proposal through the existing undo mechanism.

## Why there is no always-on agent swarm

For a normal add, move, or connect command, the existing planner plus deterministic scene executor is faster and easier to verify. Running several model agents on every utterance would multiply latency, cost, and opportunities for contradictory suggestions. Multi-agent work belongs behind an explicit combined request, with a short time limit and a rules fallback. The first useful next implementation is a **Command Recovery Agent**: it can reduce live demo failures without changing the scene or the normal command path.
