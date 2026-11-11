# Voxraft — speak your architecture

**A voice controlled diagram editor for developers and students.**

## Problem

Explaining a system and drawing it are usually separate tasks. During a design discussion, interview practice, or lesson, manually arranging boxes and arrows interrupts the explanation.

## Solution

Voxraft turns spoken instructions into edits on an Excalidraw canvas. A user can create a frontend, backend, and database; connect them; insert Redis between two components; move or rename a block; and undo an edit. Each command builds on the existing diagram. Manual drawing, project save/import, and editable Excalidraw export remain available.

## Gnani integration

Gnani Prisma provides speech recognition using the official `gnani-vachana` Python streaming SDK. The browser sends 16 kHz mono PCM through a FastAPI WebSocket relay. Completed utterances enter a serial command queue, and segment IDs prevent duplicate execution. Component names are supplied as recognition hints. If streaming fails, recorded speech can use Gnani REST transcription after FFmpeg conversion.

The default model is `prisma-v3.0`, configured for English (`en-IN`). An optional OpenAI planner converts transcripts and scene context into structured actions; a local parser covers basic commands. Gnani performs transcription, while the planner interprets diagram edits.

## Engineering approach

A canonical scene stores stable node IDs, connections, and undo history. The client validates action schemas, resolves references, and commits a batch only if every edit succeeds. Ambiguous targets can trigger a clarification. API credentials remain on the backend. React and FastAPI are packaged as one Docker service for Render.

## Current scope

The app supports English voice commands and browser-local project storage. It does not yet provide collaborative editing or verified multilingual support. Automated tests cover scene edits, reference resolution, voice queue behaviour, reconnects, project recovery, and production routing. Live microphone performance should be assessed using the accompanying recorded demonstration.

**Project setup and demo instructions:** [README](../README.md) · [Demo script](submission.md)
