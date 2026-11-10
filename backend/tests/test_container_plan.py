import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import PlanRequest, fallback, plan, valid_actions


def test_container_commands_have_explicit_actions():
    cases = [
        ('Put Auth and Orders inside Backend', {'type': 'CREATE_CONTAINER', 'name': 'Backend', 'targets': ['Auth', 'Orders']}),
        ('Create Backend container with Auth and Orders', {'type': 'CREATE_CONTAINER', 'name': 'Backend', 'targets': ['Auth', 'Orders']}),
        ('Add Billing to Backend container', {'type': 'ADD_TO_CONTAINER', 'container': 'Backend', 'targets': ['Billing']}),
        ('Remove Orders from Backend container', {'type': 'REMOVE_FROM_CONTAINER', 'container': 'Backend', 'targets': ['Orders']}),
        ('Move Backend container right', {'type': 'MOVE_CONTAINER', 'container': 'Backend', 'direction': 'right'}),
        ('Rename Backend container to Platform', {'type': 'RENAME_CONTAINER', 'container': 'Backend', 'name': 'Platform'}),
        ('Dissolve Backend container', {'type': 'DELETE_CONTAINER', 'container': 'Backend'}),
        ('Nest Backend container inside Platform container', {'type': 'NEST_CONTAINER', 'container': 'Backend', 'parent': 'Platform'}),
        ('Create Platform container containing Backend container', {'type': 'CREATE_CONTAINER', 'name': 'Platform', 'targets': [], 'childContainers': ['Backend']}),
        ('Take Backend container out of Platform container', {'type': 'UNNEST_CONTAINER', 'container': 'Backend'}),
        ('Collapse Backend container', {'type': 'SET_CONTAINER_COLLAPSED', 'container': 'Backend', 'collapsed': True}),
        ('Expand Backend container', {'type': 'SET_CONTAINER_COLLAPSED', 'container': 'Backend', 'collapsed': False}),
    ]
    for command, expected in cases:
        actions = fallback(command)
        assert actions == [expected], command
        assert valid_actions(actions), command


def test_spoken_container_edit_on_architecture_uses_local_parser(monkeypatch):
    async def unexpected_planner(*args, **kwargs):
        raise AssertionError('The explicit container edit must not call the AI planner')
    monkeypatch.setattr('main.llm_plan_detail', unexpected_planner)
    request = PlanRequest(
        text='Put Auth Service and Order Service inside a backend container.',
        nodes=[{'id': 'auth', 'label': 'Auth Service'}, {'id': 'orders', 'label': 'Order Service'}],
        containers=[{'id': 'region', 'name': 'System architecture 1', 'nodeIds': ['auth', 'orders']}],
        diagram_context={'type': 'architecture'},
    )
    result = asyncio.run(plan(request))
    assert result == {'actions': [{'type': 'CREATE_CONTAINER', 'name': 'backend',
                                   'targets': ['Auth Service', 'Order Service']}], 'mode': 'fallback'}
