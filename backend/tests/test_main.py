import asyncio
import io
import json
import sys
from pathlib import Path
from fastapi import HTTPException, UploadFile
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from main import PLAN_SCHEMA, PlanRequest, ambiguous_fallback, fallback, guard_isolated_delete, history_command, is_clear_command, is_arrange_command, llm_plan, parse_plan, plan, transcribe, valid_actions


@pytest.mark.parametrize('text', ['Clear the canvas', 'New diagram', 'Use mind map', 'Remember that Redis has failover', 'Add Redis inside Backend container'])
@pytest.mark.parametrize('followup', [{'pending_command': 'Rename the API', 'clarification_answer': 'new name'}, {'revision_of': 'Add API'}])
def test_followups_reach_planner_instead_of_starting_fresh_commands(monkeypatch, text, followup):
    received = []
    async def planner(request):
        received.append(request)
        return [], 'llm', 'Which component do you mean?'
    monkeypatch.setattr(main, 'llm_plan_detail', planner)
    request = PlanRequest(text=text, containers=[{'id': 'backend', 'name': 'Backend', 'nodeIds': []}], **followup)
    result = asyncio.run(plan(request))
    assert received == [request]
    assert result == {'actions': [], 'mode': 'llm', 'question': 'Which component do you mean?'}


def test_plan_cannot_edit_while_asking_for_clarification():
    with pytest.raises(ValueError, match='clarification'):
        parse_plan('{"actions":[{"type":"DELETE_NODE","target":"api"}],"question":"Which API?"}')
    assert parse_plan('{"actions":[],"question":"Which API?"}') == ([], 'Which API?')


def test_conflicting_model_response_retries_without_applying_actions(monkeypatch):
    import httpx
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    calls = []
    class Client:
        async def post(self, url, **kwargs):
            calls.append(json.loads(json.dumps(kwargs['json'])))
            actions = [{'type': 'DELETE_NODE', 'target': 'api'}] if len(calls) == 1 else []
            content = json.dumps({'actions': actions, 'question': 'Which API?'})
            return httpx.Response(200, request=httpx.Request('POST', url),
                                  json={'choices': [{'message': {'content': content}}]})
    monkeypatch.setattr(main.app.state, 'planner_client', Client(), raising=False)
    result = asyncio.run(plan(PlanRequest(text='Remove the API', nodes=[{'id': 'api', 'label': 'API'}])))
    assert result == {'actions': [], 'mode': 'llm', 'question': 'Which API?'}
    assert len(calls) == 2
    assert 'clarification' in calls[1]['messages'][-1]['content']


def test_mindmap_root_followup_does_not_intercept_a_correction(monkeypatch):
    async def planner(request):
        return [{'type': 'ADD_NODE', 'label': 'Corrected topic'}], 'llm', None
    monkeypatch.setattr(main, 'llm_plan_detail', planner)
    result = asyncio.run(plan(PlanRequest(text='Payments', pending_command='Add Features and Payments',
                                         clarification_answer='Payments', revision_of='Add Features and Payments',
                                         diagram_context={'type': 'mindmap', 'rootId': None})))
    assert result['actions'] == [{'type': 'ADD_NODE', 'label': 'Corrected topic'}]


def test_fallback_multi_turn():
    assert len(fallback('Create a frontend, a FastAPI backend and a PostgreSQL database')) == 3
    assert fallback('Connect backend to database')[0]['type'] == 'ADD_EDGE'
    assert len(fallback('Connect frontend to backend and backend to database')) == 2
    assert fallback('Insert Redis between backend and database')[0]['type'] == 'INSERT_BETWEEN'
    assert fallback('Move Redis above database')[0]['type'] == 'MOVE_NODE'
    assert fallback('Rename backend to Authentication Service')[0]['label'] == 'Authentication Service'
    assert fallback('Undo')[0]['type'] == 'UNDO'
    assert fallback('database ko orange karo')[0]['color'] == 'orange'
    assert fallback('Put the front end block before the API gateway.')[0] == {'type': 'MOVE_NODE', 'target': 'front end block', 'direction': 'left', 'relativeTo': 'API gateway'}
    assert fallback('Create an ellipse called Start') == [{'type':'ADD_NODE','label':'Start','shape':'ellipse'}]
    assert fallback('Make Payment approved a diamond') == [{'type':'UPDATE_NODE','target':'Payment approved','shape':'diamond'}]
    assert fallback('Turn Auth into an oval') == [{'type':'UPDATE_NODE','target':'Auth','shape':'ellipse'}]


def test_fallback_rejects_negated_edits(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('GNANI_AGENTIC_API_KEY', raising=False)
    for command in ("Don't delete database", 'Do not undo', 'Please do not clear the canvas', "I don't want to remove database"):
        with pytest.raises(ValueError, match='negated command'):
            fallback(command)
        with pytest.raises(HTTPException) as error:
            asyncio.run(plan(PlanRequest(text=command)))
        assert error.value.status_code == 422
    assert fallback('Remove the unconnected database') == [{'type':'DELETE_NODE','target':'unconnected database'}]


def test_edge_and_group_commands_are_validated():
    assert fallback('Disconnect Auth from Database') == [{'type': 'DELETE_EDGE', 'source': 'Auth', 'target': 'Database'}]
    assert fallback('Reverse that arrow') == [{'type': 'REVERSE_EDGE', 'edge': 'that arrow'}]
    assert fallback('Label this connection HTTPS') == [{'type': 'UPDATE_EDGE', 'edge': 'this connection', 'label': 'HTTPS'}]
    assert fallback('Group Auth and Orders as backend services') == [{'type': 'CREATE_GROUP', 'name': 'backend services', 'targets': ['Auth', 'Orders']}]
    assert valid_actions([{'type':'UPDATE_EDGE','edge':'edge-1','label':'HTTPS'}])
    assert valid_actions([{'type':'CREATE_GROUP','name':'backend services','targets':['Auth','Orders']}])
    assert not valid_actions([{'type':'DELETE_EDGE'}])
    assert not valid_actions([{'type':'CREATE_GROUP','name':'backend services','targets':[]}])
    assert parse_plan('{"actions":[{"type":"REVERSE_EDGE","edge":"edge-1","source":null,"target":null}],"question":null}')[0][0] == {'type':'REVERSE_EDGE','edge':'edge-1'}


def test_correction_sends_previous_command_and_actions_to_model(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    calls=[]
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices':[{'message':{'content':'{"actions":[{"type":"ADD_NODE","label":"Redis","shape":null,"color":null}],"question":null}'}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): calls.append(kwargs['json']); return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    actions, mode = asyncio.run(llm_plan(PlanRequest(text='No, use Redis instead of Kafka', revision_of='Add Kafka', previous_actions=[{'type':'ADD_NODE','label':'Kafka'}], nodes=[{'id':'n1','label':'Gateway','x':10,'y':20,'width':220,'height':82,'color':'#123456'}], last_command='Make Gateway blue', last_actions=[{'type':'UPDATE_NODE','target':'n1','color':'blue'}])))
    assert (actions,mode) == ([{'type':'ADD_NODE','label':'Redis'}],'llm')
    context=__import__('json').loads(calls[0]['messages'][1]['content'])
    assert context['revision_of']=='Add Kafka'
    assert context['previous_actions']==[{'type':'ADD_NODE','label':'Kafka'}]
    assert context['nodes'][0]['width'] == 220
    assert context['nodes'][0]['color'] == '#123456'
    assert context['last_command'] == 'Make Gateway blue'
    assert context['last_actions'][0]['target'] == 'n1'
    assert context['canvas_facts'][0]['id'] == 'n1'


def test_correction_without_planner_explains_requirement(monkeypatch):
    for name in ('OPENAI_API_KEY','AGENTROUTER_API_KEY','AgentRouter_API_KEY','LLM_API_KEY','OPENROUTER_API_KEY','LLM_BASE_URL','LLM_MODEL'):
        monkeypatch.delenv(name, raising=False)
    try: asyncio.run(plan(PlanRequest(text='I meant the backup database', revision_of='Connect frontend to main database')))
    except HTTPException as exc: assert exc.status_code == 503 and 'configured AI planner' in exc.detail
    else: assert False, 'A correction needs the planner'


def test_offline_fallback_rejects_compound_edits_it_cannot_cover():
    try: fallback('Create a frontend and connect it to the backend')
    except ValueError as exc: assert 'AI planner' in str(exc)
    else: assert False, 'Compound command must not silently drop the create action'


def test_invalid_move_plan_is_retried_with_original_command(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    responses = iter([
        '{"actions":[{"type":"MOVE_NODE","target":"frontend","direction":"before","relativeTo":"gateway"}]}',
        '{"actions":[{"type":"MOVE_NODE","target":"frontend","direction":"left","relativeTo":"gateway"}],"question":null}',
    ])
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': next(responses)}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            calls.append(kwargs['json'])
            return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    actions, mode = asyncio.run(llm_plan(PlanRequest(text='Put the front end block before the API gateway.')))
    assert (actions, mode) == ([{'type':'MOVE_NODE','target':'frontend','direction':'left','relativeTo':'gateway'}], 'llm')
    assert len(calls) == 2
    assert calls[1]['messages'][-1]['role'] == 'user'
    assert 'failed validation' in calls[1]['messages'][-1]['content']
    assert 'Put the front end block before the API gateway.' in calls[1]['messages'][1]['content']


def test_strict_plan_schema_and_optional_fields():
    move = next(item for item in PLAN_SCHEMA['properties']['actions']['items']['anyOf'] if item['properties']['type']['enum'] == ['MOVE_NODE'])
    assert move['properties']['direction']['enum'] == ['above', 'below', 'left', 'right']
    assert move['additionalProperties'] is False
    assert parse_plan('{"actions":[{"type":"ADD_NODE","label":"Frontend","shape":null,"color":null}],"question":null}') == ([{'type':'ADD_NODE','label':'Frontend'}], None)


def test_invalid_model_plan_does_not_silently_run_local_parser(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"actions":[{"type":"MOVE","target":"frontend","direction":"before"}]}'}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    try: asyncio.run(llm_plan(PlanRequest(text='Create a frontend and connect it to the backend')))
    except HTTPException as exc: assert exc.status_code == 502
    else: assert False, 'Invalid model actions must fail without changing the diagram'


def test_clear_canvas_command():
    for phrase in ('clear the canvas', 'clear the canva', 'clear diagram', 'delete everything', 'clear the whole canvas'):
        assert is_clear_command(phrase)
        assert fallback(phrase) == [{'type': 'CLEAR'}]
        assert asyncio.run(llm_plan(PlanRequest(text=phrase))) == ([{'type': 'CLEAR'}], 'fallback')
    assert not is_clear_command('clear the canvas and add a backend')
    assert valid_actions([{'type': 'CLEAR'}])


def test_arrange_command_bypasses_planner():
    assert is_arrange_command('Arrange the diagram')
    assert asyncio.run(plan(PlanRequest(text='Arrange the diagram'))) == {'actions':[{'type':'ARRANGE'}],'mode':'fallback'}
    assert valid_actions([{'type':'ARRANGE'}])


def test_undo_and_redo_bypass_planner(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    class NoClient:
        def __init__(self, **kwargs): raise AssertionError('History commands should not call the LLM')
    monkeypatch.setattr('main.httpx.AsyncClient', NoClient)
    assert asyncio.run(plan(PlanRequest(text='Undo'))) == {'actions':[{'type':'UNDO','steps':1}],'mode':'fallback'}
    assert asyncio.run(plan(PlanRequest(text='undo undo'))) == {'actions':[{'type':'UNDO','steps':2}],'mode':'fallback'}
    assert asyncio.run(plan(PlanRequest(text='Please redo'))) == {'actions':[{'type':'REDO','steps':1}],'mode':'fallback'}
    assert history_command('undo the frontend') is None
    assert history_command('go back one step') == [{'type': 'UNDO', 'steps': 1}]
    assert history_command('revert the last change') == [{'type': 'UNDO', 'steps': 1}]
    assert history_command('do it again') == [{'type': 'REDO', 'steps': 1}]
    assert history_command('reverse this arrow') is None
    assert not valid_actions([{'type':'UNDO','steps':0}])


def test_mock_and_failure(monkeypatch):
    monkeypatch.setenv('GNANI_MOCK_TRANSCRIPT', 'Add Redis')
    audio = UploadFile(file=io.BytesIO(b'fake'), filename='test.webm')
    assert asyncio.run(transcribe(audio))['transcript'] == 'Add Redis'
    monkeypatch.delenv('GNANI_MOCK_TRANSCRIPT')
    monkeypatch.delenv('GNANI_API_KEY', raising=False)
    try: asyncio.run(transcribe(UploadFile(file=io.BytesIO(b'fake'), filename='test.webm')))
    except HTTPException as exc: assert exc.status_code == 503
    else: assert False, 'Expected missing key failure'
    try: asyncio.run(transcribe(UploadFile(file=io.BytesIO(b''), filename='empty.webm')))
    except HTTPException as exc: assert exc.status_code == 400
    else: assert False, 'Expected empty audio failure'


def test_rest_transcription_auto_detects_language(monkeypatch):
    monkeypatch.delenv('GNANI_MOCK_TRANSCRIPT', raising=False)
    monkeypatch.setenv('GNANI_API_KEY', 'test-key')
    monkeypatch.delenv('GNANI_LANGUAGE_CODE', raising=False)
    monkeypatch.setenv('GNANI_MODEL', 'prisma-v3.0')
    class Conversion:
        returncode = 0
        async def communicate(self, raw): return b'wav audio', b''
    async def convert(*args, **kwargs): return Conversion()
    monkeypatch.setattr('main.asyncio.create_subprocess_exec', convert)
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'transcript': 'Add a gateway'}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): calls.append(kwargs['data']); return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    result = asyncio.run(transcribe(UploadFile(file=io.BytesIO(b'audio'), filename='test.webm'), '["Payments API","Redis"]'))
    assert result['transcript'] == 'Add a gateway'
    assert calls[0]['language_code'] == 'indic-auto'
    assert 'preferred_language' not in calls[0]
    assert calls[0]['keywords'] == '["Payments API", "Redis"]'


def test_ffmpeg_conversion_does_not_block_other_async_work(monkeypatch):
    monkeypatch.delenv('GNANI_MOCK_TRANSCRIPT', raising=False)
    monkeypatch.setenv('GNANI_API_KEY', 'test-key')
    entered, release = asyncio.Event(), asyncio.Event()
    class Conversion:
        returncode = 0
        async def communicate(self, raw):
            entered.set()
            await release.wait()
            return b'wav audio', b''
    async def convert(*args, **kwargs): return Conversion()
    monkeypatch.setattr('main.asyncio.create_subprocess_exec', convert)
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'transcript': 'Add a gateway'}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    async def scenario():
        task = asyncio.create_task(transcribe(UploadFile(file=io.BytesIO(b'audio'), filename='test.webm')))
        await asyncio.wait_for(entered.wait(), 0.15)
        await asyncio.sleep(0.02)
        assert not task.done(), 'FFmpeg blocked the event loop'
        release.set()
        assert (await task)['transcript'] == 'Add a gateway'
    asyncio.run(scenario())


def test_plan():
    response = asyncio.run(plan(PlanRequest(text='Add API')))
    assert response['actions'][0]['type'] == 'ADD_NODE'


def test_llm_action_validation():
    assert valid_actions([{'type': 'ADD_NODE', 'label': 'Redis', 'shape': 'rectangle'}])
    assert not valid_actions([{'label': 'Redis'}])
    assert valid_actions([{'type': 'ADD_NODE', 'label': 'PostgreSQL', 'shape': 'cylinder'}])
    assert not valid_actions([{'type': 'ADD_NODE', 'label': 'Redis', 'shape': 'hexagon'}])
    assert fallback('Make PostgreSQL a cylinder') == [{'type':'UPDATE_NODE','target':'PostgreSQL','shape':'cylinder'}]


def test_agentrouter_planner_uses_completion_text(monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.setenv('AGENTROUTER_API_KEY', 'test-key')
    monkeypatch.setenv('AGENTROUTER_MODEL', 'deepseek-v4-flash')
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'success': True, 'completionText': '{"actions":[{"type":"ADD_NODE","label":"Frontend"}]}' }
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    actions, mode = asyncio.run(llm_plan(PlanRequest(text='Add frontend', selected_node_id='node-1')))
    assert mode == 'llm'
    assert actions == [{'type': 'ADD_NODE', 'label': 'Frontend'}]
    assert calls[0][0].endswith('/domains/models/capabilities/chat-complete/execute')
    assert calls[0][1]['json']['routeKey'] == 'models.chat.complete.deepseek.mpp'
    assert '"selected_node_id": "node-1"' in calls[0][1]['json']['messages'][1]['content']


def test_openai_key_takes_priority_over_agentrouter(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'openai-test-key')
    monkeypatch.setenv('AGENTROUTER_API_KEY', 'old-test-key')
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"actions":[{"type":"UPDATE_NODE","target":"node-1","color":"green"}]}'}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    actions, mode = asyncio.run(llm_plan(PlanRequest(text='Make this green', selected_node_id='node-1')))
    assert (actions, mode) == ([{'type': 'UPDATE_NODE', 'target': 'node-1', 'color': 'green'}], 'llm')
    assert calls[0][0] == 'https://api.openai.com/v1/chat/completions'
    assert calls[0][1]['json']['model'] == 'gpt-4o-mini'
    assert calls[0][1]['json']['response_format'] == {'type': 'json_schema', 'json_schema': {'name': 'diagram_plan', 'strict': True, 'schema': PLAN_SCHEMA}}
    assert "Speech transcripts may omit commas" in calls[0][1]['json']['messages'][0]['content']


def test_planner_reuses_lifespan_http_client(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    calls=[]
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices':[{'message':{'content':'{"actions":[{"type":"ADD_NODE","label":"Redis"}],"question":null}'}}]}
    class Client:
        async def post(self,*args,**kwargs): calls.append(args[0]);return Response()
    monkeypatch.setattr(main.app.state,'planner_client',Client(),raising=False)
    assert asyncio.run(llm_plan(PlanRequest(text='Add Redis')))[0][0]['label']=='Redis'
    assert asyncio.run(llm_plan(PlanRequest(text='Add Redis')))[0][0]['label']=='Redis'
    assert len(calls)==2


def test_ambiguous_name_stays_a_single_reference():
    request = PlanRequest(text='Make the database orange', nodes=[
        {'id': 'db-a', 'label': 'Main database'},
        {'id': 'db-b', 'label': 'Backup database'},
    ])
    assert ambiguous_fallback(request) == [{'type': 'UPDATE_NODE', 'target': 'database', 'color': 'orange'}]
    assert asyncio.run(llm_plan(request)) == ([{'type': 'UPDATE_NODE', 'target': 'database', 'color': 'orange'}], 'fallback')
    assert ambiguous_fallback(PlanRequest(text='Make this green', nodes=request.nodes, selected_node_id='db-b')) is None


def test_missing_detail(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    assert asyncio.run(plan(PlanRequest(text='Add')))['question'].startswith('What should')


def test_planner_question_and_answer(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    responses = iter(['{"actions":[],"question":"Which database should I connect?"}',
                      '{"actions":[{"type":"ADD_EDGE","source":"frontend","target":"main-db"}]}'])
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': next(responses)}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs): calls.append(kwargs['json']); return Response()
    monkeypatch.setattr('main.httpx.AsyncClient', Client)
    first = asyncio.run(plan(PlanRequest(text='Connect the frontend somewhere')))
    assert first['actions'] == []
    assert first['question'] == 'Which database should I connect?'
    second = asyncio.run(plan(PlanRequest(text='The main database', pending_command='Connect the frontend somewhere', clarification_answer='The main database')))
    assert second['actions'][0]['target'] == 'main-db'
    assert '"pending_command": "Connect the frontend somewhere"' in calls[1]['messages'][1]['content']


def test_unconnected_delete_checks_edges_even_when_planner_picks_wrong_id():
    command = "Remove, remove the authentication service which isn't connected to any other block."
    nodes = [{'id': 'connected', 'label': 'Authentication Services'},
             {'id': 'isolated', 'label': 'Authentication Services'},
             {'id': 'frontend', 'label': 'Frontend'}]
    edges = [{'sourceId': 'frontend', 'targetId': 'connected'}]
    wrong = [{'type': 'DELETE_NODE', 'target': 'connected'}]
    actions, question = guard_isolated_delete(PlanRequest(text=command, nodes=nodes, edges=edges), wrong)
    assert actions == [{'type': 'DELETE_NODE', 'target': 'isolated'}]
    assert question is None
    assert guard_isolated_delete(PlanRequest(text='Remove the unconnected Authentication Services', nodes=nodes, edges=edges), wrong)[0] == actions
    assert guard_isolated_delete(PlanRequest(text='Remove Authentication Services', nodes=nodes, edges=edges), wrong) == (wrong, None)


def test_unconnected_delete_asks_when_multiple_or_none_match():
    command = 'Delete the Authentication Services which are not connected to any other block'
    nodes = [{'id': 'a', 'label': 'Authentication Services'}, {'id': 'b', 'label': 'Authentication Services'}]
    wrong = [{'type': 'DELETE_NODE', 'target': 'a'}]
    request = PlanRequest(text=command, nodes=nodes)
    actions, question = guard_isolated_delete(request, wrong)
    assert actions == [] and 'multiple' in question
    selected = PlanRequest(text='this one', pending_command=command, selected_node_id='b', nodes=nodes)
    assert guard_isolated_delete(selected, wrong) == ([{'type': 'DELETE_NODE', 'target': 'b'}], None)
    connected = PlanRequest(text=command, nodes=nodes, edges=[{'sourceId': 'a', 'targetId': 'b'}])
    actions, question = guard_isolated_delete(connected, wrong)
    assert actions == [] and "couldn't find" in question


def test_plan_corrects_wrong_connected_delete(monkeypatch):
    async def wrong_plan(_request):
        return [{'type': 'DELETE_NODE', 'target': 'connected'}], 'llm', None
    monkeypatch.setattr('main.llm_plan_detail', wrong_plan)
    result = asyncio.run(plan(PlanRequest(
        text="Remove, remove the authentication service which isn't connected to any other block.",
        nodes=[{'id': 'connected', 'label': 'Authentication Services'}, {'id': 'isolated', 'label': 'Authentication Services'}],
        edges=[{'sourceId': 'frontend', 'targetId': 'connected'}],
    )))
    assert result == {'actions': [{'type': 'DELETE_NODE', 'target': 'isolated'}], 'mode': 'llm'}
