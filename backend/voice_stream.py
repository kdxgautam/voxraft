"""Browser PCM relay for Gnani's VAD-driven realtime STT."""
import asyncio
import json
import os
import time
import uuid
from collections import deque
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from gnani.stt import (
    GnaniSTTStreamClient,
    StreamErrorEvent,
    StreamProcessingEvent,
    StreamTranscriptEvent,
)
from auth import check_rate_limit, release_voice, require_ws_user, reserve_voice
from fastapi import HTTPException

router = APIRouter()
FRAME_BYTES = 1024


def configured_language() -> str:
    return os.getenv("GNANI_LANGUAGE", "en-IN").strip() or "en-IN"


def parse_key_terms(value: object) -> list[str]:
    if not isinstance(value, list): return []
    return list(dict.fromkeys(term.strip() for term in value if isinstance(term, str) and 1 < len(term.strip()) <= 64 and '<|' not in term and '|>' not in term))[:40]


class TranscriptDeduper:
    def __init__(self):
        self.ids: set[str] = set()
        self.recent: deque[tuple[str, float]] = deque()

    def accept(self, segment_id: str, text: str) -> bool:
        text = text.strip()
        if not text or (segment_id and segment_id in self.ids):
            return False
        now = time.monotonic()
        while self.recent and now - self.recent[0][1] > 4:
            self.recent.popleft()
        normalized = " ".join(text.casefold().split())
        duplicate_window = 0.5 if normalized in {"undo", "redo"} else 4
        if not segment_id and any(value == normalized and now - when < duplicate_window for value, when in self.recent):
            return False
        if segment_id:
            self.ids.add(segment_id)
        self.recent.append((normalized, now))
        return True


def allowed_origin(origin: str | None, host: str | None = None) -> bool:
    if not origin:
        return False
    configured = {item.strip() for item in os.getenv("VOICE_ALLOWED_ORIGINS", "").split(",") if item.strip()}
    configured.add(os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/"))
    if origin in configured:
        return True
    parsed = urlparse(origin)
    request_host = urlparse(f"http://{host or ''}")
    return (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
            and request_host.hostname in {"localhost", "127.0.0.1"})


async def read_browser(websocket: WebSocket, frames: asyncio.Queue[bytes], stopped: asyncio.Event):
    try:
        while not stopped.is_set():
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect" or message.get("text") == "stop":
                break
            frame = message.get("bytes")
            if frame is None or len(frame) != FRAME_BYTES:
                continue
            if frames.full():
                frames.get_nowait()
            frames.put_nowait(frame)
    finally:
        stopped.set()


async def send_audio(stream: GnaniSTTStreamClient, frames: asyncio.Queue[bytes]):
    while True:
        await stream.send_audio(await frames.get())


async def forward_events(stream: GnaniSTTStreamClient, websocket: WebSocket, deduper: TranscriptDeduper, prefix: str = ""):
    async for event in stream:
        if isinstance(event, StreamProcessingEvent):
            await websocket.send_json({"type": "transcribing"})
        elif isinstance(event, StreamTranscriptEvent):
            if event.raw.get("is_final", True) is False:
                if event.text.strip():
                    await websocket.send_json({"type": "partial", "text": event.text.strip(), "language": event.detected_language_code})
                continue
            segment_id = f"{prefix}{event.segment_id}" if event.segment_id else ""
            if deduper.accept(segment_id, event.text):
                await websocket.send_json({"type": "completed", "id": segment_id, "text": event.text.strip(), "language": event.detected_language_code})
            else:
                await websocket.send_json({"type": "listening"})
        elif isinstance(event, StreamErrorEvent):
            raise RuntimeError(event.message)
    raise ConnectionError("Gnani stream closed")


@router.websocket("/api/voice/stream")
async def voice_stream(websocket: WebSocket, user: dict = Depends(require_ws_user)):
    if not allowed_origin(websocket.headers.get("origin"), websocket.headers.get("host")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        check_rate_limit(f'voice-start:{user["id"]}', 10, 3600)
        check_rate_limit('voice-start:global', 60, 3600)
    except HTTPException:
        await websocket.send_json({"type": "limit", "message": "Voice session limit reached. Try again later."})
        await websocket.close()
        return
    reservation = reserve_voice(user['id'])
    if reservation is None:
        await websocket.send_json({"type": "limit", "message": "Two voice sessions are already active for this account."})
        await websocket.close()
        return
    slot, lease_token = reservation
    deadline = time.monotonic() + 300
    key = os.getenv("GNANI_API_KEY", "")
    if not key:
        await websocket.send_json({"type": "fallback", "message": "GNANI_API_KEY is missing."})
        await websocket.close()
        release_voice(user['id'], slot, lease_token)
        return
    try:
        first = await asyncio.wait_for(websocket.receive(), timeout=2)
    except asyncio.TimeoutError:
        first = {}
    if first.get("type") == "websocket.disconnect" or first.get("text") == "stop":
        await websocket.close()
        release_voice(user['id'], slot, lease_token)
        return
    try:
        config = json.loads(first.get("text") or "{}")
    except (ValueError, TypeError):
        config = {}
    terms = parse_key_terms(config.get("keyTerms")) if isinstance(config, dict) and config.get("type") == "config" else []
    frames: asyncio.Queue[bytes] = asyncio.Queue(maxsize=64)
    stopped = asyncio.Event()
    deduper = TranscriptDeduper()
    session_id = uuid.uuid4().hex
    generation = 0
    reader = asyncio.create_task(read_browser(websocket, frames, stopped))
    attempts = 0
    try:
        while not stopped.is_set() and time.monotonic() < deadline:
            model = os.getenv("GNANI_STREAM_MODEL", "prisma-v3.0")
            stream = GnaniSTTStreamClient(
                api_key=key,
                language_code=configured_language(),
                model=model,
                keywords=terms if model == "prisma-v3.0" else None,
                format="transcribe",
                sample_rate=16000,
            )
            sender = events = None
            connected = asyncio.create_task(stream.connect())
            try:
                done, _ = await asyncio.wait({connected, reader}, timeout=min(12, max(0, deadline-time.monotonic())), return_when=asyncio.FIRST_COMPLETED)
                if reader in done:
                    break
                if connected not in done:
                    raise TimeoutError("Gnani connection timed out")
                await connected
                attempts = 0
                generation += 1
                while not frames.empty():
                    frames.get_nowait()
                await websocket.send_json({"type": "ready", "sampleRate": 16000, "frameBytes": FRAME_BYTES})
                sender = asyncio.create_task(send_audio(stream, frames))
                events = asyncio.create_task(forward_events(stream, websocket, deduper, f"{session_id}-{generation}-"))
                done, _ = await asyncio.wait({reader, sender, events}, timeout=max(0, deadline-time.monotonic()), return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    break
                if reader in done:
                    break
                for task in done:
                    await task
                raise ConnectionError("Gnani stream ended")
            except (Exception, asyncio.TimeoutError) as exc:
                if stopped.is_set():
                    break
                attempts += 1
                if attempts >= 3:
                    await websocket.send_json({"type": "fallback", "message": "Realtime STT unavailable. Switching to automatic REST segmentation."})
                    break
                await websocket.send_json({"type": "reconnecting", "attempt": attempts, "message": str(exc)[:120]})
                try:
                    await asyncio.wait_for(stopped.wait(), timeout=min(attempts, 3))
                except asyncio.TimeoutError:
                    pass
            finally:
                for task in (connected, sender, events):
                    if task and not task.done():
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                await stream.close()
    finally:
        release_voice(user['id'], slot, lease_token)
        stopped.set()
        if not reader.done():
            reader.cancel()
            try:
                await reader
            except asyncio.CancelledError:
                pass
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
