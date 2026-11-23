"""Account sessions and private diagrams."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid
from typing import Any

import jwt
import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, Depends, HTTPException, Request, Response, WebSocket, WebSocketException
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field
from pwdlib import PasswordHash

router = APIRouter(prefix='/api')
COOKIE = 'bolcanvas_session'
ISSUER = 'bolcanvas'
AUDIENCE = 'bolcanvas-app'
SESSION_SECONDS = 7 * 24 * 60 * 60
_dev_secret = secrets.token_urlsafe(48)
_passwords = PasswordHash.recommended()
_dummy_hash = _passwords.hash('not-a-real-password')


def database_path() -> Path:
    return Path(os.getenv('BOLCANVAS_DB_PATH') or str(Path(__file__).with_name('data') / 'bolcanvas.sqlite3'))


def secret_key() -> str:
    key = os.getenv('AUTH_SECRET_KEY', '').strip()
    if not key and os.getenv('STATIC_DIR'):
        raise RuntimeError('AUTH_SECRET_KEY is required when serving the production frontend.')
    if key and len(key) < 32:
        raise RuntimeError('AUTH_SECRET_KEY must contain at least 32 characters.')
    return key or _dev_secret


def connect(*, schema: bool = False) -> Any:
    database_url = ((os.getenv('DATABASE_URL_UNPOOLED') if schema else None) or os.getenv('DATABASE_URL') or '').strip()
    if database_url:
        return psycopg.connect(database_url, row_factory=dict_row)
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


def execute(db: Any, query: str, params: tuple = ()) -> Any:
    # All queries are fixed strings; psycopg uses %s where sqlite uses ?.
    return db.execute(query if isinstance(db, sqlite3.Connection) else query.replace('?', '%s'), params)


def init_db() -> None:
    secret_key()
    with closing(connect(schema=True)) as db, db:
        for query in ('''
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
              created_at INTEGER NOT NULL
            )
        ''', '''
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at INTEGER NOT NULL
            )
        ''', '''
            CREATE TABLE IF NOT EXISTS projects (
              user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
              body TEXT NOT NULL, updated_at INTEGER NOT NULL
            )
        ''', '''
            CREATE TABLE IF NOT EXISTS diagram_projects (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              name TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            )
        ''', '''
            CREATE INDEX IF NOT EXISTS diagram_projects_owner_updated ON diagram_projects(user_id, updated_at DESC)
        ''', '''
            CREATE TABLE IF NOT EXISTS diagram_shares (
              project_id TEXT PRIMARY KEY REFERENCES diagram_projects(id) ON DELETE CASCADE,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
            )
        ''', '''
            CREATE TABLE IF NOT EXISTS request_limits (
              key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
            )
        ''', '''
            CREATE INDEX IF NOT EXISTS request_limits_window ON request_limits(window_start)
        ''', '''
            CREATE TABLE IF NOT EXISTS voice_sessions (
              user_id TEXT NOT NULL, slot INTEGER NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL,
              PRIMARY KEY(user_id, slot)
            )
        '''):
            execute(db, query)
        # The original account diagram keeps a stable ID. Re-running startup never duplicates it.
        for row in execute(db, 'SELECT user_id, body, updated_at FROM projects').fetchall():
            context = ((json.loads(row['body']).get('scene') or {}).get('context') or {})
            name = str(context.get('purpose') or '').strip()[:100] or 'Untitled diagram'
            execute(db, '''INSERT INTO diagram_projects (id, user_id, name, body, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING''',
                    (row['user_id'], row['user_id'], name, row['body'], row['updated_at'], row['updated_at']))


def normalized_email(value: str) -> str:
    email = value.strip().casefold()
    if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise HTTPException(422, 'Enter a valid email address.')
    return email


def check_rate_limit(key: str, limit: int, seconds: int) -> None:
    now = int(time.time())
    with closing(connect()) as db, db:
        execute(db, 'DELETE FROM request_limits WHERE window_start < ?', (now - 3600,))
        execute(db, '''INSERT INTO request_limits (key, window_start, count) VALUES (?, ?, 1)
                      ON CONFLICT(key) DO UPDATE SET
                      count = CASE WHEN request_limits.window_start <= ? THEN 1 ELSE request_limits.count + 1 END,
                      window_start = CASE WHEN request_limits.window_start <= ? THEN excluded.window_start ELSE request_limits.window_start END''',
                (key, now, now - seconds, now - seconds))
        count = execute(db, 'SELECT count FROM request_limits WHERE key = ?', (key,)).fetchone()['count']
    if count > limit:
        raise HTTPException(429, 'Too many requests. Please try again later.')


def reserve_voice(user_id: str) -> tuple[int, str] | None:
    now, token = int(time.time()), secrets.token_urlsafe(16)
    with closing(connect()) as db, db:
        for slot in range(2):
            result = execute(db, '''INSERT INTO voice_sessions (user_id, slot, token, expires_at) VALUES (?, ?, ?, ?)
                                ON CONFLICT(user_id, slot) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
                                WHERE voice_sessions.expires_at < ?''', (user_id, slot, token, now + 300, now))
            if result.rowcount:
                return slot, token
    return None


def release_voice(user_id: str, slot: int, token: str) -> None:
    with closing(connect()) as db, db:
        execute(db, 'DELETE FROM voice_sessions WHERE user_id = ? AND slot = ? AND token = ?', (user_id, slot, token))


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=128)


def public_user(row: Any) -> dict[str, str]:
    return {'id': row['id'], 'email': row['email']}


def set_session(response: Response, request: Request, user_id: str) -> None:
    token_id = uuid.uuid4().hex
    expires = int(time.time()) + SESSION_SECONDS
    with closing(connect()) as db, db:
        execute(db, 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', (token_id, user_id, expires))
        execute(db, 'DELETE FROM sessions WHERE expires_at < ?', (int(time.time()),))
    token = jwt.encode({'sub': user_id, 'jti': token_id, 'iss': ISSUER, 'aud': AUDIENCE,
                        'iat': datetime.now(timezone.utc), 'exp': datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS)},
                       secret_key(), algorithm='HS256')
    secure = request.url.scheme == 'https' or request.headers.get('x-forwarded-proto') == 'https'
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=secure, samesite='lax', path='/')


def authenticate(token: str | None) -> tuple[dict[str, str], str] | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, secret_key(), algorithms=['HS256'], audience=AUDIENCE, issuer=ISSUER,
                             options={'require': ['sub', 'jti', 'iat', 'exp']})
    except (InvalidTokenError, RuntimeError):
        return None
    if not isinstance(payload.get('sub'), str) or not isinstance(payload.get('jti'), str):
        return None
    with closing(connect()) as db:
        row = execute(db, '''SELECT users.id, users.email FROM sessions
                            JOIN users ON users.id = sessions.user_id
                            WHERE sessions.id = ? AND users.id = ? AND sessions.expires_at > ?''',
                         (payload['jti'], payload['sub'], int(time.time()))).fetchone()
    return (public_user(row), payload['jti']) if row else None


def require_user(request: Request) -> dict[str, str]:
    result = authenticate(request.cookies.get(COOKIE))
    if not result:
        raise HTTPException(401, 'Sign in to continue.')
    return result[0]


def require_ws_user(websocket: WebSocket) -> dict[str, str]:
    result = authenticate(websocket.cookies.get(COOKIE))
    if not result:
        raise WebSocketException(code=1008, reason='Sign in to continue.')
    return result[0]


@router.post('/auth/sign-up', status_code=201)
def sign_up(credentials: Credentials, request: Request, response: Response):
    email = normalized_email(credentials.email)
    check_rate_limit(f'sign-up:{request.client.host if request.client else "unknown"}', 5, 3600)
    check_rate_limit('sign-up:global', 100, 3600)
    if len(credentials.password) < 12:
        raise HTTPException(422, 'Use a password with at least 12 characters.')
    user_id = uuid.uuid4().hex
    try:
        with closing(connect()) as db, db:
            execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
                       (user_id, email, _passwords.hash(credentials.password), int(time.time())))
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        raise HTTPException(409, 'An account with this email already exists.') from None
    set_session(response, request, user_id)
    return {'user': {'id': user_id, 'email': email}}


@router.post('/auth/sign-in')
def sign_in(credentials: Credentials, request: Request, response: Response):
    email = normalized_email(credentials.email)
    check_rate_limit(f'sign-in-ip:{request.client.host if request.client else "unknown"}', 30, 300)
    check_rate_limit(f'sign-in-account:{email}', 10, 300)
    check_rate_limit('sign-in:global', 300, 300)
    with closing(connect()) as db:
        row = execute(db, 'SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    if not _passwords.verify(credentials.password, row['password_hash'] if row else _dummy_hash) or not row:
        raise HTTPException(401, 'Invalid email or password.')
    set_session(response, request, row['id'])
    return {'user': public_user(row)}


@router.get('/auth/me')
def me(user: dict[str, str] = Depends(require_user)):
    return {'user': user}


@router.post('/auth/sign-out')
def sign_out(request: Request, response: Response, user: dict[str, str] = Depends(require_user)):
    result = authenticate(request.cookies.get(COOKIE))
    if result:
        with closing(connect()) as db, db:
            execute(db, 'DELETE FROM sessions WHERE id = ? AND user_id = ?', (result[1], user['id']))
    response.delete_cookie(COOKIE, path='/')
    return {'ok': True}


@router.post('/auth/change-password')
def change_password(body: PasswordChange, request: Request, response: Response, user: dict[str, str] = Depends(require_user)):
    with closing(connect()) as db:
        row = execute(db, 'SELECT password_hash FROM users WHERE id = ?', (user['id'],)).fetchone()
    if not row or not _passwords.verify(body.current_password, row['password_hash']):
        raise HTTPException(401, 'Current password is incorrect.')
    with closing(connect()) as db, db:
        execute(db, 'UPDATE users SET password_hash = ? WHERE id = ?', (_passwords.hash(body.new_password), user['id']))
        execute(db, 'DELETE FROM sessions WHERE user_id = ?', (user['id'],))
    set_session(response, request, user['id'])
    return {'ok': True}


@router.get('/project')
def get_project(user: dict[str, str] = Depends(require_user)):
    with closing(connect()) as db:
        row = execute(db, 'SELECT body, updated_at FROM diagram_projects WHERE id = ? AND user_id = ?', (user['id'], user['id'])).fetchone()
    return {'project': json.loads(row['body']) if row else None, 'updated_at': row['updated_at'] if row else None}


@router.put('/project')
def put_project(body: dict, user: dict[str, str] = Depends(require_user)):
    encoded = encoded_project(body.get('project'))
    updated = int(time.time())
    with closing(connect()) as db, db:
        execute(db, '''INSERT INTO diagram_projects (id, user_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at''',
                (user['id'], user['id'], 'Untitled diagram', encoded, updated, updated))
    return {'updated_at': updated}


def encoded_project(project: Any) -> str:
    if not isinstance(project, dict) or project.get('format') != 'bolcanvas-project' or project.get('version') != 2 or not isinstance(project.get('scene'), dict):
        raise HTTPException(422, 'Invalid project file.')
    encoded = json.dumps(project, ensure_ascii=False, separators=(',', ':'))
    if len(encoded.encode('utf-8')) > 3_000_000:
        raise HTTPException(413, 'Project is too large.')
    return encoded


def project_row(project_id: str, user_id: str) -> Any:
    with closing(connect()) as db:
        row = execute(db, 'SELECT * FROM diagram_projects WHERE id = ? AND user_id = ?', (project_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Diagram not found.')
    return row


def is_empty_canvas(project: dict[str, Any]) -> bool:
    scene = project.get('scene')
    if not isinstance(scene, dict):
        return False
    return not any(scene.get(key) for key in ('nodes', 'edges', 'extras', 'groups', 'containers'))


@router.get('/projects')
def list_projects(offset: int = 0, user: dict[str, str] = Depends(require_user)):
    if offset < 0:
        raise HTTPException(422, 'Invalid page offset.')
    limit = 12
    with closing(connect()) as db, db:
        drafts = execute(db, 'SELECT id, body, updated_at FROM diagram_projects WHERE user_id = ?',
                         (user['id'],)).fetchall()
        for row in drafts:
            if is_empty_canvas(json.loads(row['body'])):
                execute(db, 'DELETE FROM diagram_projects WHERE id = ? AND user_id = ? AND updated_at = ?',
                        (row['id'], user['id'], row['updated_at']))
        rows = execute(db, '''SELECT id, name, body, created_at, updated_at FROM diagram_projects
                            WHERE user_id = ? ORDER BY updated_at DESC, id LIMIT ? OFFSET ?''',
                       (user['id'], limit + 1, offset)).fetchall()
    items = []
    for row in rows[:limit]:
        project = json.loads(row['body'])
        scene = project.get('scene') or {}
        context = scene.get('context') or {}
        items.append({'id': row['id'], 'name': row['name'], 'created_at': row['created_at'],
                      'updated_at': row['updated_at'], 'type': context.get('type'),
                      'purpose': context.get('purpose', ''),
                      'node_count': len(scene.get('nodes') or []),
                      'edge_count': len(scene.get('edges') or []),
                      'preview': {key: scene.get(key) for key in ('nodes', 'edges', 'containers', 'extras')}})
    return {'projects': items, 'has_more': len(rows) > limit}


@router.post('/projects', status_code=201)
def create_project(body: dict, user: dict[str, str] = Depends(require_user)):
    encoded = encoded_project(body.get('project'))
    name = body.get('name', 'Untitled diagram')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise HTTPException(422, 'Enter a diagram name up to 100 characters.')
    project_id, updated = uuid.uuid4().hex, int(time.time())
    with closing(connect()) as db, db:
        result = execute(db, '''INSERT INTO diagram_projects (id, user_id, name, body, created_at, updated_at)
                             SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM diagram_projects WHERE user_id = ?) < 50''',
                         (project_id, user['id'], name.strip(), encoded, updated, updated, user['id']))
        if not result.rowcount:
            raise HTTPException(429, 'Diagram limit reached. Delete a diagram before creating another.')
    return {'id': project_id, 'name': name.strip(), 'updated_at': updated}


@router.get('/projects/{project_id}')
def get_diagram(project_id: str, user: dict[str, str] = Depends(require_user)):
    row = project_row(project_id, user['id'])
    return {'id': row['id'], 'name': row['name'], 'project': json.loads(row['body']), 'updated_at': row['updated_at']}


@router.put('/projects/{project_id}')
def put_diagram(project_id: str, body: dict, user: dict[str, str] = Depends(require_user)):
    encoded = encoded_project(body.get('project'))
    updated = int(time.time())
    with closing(connect()) as db, db:
        result = execute(db, 'UPDATE diagram_projects SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?',
                         (encoded, updated, project_id, user['id']))
        if not result.rowcount:
            raise HTTPException(404, 'Diagram not found.')
    return {'updated_at': updated}


@router.patch('/projects/{project_id}')
def rename_diagram(project_id: str, body: dict, user: dict[str, str] = Depends(require_user)):
    name = body.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise HTTPException(422, 'Enter a diagram name up to 100 characters.')
    updated = int(time.time())
    with closing(connect()) as db, db:
        result = execute(db, 'UPDATE diagram_projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
                         (name.strip(), updated, project_id, user['id']))
        if not result.rowcount:
            raise HTTPException(404, 'Diagram not found.')
    return {'name': name.strip(), 'updated_at': updated}


@router.delete('/projects/{project_id}')
def delete_diagram(project_id: str, user: dict[str, str] = Depends(require_user)):
    with closing(connect()) as db, db:
        result = execute(db, 'DELETE FROM diagram_projects WHERE id = ? AND user_id = ?', (project_id, user['id']))
        if not result.rowcount:
            raise HTTPException(404, 'Diagram not found.')
    return {'ok': True}


@router.get('/projects/{project_id}/share')
def share_status(project_id: str, user: dict[str, str] = Depends(require_user)):
    project_row(project_id, user['id'])
    with closing(connect()) as db:
        row = execute(db, 'SELECT token FROM diagram_shares WHERE project_id = ? AND user_id = ?', (project_id, user['id'])).fetchone()
    return {'token': row['token'] if row else None}


@router.post('/projects/{project_id}/share')
def create_share(project_id: str, user: dict[str, str] = Depends(require_user)):
    project_row(project_id, user['id'])
    with closing(connect()) as db, db:
        row = execute(db, 'SELECT token FROM diagram_shares WHERE project_id = ? AND user_id = ?', (project_id, user['id'])).fetchone()
        if row: return {'token': row['token']}
        token = secrets.token_urlsafe(32)
        execute(db, 'INSERT INTO diagram_shares (project_id, user_id, token, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO NOTHING',
                (project_id, user['id'], token, int(time.time())))
        saved = execute(db, 'SELECT token FROM diagram_shares WHERE project_id = ? AND user_id = ?', (project_id, user['id'])).fetchone()
    return {'token': saved['token']}


@router.delete('/projects/{project_id}/share')
def revoke_share(project_id: str, user: dict[str, str] = Depends(require_user)):
    project_row(project_id, user['id'])
    with closing(connect()) as db, db:
        execute(db, 'DELETE FROM diagram_shares WHERE project_id = ? AND user_id = ?', (project_id, user['id']))
    return {'ok': True}


@router.get('/shared/{token}')
def get_shared(token: str):
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token): raise HTTPException(404, 'Shared diagram not found.')
    with closing(connect()) as db:
        row = execute(db, '''SELECT p.name, p.body, p.updated_at FROM diagram_shares s
                            JOIN diagram_projects p ON p.id = s.project_id AND p.user_id = s.user_id
                            WHERE s.token = ?''', (token,)).fetchone()
    if not row: raise HTTPException(404, 'Shared diagram not found.')
    project = json.loads(row['body'])
    scene = project.get('scene') or {}
    visible_files = {item.get('fileId') for item in scene.get('extras') or [] if isinstance(item, dict) and item.get('type') == 'image' and not item.get('isDeleted')}
    return {'name': row['name'], 'updated_at': row['updated_at'],
            'diagram': {key: scene.get(key) or [] for key in ('nodes', 'edges', 'containers', 'extras')},
            'files': {key: value for key, value in (project.get('files') or {}).items() if key in visible_files}}
