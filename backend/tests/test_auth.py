import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import app
import auth


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'accounts.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    monkeypatch.delenv('GNANI_API_KEY', raising=False)
    with TestClient(app) as value:
        yield value


def test_account_session_and_private_project(client):
    assert client.get('/api/auth/me').status_code == 401
    assert client.post('/api/plan', json={'text': 'Add Redis'}).status_code == 401
    account = {'email': ' Test@Example.COM ', 'password': 'correct-horse-battery'}
    created = client.post('/api/auth/sign-up', json=account)
    assert created.status_code == 201
    assert created.json()['user']['email'] == 'test@example.com'
    assert 'httponly' in created.headers['set-cookie'].lower()
    assert 'samesite=lax' in created.headers['set-cookie'].lower()
    assert client.get('/api/auth/me').json()['user']['email'] == 'test@example.com'
    assert client.post('/api/plan', json={'text': 'Add Redis'}).status_code == 200
    assert client.post('/api/plan', json={'text': 'Remember that PostgreSQL database already has failover outside this diagram'}).json()['actions'] == [
        {'type': 'REMEMBER_NOTE', 'note': 'PostgreSQL database already has failover outside this diagram'}]
    assert client.post('/api/plan', json={'text': 'Forget that PostgreSQL database already has failover outside this diagram'}).json()['actions'][0]['type'] == 'FORGET_NOTE'
    assert client.get('/api/project').json()['project'] is None
    project = {'format': 'bolcanvas-project', 'version': 2, 'scene': {'nodes': []}, 'logs': [], 'latest': ''}
    assert client.put('/api/project', json={'project': project}).status_code == 200
    assert client.get('/api/project').json()['project'] == project
    assert client.post('/api/auth/sign-up', json=account).status_code == 409

    with TestClient(app) as other:
        assert other.post('/api/auth/sign-up', json={'email': 'other@example.com', 'password': 'another-long-password'}).status_code == 201
        assert other.get('/api/project').json()['project'] is None
        assert other.put('/api/project', json={'project': {'scene': {}}}).status_code == 422
    assert client.get('/api/project').json()['project'] == project


def test_login_logout_password_change_and_csrf_origin(client):
    email = 'member@example.com'
    password = 'initial-long-password'
    assert client.post('/api/auth/sign-up', json={'email': email, 'password': 'short'}).status_code == 422
    assert client.post('/api/auth/sign-up', json={'email': email, 'password': password}).status_code == 201
    original = client.cookies.get('bolcanvas_session')
    assert client.post('/api/auth/sign-in', json={'email': email, 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/auth/change-password', json={'current_password': 'wrong-password', 'new_password': 'new-long-password'}).status_code == 401
    assert client.post('/api/auth/change-password', json={'current_password': password, 'new_password': 'new-long-password'}).status_code == 200
    with TestClient(app) as stale:
        stale.cookies.set('bolcanvas_session', original)
        assert stale.get('/api/auth/me').status_code == 401
    assert client.post('/api/auth/sign-in', json={'email': email, 'password': password}).status_code == 401
    assert client.post('/api/auth/sign-in', json={'email': email, 'password': 'new-long-password'}).status_code == 200
    assert client.put('/api/project', json={'project': {}}, headers={'origin': 'https://attacker.example'}).status_code == 403
    token = client.cookies.get('bolcanvas_session')
    with TestClient(app) as forged:
        forged.cookies.set('bolcanvas_session', token[:-1] + ('x' if token[-1] != 'x' else 'y'))
        assert forged.get('/api/auth/me').status_code == 401
    assert client.post('/api/auth/sign-out').status_code == 200
    assert client.get('/api/auth/me').status_code == 401


def test_postgres_connection_and_parameter_style(monkeypatch):
    calls = []

    class FakeConnection:
        def execute(self, query, params):
            calls.append((query, params))

    connection = FakeConnection()
    monkeypatch.setenv('DATABASE_URL', 'postgresql://example.invalid/pooled')
    monkeypatch.setenv('DATABASE_URL_UNPOOLED', 'postgresql://example.invalid/direct')
    monkeypatch.setattr(auth.psycopg, 'connect', lambda url, row_factory: calls.append(('connect', url)) or connection)
    assert auth.connect() is connection
    assert auth.connect(schema=True) is connection
    assert calls == [('connect', 'postgresql://example.invalid/pooled'), ('connect', 'postgresql://example.invalid/direct')]
    calls.clear()
    auth.execute(connection, 'SELECT * FROM users WHERE id = ?', ('123',))
    assert calls == [('SELECT * FROM users WHERE id = %s', ('123',))]
