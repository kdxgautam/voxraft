import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from visual_agent import VisualContainer, VisualRequest, inspect_connections, proposal, role, run_visual_design


def diagram():
    return VisualRequest(
        nodes=[{'id': 'gw', 'label': 'API Gateway', 'color': '#6366f1'},
               {'id': 'auth', 'label': 'Auth Service', 'color': '#6366f1'},
               {'id': 'db', 'label': 'PostgreSQL database', 'color': '#6366f1'},
               {'id': 'replica', 'label': 'PostgreSQL replica', 'color': '#6366f1'}],
        edges=[{'id': 'one', 'sourceId': 'gw', 'targetId': 'auth', 'label': 'HTTPS'},
               {'id': 'two', 'sourceId': 'auth', 'targetId': 'db', 'label': 'SQL'},
               {'id': 'three', 'sourceId': 'db', 'targetId': 'replica', 'label': 'replication'}],
        groups=[{'name': 'Application', 'nodeIds': ['auth']}],
        diagram_context={'type': 'architecture'},
    )


def test_grounded_visual_proposal_respects_roles_groups_and_connections():
    request = diagram()
    result = proposal(request, 'rules', ['inspect_roles', 'inspect_connections'], 'groups')
    assert role('PostgreSQL replica') == 'replica'
    assert result['node_styles']['gw']['color'] != result['node_styles']['db']['color']
    assert result['node_styles']['db']['fontFamily'] == 3
    assert result['node_styles']['auth']['fontFamily'] == 2
    assert result['edge_styles']['two']['color'] == result['node_styles']['db']['color']
    assert result['edge_styles']['three']['color'] == result['node_styles']['replica']['color']
    assert inspect_connections(request)['edges'][0]['source'] == 'API Gateway'


def test_model_selects_tools_but_server_constructs_styles():
    calls = []
    async def choose(messages):
        calls.append(messages)
        return ({'tool': 'inspect_roles'} if len(calls) == 1 else
                {'tool': 'inspect_connections'} if len(calls) == 2 else
                {'tool': 'finish', 'emphasis': 'groups'})
    result = asyncio.run(run_visual_design(diagram(), choose=choose))
    assert result['mode'] == 'agent'
    assert result['tools_used'] == ['inspect_roles', 'inspect_connections']
    assert set(result['node_styles']) == {'gw', 'auth', 'db', 'replica'}


def test_bad_model_output_falls_back_to_labeled_rules():
    async def bad(_messages):
        return {'tool': 'invent_palette'}
    result = asyncio.run(run_visual_design(diagram(), choose=bad))
    assert result['mode'] == 'rules'
    assert result['edge_styles']['three']['fontFamily'] == 3


def test_visible_container_guides_group_emphasis_without_changing_membership():
    request = diagram()
    request.groups = []
    request.containers = [VisualContainer(id='c1', name='Backend tier', nodeIds=['auth'])]
    result = asyncio.run(run_visual_design(request))
    assert result['roles'][1]['group'] == 'Backend tier'
    assert result['node_styles']['auth']['color'] == '#6259a6'
    assert result['container_styles']['c1']['color'] == '#6259a6'
    assert request.containers[0].nodeIds == ['auth']


def test_nested_boundary_style_uses_explicit_name_only():
    request = diagram()
    request.containers = [VisualContainer(id='outer', name='Zone A', nodeIds=[], collapsed=False),
                          VisualContainer(id='inner', name='Database tier', nodeIds=['db'], parentId='outer')]
    styles = proposal(request, 'rules', [], 'groups')['container_styles']
    assert styles['outer']['color'] == '#65748b'
    assert styles['inner']['color'] == '#187d70'
    assert 'Zone A' in proposal(request, 'rules', [], 'groups')['boundary_questions'][0]


def test_shapes_are_optional_grounded_and_keep_user_choices():
    request = VisualRequest(
        nodes=[{'id': 'start', 'label': 'Start', 'shape': 'rectangle'},
               {'id': 'decision', 'label': 'Payment approved?', 'shape': 'rectangle'},
               {'id': 'auth', 'label': 'Auth Service', 'shape': 'rectangle'},
               {'id': 'chosen', 'label': 'End', 'shape': 'rectangle', 'shapeSource': 'explicit'},
               {'id': 'legacy', 'label': 'Start', 'shape': 'diamond'},
               {'id': 'db', 'label': 'PostgreSQL database', 'shape': 'rectangle'}],
            edges=[], diagram_context={'type': 'architecture'})
    assert proposal(request, 'rules', [], 'roles')['shape_suggestions'] == {}
    request.suggest_shapes = True
    shapes = proposal(request, 'rules', [], 'roles')['shape_suggestions']
    assert set(shapes) == {'start', 'decision', 'db'}
    assert shapes['start']['shape'] == 'ellipse'
    assert shapes['decision']['shape'] == 'diamond'
    assert shapes['db']['shape'] == 'cylinder'
    assert all(item['reason'] for item in shapes.values())
    request.reconsider_explicit_shapes = True
    assert proposal(request, 'rules', [], 'roles')['shape_suggestions']['chosen']['shape'] == 'ellipse'


def test_explicit_role_wins_over_conflicting_label_when_suggesting_shapes():
    request = VisualRequest(nodes=[
        {'id': 'note', 'label': 'PostgreSQL', 'shape': 'rectangle', 'role': 'note', 'roleSource': 'explicit'},
        {'id': 'decision', 'label': 'PostgreSQL', 'shape': 'rectangle', 'role': 'decision', 'roleSource': 'explicit'},
        {'id': 'start', 'label': 'PostgreSQL', 'shape': 'rectangle', 'role': 'start', 'roleSource': 'explicit'},
    ], edges=[], suggest_shapes=True)
    shapes = proposal(request, 'rules', [], 'roles')['shape_suggestions']
    assert 'note' not in shapes
    assert shapes['decision']['shape'] == 'diamond'
    assert shapes['start']['shape'] == 'ellipse'
