import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from canvas_context import canvas_facts


def test_context_tracks_direction_nested_membership_and_hidden_nodes():
    nodes = [{'id': 'auth'}, {'id': 'db'}, {'id': 'outside'}]
    edges = [{'sourceId': 'auth', 'targetId': 'db'}, {'sourceId': 'missing', 'targetId': 'auth'}]
    containers = [{'id': 'backend', 'nodeIds': ['auth'], 'parentId': 'platform', 'collapsed': True},
                  {'id': 'platform', 'nodeIds': []}]
    facts = {item['id']: item for item in canvas_facts(nodes, edges, containers)}
    assert facts['auth']['outgoing_to'] == ['db']
    assert facts['auth']['container_path'] == ['platform', 'backend']
    assert facts['auth']['hidden_by_collapse'] is True
    assert facts['db']['incoming_from'] == ['auth']
    assert facts['outside']['container_path'] == []
    assert facts['outside']['hidden_by_collapse'] is False
    containers[1]['parentId'] = 'backend'
    assert len(canvas_facts(nodes, edges, containers)[0]['container_path']) == 2
