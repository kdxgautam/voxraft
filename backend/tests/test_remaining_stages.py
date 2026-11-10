import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intent_agent import explicit_start, flowchart_actions
from layout_agent import LayoutRequest, candidates
from main import PlanRequest, plan
from review_agent import ReviewRequest, run_review
from visual_agent import VisualRequest, proposal


def test_flowchart_local_command_labels_outcomes_and_loop_layout():
    assert explicit_start('Create a flowchart for checkout') == ('flowchart', 'checkout', [])
    actions = flowchart_actions('If payment succeeds, send receipt; otherwise retry', [])
    assert [action['role'] for action in actions[:3]] == ['decision', 'process', 'process']
    assert [action['label'] for action in actions[3:]] == ['Yes', 'No']
    assert all(action['relation'] == 'sequence' for action in actions[3:])
    request = LayoutRequest(nodes=[
        {'id': 'start', 'label': 'Start', 'x': 100, 'y': 100, 'width': 100, 'height': 60},
        {'id': 'decision', 'label': 'Payment succeeds?', 'x': 110, 'y': 110, 'width': 180, 'height': 90},
        {'id': 'retry', 'label': 'Retry', 'x': 120, 'y': 120, 'width': 100, 'height': 60},
    ], edges=[
        {'id': 'sd', 'sourceId': 'start', 'targetId': 'decision', 'relation': 'sequence'},
        {'id': 'dr', 'sourceId': 'decision', 'targetId': 'retry', 'relation': 'sequence'},
        {'id': 'rd', 'sourceId': 'retry', 'targetId': 'decision', 'relation': 'sequence'},
    ], diagram_context={'type': 'flowchart'})
    positions = candidates(request)['flow']
    assert set(positions) == {'start', 'decision', 'retry'}
    assert positions['decision'][1] > positions['start'][1]


def test_flowchart_review_flags_unlabeled_decision_paths():
    request = ReviewRequest(nodes=[{'id': 's', 'label': 'Start', 'role': 'start'},
                                   {'id': 'd', 'label': 'Approved?', 'role': 'decision'},
                                   {'id': 'e', 'label': 'End', 'role': 'end'}],
                            edges=[{'id': 'sd', 'sourceId': 's', 'targetId': 'd', 'relation': 'sequence'},
                                   {'id': 'de', 'sourceId': 'd', 'targetId': 'e', 'relation': 'sequence'},
                                   {'id': 'ds', 'sourceId': 'd', 'targetId': 's', 'relation': 'sequence', 'label': 'No'}],
                            diagram_context={'type': 'flowchart'})
    assert asyncio.run(run_review(request))['finding']['title'] == 'Unlabeled decision paths'


def test_scoped_commands_and_agents(monkeypatch):
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    nodes = [{'id': 'idea', 'label': 'Ideas', 'x': 100, 'y': 100, 'width': 180, 'height': 80},
             {'id': 'feature', 'label': 'Features', 'x': 110, 'y': 110, 'width': 180, 'height': 80},
             {'id': 'api', 'label': 'API Gateway', 'x': 600, 'y': 100, 'width': 180, 'height': 80},
             {'id': 'db', 'label': 'PostgreSQL database', 'x': 610, 'y': 110, 'width': 180, 'height': 80}]
    containers = [{'id': 'ideas', 'name': 'Ideas', 'nodeIds': ['idea', 'feature'], 'intentType': 'mindmap', 'rootId': 'idea'},
                  {'id': 'system', 'name': 'System', 'nodeIds': ['api', 'db'], 'intentType': 'architecture'}]
    context = {'type': 'architecture'}
    request = PlanRequest(text='Add Payments under Features', nodes=nodes, containers=containers, diagram_context=context)
    actions = asyncio.run(plan(request))['actions']
    assert actions[0] == {'type': 'ADD_NODE', 'label': 'Payments', 'container': 'ideas'}
    assert actions[1]['relation'] == 'branch'
    review = asyncio.run(run_review(ReviewRequest(nodes=nodes, edges=[], containers=containers, diagram_context=context)))
    assert review['finding']['title'].startswith('Ideas:')
    layout = candidates(LayoutRequest(nodes=nodes, edges=[], containers=containers, diagram_context=context))
    assert 'scoped' in layout and set(layout['scoped']) == {node['id'] for node in nodes}
    design = proposal(VisualRequest(nodes=nodes, edges=[], containers=containers, diagram_context=context), 'rules', [])
    assert design['roles'][0]['role'] == 'central topic'
    assert design['roles'][-1]['role'] == 'database'
    assert design['node_styles']['feature']['color'] != design['node_styles']['db']['color']
