import asyncio
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth
from main import app


def test_limits_are_shared_in_database(tmp_path, monkeypatch):
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'limits.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    now = [1000]
    monkeypatch.setattr(auth.time, 'time', lambda: now[0])
    auth.init_db()
    auth.check_rate_limit('account:x', 2, 60)
    auth.check_rate_limit('account:x', 2, 60)
    with pytest.raises(auth.HTTPException) as denied:
        auth.check_rate_limit('account:x', 2, 60)
    assert denied.value.status_code == 429
    now[0] += 61
    auth.check_rate_limit('account:x', 2, 60)
    first = auth.reserve_voice('x')
    second = auth.reserve_voice('x')
    assert first and second and auth.reserve_voice('x') is None
    auth.release_voice('x', *first)
    assert auth.reserve_voice('x')


def test_body_limit_before_parsing(tmp_path, monkeypatch):
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'limits.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    auth.init_db()
    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver') as client:
            oversized = await client.post('/api/plan', content=b'x' * 3_500_001)
            assert oversized.status_code == 413
            async def chunks():
                yield b'x' * 2_000_000
                yield b'x' * 2_000_000
            streamed = await client.post('/api/plan', content=chunks())
            assert streamed.status_code == 413
            small = await client.post('/api/health', content=b'ok')
            assert small.status_code == 405
    asyncio.run(check())


def test_public_signup_limit_and_local_plans(tmp_path, monkeypatch):
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'limits.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    with TestClient(app) as client:
        for _ in range(5):
            assert client.post('/api/auth/sign-up', json={'email':'short@example.test','password':'short'}).status_code == 422
        assert client.post('/api/auth/sign-up', json={'email':'short@example.test','password':'short'}).status_code == 429
        auth.init_db()
        with auth.connect() as db:
            auth.execute(db, 'DELETE FROM request_limits')
        assert client.post('/api/auth/sign-up', json={'email':'good@example.test','password':'long-test-password'}).status_code == 201
        for _ in range(61):
            assert client.post('/api/plan', json={'text':'Add Redis'}).status_code == 200


def test_local_plans_do_not_spend_model_quota(tmp_path, monkeypatch):
    import main

    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'limits.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    auth.init_db()

    class Planner:
        async def post(self, url, **kwargs):
            return httpx.Response(200, request=httpx.Request('POST', url),
                                  json={'choices': [{'message': {'content': '{"actions":[],"question":"Which part?"}'}}]})

    monkeypatch.setattr(main.app.state, 'planner_client', Planner(), raising=False)

    async def check():
        user = {'id': 'test-account'}
        local = main.PlanRequest(text='Add Redis', diagram_context={'type': 'architecture'})
        complex_command = main.PlanRequest(text='Could you diagram the dependencies?', diagram_context={'type': 'architecture'})
        for _ in range(61):
            assert (await main.plan(local, user))['mode'] == 'fallback'
        for _ in range(60):
            assert (await main.plan(complex_command, user))['mode'] == 'llm'
        with pytest.raises(auth.HTTPException) as denied:
            await main.plan(complex_command, user)
        assert denied.value.status_code == 429
        assert (await main.plan(local, user))['mode'] == 'fallback'

    asyncio.run(check())
