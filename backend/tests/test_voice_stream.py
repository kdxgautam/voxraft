import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import voice_stream as relay
from gnani.stt import StreamProcessingEvent, StreamTranscriptEvent


def transcript(text='Add Redis', segment_id='segment-1', final=True):
    return StreamTranscriptEvent(text=text, audio_duration_ms=900, segment_id=segment_id, segment_index='1', latency=100, timestamp='', raw={'is_final': final})


def test_completed_only_and_deduplicated():
    class Stream:
        async def __aiter__(self):
            yield StreamProcessingEvent(timestamp='', raw={})
            yield transcript(final=False)
            yield transcript()
            yield transcript()
            yield transcript(text='')
    class Socket:
        def __init__(self): self.messages=[]
        async def send_json(self, value): self.messages.append(value)
    socket=Socket()
    try: asyncio.run(relay.forward_events(Stream(),socket,relay.TranscriptDeduper()))
    except ConnectionError: pass
    assert [message['type'] for message in socket.messages] == ['transcribing','partial','completed','listening','listening']
    assert socket.messages[1]['text'] == 'Add Redis'


def test_repeated_undo_without_segment_ids(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(relay.time, 'monotonic', lambda: now[0])
    deduper = relay.TranscriptDeduper()
    assert deduper.accept('', 'Undo')
    now[0] += 0.2
    assert not deduper.accept('', 'Undo')
    now[0] += 0.6
    assert deduper.accept('', 'Undo')
    assert deduper.accept('segment-1', 'Undo')
    assert not deduper.accept('segment-1', 'Undo')


def test_stream_reconnects_and_recovers(monkeypatch):
    monkeypatch.setenv('GNANI_API_KEY','test-key')
    monkeypatch.setenv('GNANI_LANGUAGE','en-IN')
    class Socket:
        headers={'origin':'http://localhost:5173','host':'localhost:8000'}
        def __init__(self):
            self.messages=[];self.incoming=asyncio.Queue()
            self.incoming.put_nowait('{"type":"config","keyTerms":["Payments API","Redis"]}')
        async def accept(self): pass
        async def receive(self): return {'type':'websocket.receive','text':await self.incoming.get()}
        async def send_json(self,value):
            self.messages.append(value)
            if value['type']=='completed': self.incoming.put_nowait('stop')
        async def close(self,code=1000): pass
    calls=[]
    class Stream:
        def __init__(self,**kwargs): self.options=kwargs;calls.append(self)
        async def connect(self):
            if len(calls)==1: raise ConnectionError('temporary failure')
        async def send_audio(self,frame): pass
        async def close(self): pass
        async def __aiter__(self):
            yield transcript()
            await asyncio.sleep(60)
    monkeypatch.setattr(relay,'GnaniSTTStreamClient',Stream)
    monkeypatch.setattr(relay,'check_rate_limit',lambda *args: None)
    monkeypatch.setattr(relay,'reserve_voice',lambda *args: (0,'test-lease'))
    monkeypatch.setattr(relay,'release_voice',lambda *args: None)
    socket=Socket()
    asyncio.run(asyncio.wait_for(relay.voice_stream(socket,{'id':'test'}),timeout=5))
    assert [item['type'] for item in socket.messages] == ['reconnecting','ready','completed']
    assert len(calls)==2
    assert all(stream.options['language_code']=='en-IN' and stream.options['format']=='transcribe' for stream in calls)
    assert all(stream.options['keywords']==['Payments API','Redis'] for stream in calls)


def test_key_terms_drop_invalid_values():
    assert relay.parse_key_terms([' Redis ','Redis','<|bad|>','',4,'Payments API']) == ['Redis','Payments API']


def test_language_uses_configured_english_and_has_english_default(monkeypatch):
    monkeypatch.setenv('GNANI_LANGUAGE', 'en-IN')
    monkeypatch.setenv('GNANI_LANGUAGE_CODE', 'indic-auto')
    assert relay.configured_language() == 'en-IN'
    monkeypatch.delenv('GNANI_LANGUAGE')
    assert relay.configured_language() == 'en-IN'


def test_hosted_voice_origin_is_restricted(monkeypatch):
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://bolcanvas-example.onrender.com/')
    monkeypatch.setenv('VOICE_ALLOWED_ORIGINS', 'https://canvas.example.com')
    assert relay.allowed_origin('https://bolcanvas-example.onrender.com')
    assert relay.allowed_origin('https://canvas.example.com')
    assert relay.allowed_origin('http://localhost:5173', 'localhost:8000')
    assert relay.allowed_origin('http://127.0.0.1:5174', 'localhost:8000')
    assert not relay.allowed_origin('http://127.0.0.1:5174', 'canvas.example.com')
    assert not relay.allowed_origin('https://127.0.0.1:5174', 'localhost:8000')
    assert not relay.allowed_origin('https://another-app.onrender.com')
    assert not relay.allowed_origin('https://bolcanvas-example.onrender.com.attacker.example')
    assert not relay.allowed_origin(None)


def test_silence_and_bad_frames_are_ignored():
    class Socket:
        def __init__(self): self.messages=iter([{'type':'websocket.receive','bytes':b'bad'},{'type':'websocket.receive','bytes':b'\0'*1024},{'type':'websocket.receive','text':'stop'}])
        async def receive(self): return next(self.messages)
    frames=asyncio.Queue(maxsize=2);stopped=asyncio.Event()
    asyncio.run(relay.read_browser(Socket(),frames,stopped))
    assert stopped.is_set()
    assert frames.qsize()==1
