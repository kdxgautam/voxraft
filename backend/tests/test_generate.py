import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


def test_generated_actions_rejects_broken_references():
    result = {'nodes': [{'label': 'Start'}, {'label': 'Finish'}], 'edges': [{'source': 'Start', 'target': 'Missing'}]}
    with pytest.raises(ValueError, match='unknown block'):
        main.generated_actions(result, 'flowchart')


def test_generated_mindmap_has_branch_relations():
    result = {'nodes': [{'label': 'Product'}, {'label': 'Audience'}, {'label': 'Pricing'}], 'edges': [
        {'source': 'Product', 'target': 'Audience'}, {'source': 'Product', 'target': 'Pricing'}]}
    actions = main.generated_actions(result, 'mindmap')
    assert [item['relation'] for item in actions if item['type'] == 'ADD_EDGE'] == ['branch', 'branch']


def test_generated_mindmap_repairs_extra_and_disconnected_branches():
    result = {'nodes': [{'label': 'Product'}, {'label': 'Audience'}, {'label': 'Pricing'}, {'label': 'Launch'}], 'edges': [
        {'source': 'Product', 'target': 'Audience'}, {'source': 'Audience', 'target': 'Product'},
        {'source': 'Product', 'target': 'Pricing'}, {'source': 'Audience', 'target': 'Pricing'}]}
    actions = main.generated_actions(result, 'mindmap')
    branches = [item for item in actions if item['type'] == 'ADD_EDGE']
    assert [(item['source'], item['target']) for item in branches] == [
        ('Product', 'Audience'), ('Product', 'Pricing'), ('Product', 'Launch')]


def test_generated_mindmap_preserves_disconnected_subtree():
    result = {'nodes': [{'label': 'Product'}, {'label': 'Audience'}, {'label': 'Launch'}, {'label': 'Campaign'}], 'edges': [
        {'source': 'Product', 'target': 'Audience'}, {'source': 'Launch', 'target': 'Campaign'}]}
    branches = [item for item in main.generated_actions(result, 'mindmap') if item['type'] == 'ADD_EDGE']
    assert [(item['source'], item['target']) for item in branches] == [
        ('Product', 'Audience'), ('Product', 'Launch'), ('Launch', 'Campaign')]


def test_flowchart_decision_exits_need_labels():
    result = {'nodes': [{'label': 'Approved?', 'shape': 'diamond'}, {'label': 'Ship'}, {'label': 'Retry'}], 'edges': [
        {'source': 'Approved?', 'target': 'Ship'}, {'source': 'Approved?', 'target': 'Retry'}]}
    with pytest.raises(ValueError, match='Label each exit'):
        main.generated_actions(result, 'flowchart')


def test_explicit_checkout_flowchart_preserves_decision_branches_and_loop(monkeypatch):
    for name in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(name, raising=False)
    request = main.GenerateRequest(
        description=('online checkout: start with Add to cart, then Checkout, then ask Payment approved? '
                     'If yes, confirm the order and send a receipt. '
                     'If no, retry payment and loop back to Checkout.'),
        diagram_type='flowchart',
    )
    result = asyncio.run(main.generate(request))
    nodes = {item['label']: item for item in result['actions'] if item['type'] == 'ADD_NODE'}
    edges = {(item['source'], item['target'], item['label']) for item in result['actions'] if item['type'] == 'ADD_EDGE'}
    assert result['mode'] == 'fallback'
    assert list(nodes) == ['Add to cart', 'Checkout', 'Payment approved?', 'Confirm the order', 'Send a receipt', 'Retry payment']
    assert nodes['Payment approved?']['shape'] == 'diamond'
    assert edges == {
        ('Add to cart', 'Checkout', ''), ('Checkout', 'Payment approved?', ''),
        ('Payment approved?', 'Confirm the order', 'Yes'),
        ('Confirm the order', 'Send a receipt', ''),
        ('Payment approved?', 'Retry payment', 'No'), ('Retry payment', 'Checkout', ''),
    }


def test_product_launch_mindmap_uses_exact_center_and_useful_subtopics(monkeypatch):
    for name in ('OPENAI_API_KEY', 'AGENTROUTER_API_KEY', 'AgentRouter_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
        monkeypatch.delenv(name, raising=False)
    request = main.GenerateRequest(
        description=('launching a product, with Launch at the center and branches for Research, '
                     'Design, Build, and Release. Add two useful subtopics under each branch.'),
        diagram_type='mindmap',
    )
    result = asyncio.run(main.generate(request))
    nodes = [item['label'] for item in result['actions'] if item['type'] == 'ADD_NODE']
    edges = [(item['source'], item['target']) for item in result['actions'] if item['type'] == 'ADD_EDGE']
    assert result['mode'] == 'fallback'
    assert nodes[0] == 'Launch'
    assert nodes[1:5] == ['Research', 'Design', 'Build', 'Release']
    assert len(nodes) == 13
    assert edges[:4] == [('Launch', branch) for branch in nodes[1:5]]
    assert all(sum(source == branch for source, _ in edges) == 2 for branch in nodes[1:5])
    assert not any('subtopic' in label.casefold() for label in nodes)


def test_generate_uses_configured_model(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.delenv('OPENAI_GENERATION_MODEL', raising=False)
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-4o-mini')
    calls = []

    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"nodes":[{"label":"Start"},{"label":"Done"}],"edges":[{"source":"Start","target":"Done"}]}'}}]}

    class Client:
        async def post(self, *args, **kwargs):
            calls.append(kwargs['json'])
            return Response()

    monkeypatch.setattr(main.app.state, 'planner_client', Client(), raising=False)
    result = asyncio.run(main.generate(main.GenerateRequest(description='A process from start to done', diagram_type='flowchart')))
    assert [item['type'] for item in result['actions']] == ['ADD_NODE', 'ADD_NODE', 'ADD_EDGE']
    assert result['actions'][-1]['relation'] == 'sequence'
    assert 'exactly one node for each named component' in calls[0]['messages'][0]['content']
    assert result['diagram_type'] == 'flowchart'
    assert calls[0]['messages'][1]['content'] == 'A process from start to done'
    assert calls[0]['model'] == 'gpt-5.4-mini'
    assert calls[0]['max_completion_tokens'] == 2200
    monkeypatch.setenv('OPENAI_GENERATION_MODEL', 'gpt-4o-mini')
    asyncio.run(main.generate(main.GenerateRequest(description='A process from start to done', diagram_type='flowchart')))
    assert calls[1]['model'] == 'gpt-4o-mini'


def test_generate_auto_uses_model_chosen_type(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')

    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"diagram_type":"architecture","nodes":[{"label":"Web app"},{"label":"Database"}],"edges":[{"source":"Web app","target":"Database"}]}'}}]}

    class Client:
        async def post(self, *args, **kwargs): return Response()

    monkeypatch.setattr(main.app.state, 'planner_client', Client(), raising=False)
    result = asyncio.run(main.generate(main.GenerateRequest(description='A web app uses a database')))
    assert result['diagram_type'] == 'architecture'
    assert result['actions'][-1]['relation'] == 'connection'


def test_explicit_architecture_keeps_named_components_and_all_requested_connections():
    description = ('Generate a system architecture for an online store with a Web app, API Gateway, '
                   'Auth Service, Orders Service, PostgreSQL database, and Redis cache. '
                   'Connect the Web app to the gateway, both services to PostgreSQL, and Orders Service to Redis.')
    model_result = {'nodes': [{'label': label} for label in [
        'Online Store', 'Web App', 'API Gateway', 'Auth Service', 'Order Service',
        'PostgreSQL Database', 'Redis Cache']], 'edges': [
        {'source': 'Online Store', 'target': 'Web App'},
        {'source': 'Web App', 'target': 'API Gateway'},
        {'source': 'API Gateway', 'target': 'Auth Service'},
        {'source': 'API Gateway', 'target': 'Order Service'},
        {'source': 'Order Service', 'target': 'PostgreSQL Database'},
        {'source': 'Order Service', 'target': 'Redis Cache'}]}
    repaired = main.reconcile_explicit_architecture(model_result, description)
    actions = main.generated_actions(repaired, 'architecture')
    nodes = [action['label'] for action in actions if action['type'] == 'ADD_NODE']
    edges = {(action['source'], action['target']) for action in actions if action['type'] == 'ADD_EDGE'}
    assert nodes == ['Web app', 'API Gateway', 'Auth Service', 'Orders Service', 'PostgreSQL database', 'Redis cache']
    assert {('Web app', 'API Gateway'), ('Auth Service', 'PostgreSQL database'),
            ('Orders Service', 'PostgreSQL database'), ('Orders Service', 'Redis cache')} <= edges
    assert 'Online Store' not in nodes
