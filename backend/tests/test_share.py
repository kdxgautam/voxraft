import json
import sys
from pathlib import Path

from fastapi import HTTPException
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth


def test_read_only_share_is_current_private_and_revocable(monkeypatch, tmp_path):
    monkeypatch.setenv('BOLCANVAS_DB_PATH', str(tmp_path / 'share.sqlite3'))
    auth.init_db()
    user = {'id': 'owner'}
    project = {'format': 'bolcanvas-project', 'version': 2,
               'scene': {'nodes': [{'id': 'n1', 'label': 'Private draft'}], 'edges': [], 'extras': [
                   {'id': 'i1', 'type': 'image', 'fileId': 'visible'}]},
               'files': {'visible': {'dataURL': 'data:image/png;base64,AA=='}, 'old': {'dataURL': 'data:image/png;base64,BB=='}},
               'logs': [{'text': 'private command'}]}
    with auth.connect() as db:
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', ('owner', 'owner@example.test', 'hash', 1))
        auth.execute(db, 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', ('other', 'other@example.test', 'hash', 1))
        auth.execute(db, 'INSERT INTO diagram_projects (id, user_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                     ('diagram', 'owner', 'My diagram', json.dumps(project), 1, 1))
    token = auth.create_share('diagram', user)['token']
    assert token == auth.create_share('diagram', user)['token']
    result = auth.get_shared(token)
    assert result['name'] == 'My diagram'
    assert result['diagram']['nodes'][0]['label'] == 'Private draft'
    assert list(result['files']) == ['visible']
    assert 'logs' not in result and 'context' not in result['diagram']
    with pytest.raises(HTTPException) as denied:
        auth.revoke_share('diagram', {'id': 'other'})
    assert denied.value.status_code == 404
    with auth.connect() as db:
        project['scene']['nodes'][0]['label'] = 'Updated draft'
        auth.execute(db, 'UPDATE diagram_projects SET body = ? WHERE id = ?', (json.dumps(project), 'diagram'))
    assert auth.get_shared(token)['diagram']['nodes'][0]['label'] == 'Updated draft'
    auth.revoke_share('diagram', user)
    with pytest.raises(HTTPException) as gone:
        auth.get_shared(token)
    assert gone.value.status_code == 404
