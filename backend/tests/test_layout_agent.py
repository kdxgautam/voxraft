import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from layout_agent import LayoutRequest, candidates, measure, run_layout_critique


def tangled():
    return LayoutRequest(nodes=[
        {"id": "a", "label": "A", "x": 100, "y": 100, "width": 160, "height": 80},
        {"id": "b", "label": "B", "x": 110, "y": 110, "width": 160, "height": 80},
        {"id": "c", "label": "C", "x": 120, "y": 120, "width": 160, "height": 80},
    ], edges=[{"id": "ab", "sourceId": "a", "targetId": "b"},
              {"id": "bc", "sourceId": "b", "targetId": "c"}])


def test_critique_measures_real_improvement_and_returns_only_positions():
    request = tangled()
    options = candidates(request)
    assert measure(request, options['current'])['overlaps'] == 3
    result = asyncio.run(run_layout_critique(request))
    assert result['selected'] in ('layered', 'grid')
    assert result['scores'][result['selected']]['score'] < result['scores']['current']['score']
    assert set(result['positions']) == {'a', 'b', 'c'}
    assert result['scores'][result['selected']]['overlaps'] == 0


def test_agent_uses_measured_tool_and_choice_is_bounded():
    calls = []
    async def choose(messages):
        calls.append(messages)
        return {'tool': 'compare_layouts'} if len(calls) == 1 else {'tool': 'finish', 'layout': 'layered'}
    result = asyncio.run(run_layout_critique(tangled(), choose=choose))
    assert result['mode'] == 'agent'
    assert result['tools_used'] == ['compare_layouts']
    assert len(calls) == 2


def test_invalid_agent_choice_falls_back_and_good_current_layout_has_no_edit():
    async def invalid(_messages):
        return {'tool': 'finish', 'layout': 'fiction'}
    result = asyncio.run(run_layout_critique(tangled(), choose=invalid))
    assert result['mode'] == 'rules'
    request = tangled()
    arranged = candidates(request)['layered']
    for node in request.nodes:
        node.x, node.y = arranged[node.id]
    result = asyncio.run(run_layout_critique(request, choose=invalid))
    assert result['positions'] is None
    assert result['selected'] == 'current'


def test_shared_database_stays_centered_and_isolated_blocks_get_separate_space():
    labels = ['API Gateway', 'Auth Service', 'Order Service', 'Billing Service',
              'PostgreSQL database', 'PostgreSQL database Replica']
    request = LayoutRequest(
        nodes=[{'id': str(i), 'label': label, 'x': 80 + 310 * (i % 5),
                'y': 100 + 160 * (i // 5), 'width': 220, 'height': 82}
               for i, label in enumerate(labels)],
        edges=[{'id': f'e{i}', 'sourceId': str(i), 'targetId': '4'} for i in (1, 2, 3)],
    )
    options = candidates(request)
    layered = options['layered']
    assert layered['4'][1] == layered['2'][1]
    assert layered['4'][0] > layered['1'][0]
    assert layered['0'][0] > layered['4'][0]
    assert layered['5'][0] == layered['0'][0]
    assert layered['5'][1] > layered['0'][1]
    assert measure(request, options['current'])['obstructions'] == 3
    assert measure(request, layered)['obstructions'] == 0
    result = asyncio.run(run_layout_critique(request))
    assert result['selected'] == 'layered'
    # Re-critique a layout produced by the old algorithm: it must recover.
    old_positions = [(80, 100), (80, 260), (80, 420), (80, 580), (380, 100), (80, 740)]
    for node, (x, y) in zip(request.nodes, old_positions):
        node.x, node.y = x, y
    corrected = asyncio.run(run_layout_critique(request))
    assert corrected['selected'] == 'layered'
    assert corrected['positions']['4']['y'] == corrected['positions']['2']['y']
    assert corrected['positions']['1']['y'] == 100
    request.edges.append(type(request.edges[0])(id='replica', sourceId='4', targetId='5'))
    with_replica = candidates(request)['layered']
    assert with_replica['5'][0] > with_replica['4'][0]
    assert with_replica['5'][1] == with_replica['4'][1]


def test_nested_container_moves_as_one_layout_unit():
    request = LayoutRequest(nodes=[
        {'id': 'a', 'label': 'Auth', 'x': 80, 'y': 100, 'width': 220, 'height': 82},
        {'id': 'b', 'label': 'Orders', 'x': 80, 'y': 260, 'width': 220, 'height': 82},
        {'id': 'c', 'label': 'Database', 'x': 100, 'y': 120, 'width': 220, 'height': 82},
    ], edges=[{'id': 'ac', 'sourceId': 'a', 'targetId': 'c'}], containers=[
        {'id': 'inner', 'name': 'Services', 'nodeIds': ['a', 'b'], 'parentId': 'outer'},
        {'id': 'outer', 'name': 'Platform', 'nodeIds': []},
    ])
    options = candidates(request)
    for name in ('layered', 'grid'):
        assert options[name]['a'][0] - options['current']['a'][0] == options[name]['b'][0] - options['current']['b'][0]
        assert options[name]['a'][1] - options['current']['a'][1] == options[name]['b'][1] - options['current']['b'][1]
        assert options[name]['b'][1] - options[name]['a'][1] == 160


def test_hierarchy_tree_preview_uses_dimensions_and_keeps_root_fixed():
    request = LayoutRequest(nodes=[
        {'id': 'root', 'label': 'Engineering', 'x': 400, 'y': 100, 'width': 240, 'height': 90},
        {'id': 'a', 'label': 'Platform', 'x': 410, 'y': 110, 'width': 300, 'height': 80},
        {'id': 'b', 'label': 'API Team', 'x': 420, 'y': 120, 'width': 180, 'height': 100},
        {'id': 'c', 'label': 'Database', 'x': 430, 'y': 130, 'width': 220, 'height': 70},
        {'id': 'loose', 'label': 'Design', 'x': 440, 'y': 140, 'width': 200, 'height': 80},
    ], edges=[
        {'id': 'ra', 'sourceId': 'root', 'targetId': 'a', 'relation': 'parent_child'},
        {'id': 'rb', 'sourceId': 'root', 'targetId': 'b', 'relation': 'parent_child'},
        {'id': 'ac', 'sourceId': 'a', 'targetId': 'c', 'relation': 'parent_child'},
    ], diagram_context={'type': 'hierarchy'})
    tree = candidates(request)['tree']
    assert tree['root'] == (400, 100)
    assert tree['a'][1] == tree['b'][1] == 290
    assert tree['c'][1] > tree['a'][1] + 80
    assert tree['b'][0] > tree['a'][0] + 300
    assert tree['loose'][0] > tree['b'][0] + 180
    critique = asyncio.run(run_layout_critique(request))
    assert critique['selected'] == 'tree'
    assert critique['positions']['root'] == {'x': 400, 'y': 100}
    assert critique['scores']['tree']['overlaps'] == 0


def test_brainstorming_layout_only_previews_when_notes_overlap():
    request = tangled()
    request.diagram_context = {'type': 'brainstorming'}
    critique = asyncio.run(run_layout_critique(request))
    assert critique['selected'] == 'grid'
    assert critique['positions'] is not None
    grid = candidates(request)['grid']
    for node in request.nodes:
        node.x, node.y = grid[node.id]
    settled = asyncio.run(run_layout_critique(request))
    assert settled['selected'] == 'current'
    assert settled['positions'] is None
