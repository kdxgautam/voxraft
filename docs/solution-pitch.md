# Voxraft — one-page solution pitch

**Explain a system aloud. Voxraft builds an editable diagram as you speak.**

## Problem

Developers and students pause their explanation to draw boxes, arrows, and flows. During a discussion, the diagram quickly falls behind the idea.

## Solution

Voxraft turns spoken instructions into incremental edits on an Excalidraw canvas. Say “Create a frontend, API gateway, and PostgreSQL database,” then connect them, move a block, correct a connection, or undo. The same canvas can hold Architecture, Flowchart, Mind map, Hierarchy, and Brainstorming regions. Users can still draw manually; later voice commands work with the current diagram.

## How it works

Gnani Prisma transcribes live speech through a FastAPI WebSocket relay, with REST transcription as a fallback. A local parser handles clear edits quickly; a configured AI planner interprets complex instructions in the context of the current scene. Voxraft validates the proposed actions, resolves references to existing components, and commits complete edits with stable IDs and undo history. Ambiguous references prompt a clarification. Provider credentials stay on the server.

## Result and scope

Private diagrams autosave to an account and can be exported as editable Excalidraw files or shared through a revocable read-only link. The current voice experience is in English. Local evaluation passed all seven saved planner replay cases and a live microphone trial confirmed multi-step editing; [measured results and limits](evaluation-2026-11-15.md) are documented separately.

**Project setup and demo instructions:** [README](../README.md) · [Demo script](submission.md)
