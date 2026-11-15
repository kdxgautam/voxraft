import os
from pathlib import Path
import subprocess
import sys


def test_frontend_and_api_share_the_production_server(tmp_path):
    (tmp_path / 'index.html').write_text('<html>BolCanvas deployment</html>')
    (tmp_path / 'pcm-worklet.js').write_text('// audio worklet')
    environment = {**os.environ, 'STATIC_DIR': str(tmp_path), 'AUTH_SECRET_KEY': 'test-secret-' * 8,
                   'BOLCANVAS_DB_PATH': str(tmp_path / 'accounts.sqlite3'),
                   'RENDER_EXTERNAL_URL': 'https://testserver', 'VOICE_ALLOWED_ORIGINS': ''}
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'GNANI_API_KEY'):
        environment.pop(key, None)
    # A fresh process tests the same import-time mount used by Uvicorn.
    result = subprocess.run([sys.executable, '-c', '''
from fastapi.testclient import TestClient
from main import app
with TestClient(app, base_url='https://testserver') as client:
    assert client.get('/').text == '<html>BolCanvas deployment</html>'
    assert client.get('/pcm-worklet.js').text == '// audio worklet'
    assert client.get('/api/health').json() == {'status': 'ok'}
    response = client.post('/api/plan', json={'text': 'Add Redis'})
    assert response.status_code == 401
    assert client.post('/api/auth/sign-up', json={'email':'demo@example.com','password':'long-demo-password'}).status_code == 201
    response = client.post('/api/plan', json={'text': 'Add Redis'})
    assert response.status_code == 200
    assert response.json()['actions'] == [{'type': 'ADD_NODE', 'label': 'Redis'}]
    assert client.get('/api/missing').status_code == 404
    assert client.get('/.env').status_code == 404
    assert client.get('/sign-in').text == '<html>BolCanvas deployment</html>'
    assert client.get('/dashboard').text == '<html>BolCanvas deployment</html>'
    assert client.get('/app/test-diagram-id').text == '<html>BolCanvas deployment</html>'
    assert client.get('/share/test-share-token').text == '<html>BolCanvas deployment</html>'
    with client.websocket_connect('wss://testserver/api/voice/stream', headers={'origin': 'https://testserver'}) as socket:
        assert socket.receive_json()['type'] == 'fallback'
'''], cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
