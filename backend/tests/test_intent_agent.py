import asyncio
import sys
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from intent_agent import brainstorming_actions, explicit_relation_action, explicit_role_action, explicit_start, evidence, hierarchy_actions, mindmap_actions, suggest
from layout_agent import LayoutRequest, measure, result
from review_agent import ReviewRequest, run_review, shared_dependencies
from visual_agent import VisualRequest, proposal


@pytest.mark.parametrize('command, expected', [
    ('Create a mind map about system architecture', 'mindmap'),
    ('Draw a flowchart for department onboarding', 'flowchart'),
    ('Create a brainstorming board about workflow ideas', 'brainstorming'),
    ('Create a hierarchy for API workflow teams', 'hierarchy'),
    ('Draw a system architecture for workflow services', 'architecture'),
])
def test_requested_format_wins_over_topic_keywords(command, expected):
    assert evidence(command)[0] == expected
    assert asyncio.run(suggest(command, []))['type'] == expected


def test_explicit_intent_and_ambiguous_database():
    assert explicit_start('Create a mind map about Food delivery') == ('mindmap', 'Food delivery', [{'type': 'ADD_NODE', 'label': 'Food delivery'}])
    assert explicit_start('Draw a system architecture for checkout') == ('architecture', 'checkout', [])
    assert evidence('Add PostgreSQL database')[0] is None
    assert evidence('Add an API gateway')[0] == 'architecture'
    assert evidence('Add ideas under Features')[0] == 'mindmap'
    assert asyncio.run(suggest('Add Redis', [{'label': 'API gateway'}]))['type'] == 'architecture'
    assert asyncio.run(suggest('Add another item', [], recent_command='Add a branch under Features'))['type'] == 'mindmap'


def test_mixed_intent_requires_evidence_of_multiple_types():
    from main import PlanRequest, plan
    assert explicit_start('Create a mixed canvas for planning') == ('mixed', 'planning', [])
    assert evidence('Draw a mind map and system architecture')[0] == 'mixed'
    assert evidence('Add API ideas under Features')[0] == 'mindmap'
    assert evidence('Connect an API gateway to the database')[0] == 'architecture'
    assert asyncio.run(suggest('Connect the API gateway', [], existing_types=['mindmap']))['type'] == 'mixed'
    assert asyncio.run(suggest('Connect A to B', [], existing_types=['mindmap', 'architecture']))['type'] == 'mixed'
    assert asyncio.run(plan(PlanRequest(text='Use mixed', diagram_context={'type': None, 'purpose': ''})))['actions'][0]['diagramType'] == 'mixed'
    review = asyncio.run(run_review(ReviewRequest(nodes=[{'id': 'note', 'label': 'Idea'}], edges=[], diagram_context={'type': 'mixed'})))
    assert review['finding'] is None


def test_hierarchy_intent_and_local_commands(monkeypatch):
    from main import PlanRequest, plan
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    assert explicit_start('Create a hierarchy for Engineering') == ('hierarchy', 'Engineering', [])
    assert evidence('Draw an org chart')[0] == 'hierarchy'
    assert hierarchy_actions('Add Platform under Engineering') == [
        {'type': 'ADD_NODE', 'label': 'Platform'},
        {'type': 'ADD_EDGE', 'source': 'Engineering', 'target': 'Platform', 'relation': 'parent_child', 'relationSource': 'intent'}]
    assert hierarchy_actions('Put Platform under API Team') == [{'type': 'REPARENT_BRANCH', 'target': 'Platform', 'parent': 'API Team'}]
    assert hierarchy_actions('Make API Team the parent of Platform') == [{'type': 'REPARENT_BRANCH', 'target': 'Platform', 'parent': 'API Team'}]
    assert asyncio.run(plan(PlanRequest(text='Use hierarchy', diagram_context={'type': None, 'purpose': ''})))['actions'][0]['diagramType'] == 'hierarchy'
    assert asyncio.run(plan(PlanRequest(text='Add Platform under Engineering', diagram_context={'type': 'hierarchy', 'purpose': ''})))['actions'] == hierarchy_actions('Add Platform under Engineering')
    suggested = asyncio.run(plan(PlanRequest(text='Put Platform under Engineering', nodes=[{'id':'a','label':'Platform'},{'id':'b','label':'Engineering'}], diagram_context={'type': None, 'purpose': ''})))
    assert suggested['intent_suggestion']['type'] is None


def test_hierarchy_review_reports_unattached_node_without_architecture_advice():
    request = ReviewRequest(nodes=[{'id':'root','label':'Engineering'}, {'id':'a','label':'Platform'},
                                   {'id':'loose','label':'PostgreSQL database'}],
                            edges=[{'id':'ra','sourceId':'root','targetId':'a','relation':'parent_child'}],
                            diagram_context={'type':'hierarchy'})
    finding = asyncio.run(run_review(request))['finding']
    assert finding['title'] == 'Unattached node'
    assert finding['node_ids'] == ['loose']
    assert finding['actions'] == []
    request.edges.append(type(request.edges[0])(id='al', sourceId='a', targetId='loose', relation='parent_child'))
    assert asyncio.run(run_review(request))['finding'] is None


def test_brainstorming_explicit_idea_and_neutral_agents(monkeypatch):
    from main import PlanRequest, plan
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    assert explicit_start('Create a brainstorming board about checkout') == ('brainstorming', 'checkout', [])
    assert evidence('Start a notes board')[0] == 'brainstorming'
    idea = [{'type': 'ADD_NODE', 'label': 'PostgreSQL', 'role': 'note', 'roleSource': 'explicit'}]
    assert brainstorming_actions('Add PostgreSQL as an idea') == idea
    assert asyncio.run(plan(PlanRequest(text='Add PostgreSQL as an idea', diagram_context={'type': None, 'purpose': ''})))['actions'] == idea
    assert asyncio.run(plan(PlanRequest(text='Use notes', diagram_context={'type': None, 'purpose': ''})))['actions'][0]['diagramType'] == 'brainstorming'
    context = {'type': 'brainstorming', 'purpose': 'checkout'}
    request = ReviewRequest(nodes=[{'id':'db','label':'PostgreSQL database'}, {'id':'a','label':'Idea A'}, {'id':'b','label':'Idea B'}],
                            edges=[], diagram_context=context)
    assert asyncio.run(run_review(request))['finding'] is None
    nodes = [{'id':'db','label':'PostgreSQL database','x':80,'y':100,'width':220,'height':82},
             {'id':'a','label':'Idea A','x':390,'y':100,'width':220,'height':82},
             {'id':'b','label':'Idea B','x':700,'y':100,'width':220,'height':82}]
    layout = result(LayoutRequest(nodes=nodes, edges=[], diagram_context=context), 'rules', [])
    assert layout['selected'] == 'current' and layout['positions'] is None
    styles = proposal(VisualRequest(nodes=[{'id':node['id'],'label':node['label']} for node in nodes], edges=[],
                                   diagram_context=context, suggest_shapes=True), 'rules', [])
    assert styles['shape_suggestions'] == {}
    assert styles['roles'][0]['role'] == 'note'
    assert styles['node_styles']['db']['fontFamily'] == 2


def test_local_mindmap_commands():
    assert mindmap_actions('Add Payments under Features') == [
        {'type': 'ADD_NODE', 'label': 'Payments'},
        {'type': 'ADD_EDGE', 'source': 'Features', 'target': 'Payments', 'relation': 'branch'}]
    assert mindmap_actions('Move Payments under Checkout') == [{'type': 'REPARENT_BRANCH', 'target': 'Payments', 'parent': 'Checkout'}]
    assert mindmap_actions('Make Payments a child of Checkout') == [{'type': 'REPARENT_BRANCH', 'target': 'Payments', 'parent': 'Checkout'}]


def test_mindmap_agents_use_topics_instead_of_architecture_roles():
    context = {'type': 'mindmap', 'rootId': 'root'}
    nodes = [{'id': 'root', 'label': 'Food delivery', 'x': 400, 'y': 200, 'width': 250, 'height': 110},
             {'id': 'db', 'label': 'PostgreSQL', 'x': 700, 'y': 200, 'width': 220, 'height': 82},
             {'id': 'loose', 'label': 'Idea', 'x': 100, 'y': 400, 'width': 220, 'height': 82}]
    edges = [{'id': 'branch', 'sourceId': 'root', 'targetId': 'db', 'relation': 'branch'}]
    review = asyncio.run(run_review(ReviewRequest(nodes=nodes, edges=edges, diagram_context=context)))
    assert review['finding']['title'] == 'Unattached topic'
    assert review['finding']['node_ids'] == ['loose']
    missing_root = asyncio.run(run_review(ReviewRequest(nodes=nodes, edges=[], diagram_context={'type': 'mindmap'})))
    assert missing_root['finding']['title'] == 'No central topic'
    layout = result(LayoutRequest(nodes=nodes, edges=edges, diagram_context=context), 'rules', [])
    assert layout['selected'] in ('tree', 'current')
    assert layout['scores'].keys() == {'tree', 'current'}
    visual = proposal(VisualRequest(nodes=[{'id': item['id'], 'label': item['label']} for item in nodes],
                                    edges=[{**edges[0], 'label': ''}], diagram_context=context, suggest_shapes=True), 'rules', [])
    assert visual['shape_suggestions'] == {}
    assert visual['roles'][1]['role'] == 'topic'


def test_neutral_first_edit_and_semantic_request_confirmation(monkeypatch):
    from main import PlanRequest, plan
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    unknown = asyncio.run(plan(PlanRequest(text='Add an API gateway', diagram_context={'type': None, 'purpose': ''})))
    assert unknown['actions'] == [{'type': 'ADD_NODE', 'label': 'API gateway'}]
    assert 'intent_suggestion' not in unknown
    neutral_database = asyncio.run(plan(PlanRequest(text='Add PostgreSQL', diagram_context={'type': None, 'purpose': ''})))
    assert neutral_database['actions'] == [{'type': 'ADD_NODE', 'label': 'PostgreSQL'}]
    suggested = asyncio.run(plan(PlanRequest(text='Connect API gateway to PostgreSQL', nodes=[{'id':'a','label':'API gateway'},{'id':'b','label':'PostgreSQL'}], diagram_context={'type': None, 'purpose': ''})))
    assert suggested['intent_suggestion']['type'] == 'architecture'
    assert suggested['actions'] == []
    ambiguous = asyncio.run(plan(PlanRequest(text='Connect A to B', nodes=[{'id':'a','label':'A'},{'id':'b','label':'B'}], diagram_context={'type': None, 'purpose': ''})))
    assert ambiguous['intent_suggestion']['type'] is None
    accepted = asyncio.run(plan(PlanRequest(text='Add an API gateway', diagram_context={'type': 'architecture', 'purpose': ''})))
    assert accepted['actions'] == [{'type': 'ADD_NODE', 'label': 'API gateway'}]
    direct = asyncio.run(plan(PlanRequest(text='Create a mind map about Food delivery', diagram_context={'type': None, 'purpose': ''})))
    assert [item['type'] for item in direct['actions']] == ['SET_DIAGRAM_CONTEXT', 'ADD_NODE']


def test_explicit_roles_and_relationships_need_no_type(monkeypatch):
    from main import PlanRequest, plan, valid_actions
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    context = {'type': None, 'purpose': ''}
    assert explicit_role_action('Add a note called PostgreSQL')[0]['role'] == 'note'
    assert explicit_role_action('Make PostgreSQL a decision')[0] == {'type':'UPDATE_NODE','target':'PostgreSQL','role':'decision','roleSource':'explicit'}
    assert explicit_relation_action('Connect A to B as a sequence')[0]['relation'] == 'sequence'
    assert valid_actions([{'type':'ADD_EDGE','source':'A','target':'B','relation':'parent_child'}])
    assert valid_actions([{'type':'ADD_NODE','label':'Idea','role':'note'}])
    assert not valid_actions([{'type':'ADD_NODE','label':'Idea','role':'mystery'}])
    assert asyncio.run(plan(PlanRequest(text='Add a note called PostgreSQL', diagram_context=context)))['actions'][0]['roleSource'] == 'explicit'
    assert asyncio.run(plan(PlanRequest(text='Relate A to B', diagram_context=context)))['actions'][0]['relation'] == 'association'
    assert asyncio.run(plan(PlanRequest(text='Make A the parent of B', diagram_context=context)))['actions'][0]['relation'] == 'parent_child'


def test_local_selection_purpose_and_central_topic_clarification(monkeypatch):
    from main import PlanRequest, plan
    for key in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(key, raising=False)
    unknown = {'type': None, 'purpose': ''}
    mindmap = {'type': 'mindmap', 'purpose': '', 'rootId': None}
    assert asyncio.run(plan(PlanRequest(text='Use mind map', diagram_context=unknown)))['actions'][0]['diagramType'] == 'mindmap'
    assert asyncio.run(plan(PlanRequest(text='This diagram is for food delivery', diagram_context=unknown)))['actions'] == [{'type': 'SET_PURPOSE', 'purpose': 'food delivery'}]
    assert asyncio.run(plan(PlanRequest(text='New diagram', diagram_context=unknown)))['actions'] == [{'type': 'NEW_DIAGRAM'}]
    first = asyncio.run(plan(PlanRequest(text='Add Features and Payments', diagram_context=mindmap)))
    assert first['question'] == 'Which topic should be the central topic?'
    answer = asyncio.run(plan(PlanRequest(text='Payments', pending_command='Add Features and Payments', clarification_answer='Payments', diagram_context=mindmap)))
    assert [action['label'] for action in answer['actions']] == ['Payments', 'Features']


def test_mindmap_layout_does_not_propose_a_worse_tree():
    nodes = [{'id': 'r', 'label': 'Root', 'x': 80, 'y': 100, 'width': 250, 'height': 110},
             {'id': 'c', 'label': 'Child', 'x': 450, 'y': 100, 'width': 220, 'height': 82},
             {'id': 'l', 'label': 'Loose', 'x': 790, 'y': 100, 'width': 220, 'height': 82}]
    edges = [{'id': 'b', 'sourceId': 'r', 'targetId': 'c', 'relation': 'branch'},
             {'id': 'a', 'sourceId': 'c', 'targetId': 'l', 'relation': 'association'}]
    critique = result(LayoutRequest(nodes=nodes, edges=edges, diagram_context={'type': 'mindmap', 'rootId': 'r'}), 'rules', [])
    assert critique['scores']['tree']['score'] > critique['scores']['current']['score']
    assert critique['selected'] == 'current'
    assert critique['positions'] is None


def test_associations_are_not_architecture_dependencies():
    nodes = [{'id': 'db', 'label': 'PostgreSQL database'}, *[{'id': str(i), 'label': f'Service {i}'} for i in range(3)]]
    edges = [{'id': str(i), 'sourceId': str(i), 'targetId': 'db', 'relation': 'association'} for i in range(3)]
    assert shared_dependencies(ReviewRequest(nodes=nodes, edges=edges, diagram_context={'type': 'architecture'})) == []
    connections = [{**edge, 'relation': 'connection'} for edge in edges]
    assert len(shared_dependencies(ReviewRequest(nodes=nodes, edges=connections, diagram_context={'type': 'architecture'}))) == 1
    layout = LayoutRequest(nodes=[{'id':'a','label':'A','x':500,'y':0,'width':100,'height':60},
                                  {'id':'b','label':'B','x':100,'y':0,'width':100,'height':60}],
                           edges=[{'id':'ab','sourceId':'a','targetId':'b','relation':'association'}],diagram_context={'type':'architecture'})
    assert measure(layout, {'a': (500, 0), 'b': (100, 0)})['backward_edges'] == 0


def test_explicit_note_role_overrides_database_label_in_design():
    styled = proposal(VisualRequest(nodes=[{'id':'n','label':'PostgreSQL','role':'note','roleSource':'explicit','shape':'rectangle'}],
                                    edges=[], diagram_context={'type':'architecture'}, suggest_shapes=True), 'rules', [])
    assert styled['roles'][0]['role'] == 'note'
    assert styled['shape_suggestions'] == {}
