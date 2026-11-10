import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth


def test_legacy_migration_and_private_diagrams(tmp_path, monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('DATABASE_URL_UNPOOLED', raising=False)
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'accounts.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    old = {'format': 'bolcanvas-project', 'version': 2,
           'scene': {'nodes': [{'id': 'a', 'label': 'Gateway'}], 'edges': [], 'context': {'type': 'architecture', 'purpose': 'Checkout demo'}, 'past': [{'nodes': []}]},
           'logs': [], 'latest': ''}
    auth.init_db()
    with auth.connect() as db:
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
                     ('legacy', 'legacy@example.com', 'unused', 1))
        auth.execute(db, 'INSERT INTO projects (user_id, body, updated_at) VALUES (?, ?, ?)',
                     ('legacy', json.dumps(old), 42))
    auth.init_db()
    auth.init_db()
    with auth.connect() as db:
        rows = auth.execute(db, 'SELECT * FROM diagram_projects WHERE user_id = ?', ('legacy',)).fetchall()
    assert len(rows) == 1
    assert rows[0]['id'] == 'legacy'
    assert json.loads(rows[0]['body']) == old
    assert rows[0]['name'] == 'Checkout demo'
    assert auth.get_project({'id': 'legacy'})['project'] == old

    blank = {'format': 'bolcanvas-project', 'version': 2,
             'scene': {'nodes': [], 'edges': [], 'context': {'type': None, 'purpose': ''}, 'past': [], 'future': []},
             'logs': [], 'latest': ''}
    with auth.connect() as db:
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', ('one', 'one@example.com', 'unused', 1))
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', ('two', 'two@example.com', 'unused', 1))
    first, second = {'id': 'one'}, {'id': 'two'}
    assert auth.list_projects(0, first)['projects'] == []
    one = auth.create_project({'name': 'First', 'project': blank}, first)['id']
    two = auth.create_project({'name': 'Second', 'project': blank}, first)['id']
    assert one != two
    changed = {**blank, 'scene': {**blank['scene'], 'nodes': [{'id': 'b', 'label': 'Orders'}]}}
    auth.put_diagram(one, {'project': changed}, first)
    assert auth.get_diagram(one, first)['project'] == changed
    assert auth.get_diagram(two, first)['project'] == blank
    cards = auth.list_projects(0, first)['projects']
    assert len(cards) == 1
    assert next(card for card in cards if card['id'] == one)['node_count'] == 1
    assert 'past' not in cards[0]['preview']
    with pytest.raises(HTTPException):
        auth.get_diagram(two, first)
    assert auth.rename_diagram(one, {'name': 'Renamed'}, first)['name'] == 'Renamed'
    for operation in (lambda: auth.get_diagram(one, second),
                      lambda: auth.put_diagram(one, {'project': blank}, second),
                      lambda: auth.rename_diagram(one, {'name': 'Stolen'}, second),
                      lambda: auth.delete_diagram(one, second)):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 404
    assert auth.list_projects(0, second)['projects'] == []
    auth.delete_diagram(one, first)
    with pytest.raises(HTTPException):
        auth.get_diagram(one, first)
    for index in range(13):
        auth.create_project({'name': f'Extra {index}', 'project': changed}, first)
    assert len(auth.list_projects(0, first)['projects']) == 12
    assert auth.list_projects(0, first)['has_more'] is True
    assert len(auth.list_projects(12, first)['projects']) == 1
    auth.put_project({'project': blank}, {'id': 'legacy'})
    assert auth.get_diagram('legacy', {'id': 'legacy'})['project'] == blank


def test_empty_canvases_are_discarded_even_with_history_or_transcript(tmp_path, monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.delenv('DATABASE_URL_UNPOOLED', raising=False)
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'accounts.sqlite3'))
    monkeypatch.setenv('AUTH_SECRET_KEY', 'test-secret-' * 8)
    auth.init_db()
    user = {'id': 'owner'}
    with auth.connect() as db:
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
                     ('owner', 'owner@example.com', 'unused', 1))
    blank = {'format': 'bolcanvas-project', 'version': 2,
             'scene': {'nodes': [], 'edges': [], 'extras': [], 'context': {'type': None, 'purpose': ''},
                       'past': [], 'future': []}, 'logs': [], 'latest': ''}
    old_blank = auth.create_project({'name': 'Old blank', 'project': blank}, user)['id']
    recent_blank = auth.create_project({'name': 'Recent blank', 'project': blank}, user)['id']
    renamed_blank = auth.create_project({'name': 'Rename me', 'project': blank}, user)['id']
    with_drawing = auth.create_project({'name': 'Drawing', 'project': {**blank, 'scene': {**blank['scene'], 'extras': [{'id': 'stroke'}]}}}, user)['id']
    with_history = auth.create_project({'name': 'Can undo', 'project': {**blank, 'scene': {**blank['scene'], 'past': [{'nodes': [{'id': 'node'}]}]}}}, user)['id']
    with_note = auth.create_project({'name': 'Has note', 'project': {**blank, 'scene': {**blank['scene'], 'context': {'type': None, 'purpose': '', 'notes': ['Keep this']}}}}, user)['id']
    with_container = auth.create_project({'name': 'Has container', 'project': {**blank, 'scene': {**blank['scene'], 'containers': [{'id': 'group'}]}}}, user)['id']
    with_transcript = auth.create_project({'name': 'Has transcript', 'project': {**blank, 'latest': 'Keep this transcript'}}, user)['id']
    auth.rename_diagram(renamed_blank, {'name': 'Kept draft'}, user)
    cards = auth.list_projects(0, user)['projects']
    by_id = {card['id']: card for card in cards}
    assert old_blank not in by_id
    assert recent_blank not in by_id
    assert renamed_blank not in by_id
    assert all(project_id in by_id for project_id in (with_drawing, with_container))
    assert all(project_id not in by_id for project_id in (with_history, with_note, with_transcript))
    with pytest.raises(HTTPException) as error:
        auth.get_diagram(old_blank, user)
    assert error.value.status_code == 404
