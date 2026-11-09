import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from review_agent import ReviewRequest, finding_from_evidence, run_review, shared_dependencies


def diagram():
    return ReviewRequest(
        nodes=[{"id": "auth", "label": "Auth"}, {"id": "orders", "label": "Orders"},
               {"id": "billing", "label": "Billing"}, {"id": "db", "label": "PostgreSQL database"}],
        edges=[{"id": "a", "sourceId": "auth", "targetId": "db"},
               {"id": "o", "sourceId": "orders", "targetId": "db"},
               {"id": "b", "sourceId": "billing", "targetId": "db"}],
    )


def test_review_evidence_and_proposal_are_grounded_in_the_graph():
    request = diagram()
    evidence = shared_dependencies(request)[0]
    finding = finding_from_evidence(request, evidence)
    assert finding["node_ids"] == ["db", "auth", "orders", "billing"]
    assert finding["edge_ids"] == ["a", "o", "b"]
    assert finding["actions"] == [
        {"type": "ADD_NODE", "label": "PostgreSQL database replica"},
        {"type": "ADD_EDGE", "source": "db", "target": "PostgreSQL database replica", "label": "replication"},
    ]
    request.edges.append(type(request.edges[0])(id="replica-edge", sourceId="db", targetId="replica"))
    request.nodes.append(type(request.nodes[0])(id="replica", label="PostgreSQL replica"))
    assert shared_dependencies(request) == []


def test_review_respects_explicit_named_failover_note_only():
    request = diagram()
    request.diagram_context = {'type': 'architecture', 'notes': ['PostgreSQL database already has failover outside this diagram']}
    assert shared_dependencies(request) == []
    request.diagram_context['notes'] = ['PostgreSQL database is managed externally']
    assert len(shared_dependencies(request)) == 1
    request.nodes.append(type(request.nodes[0])(id='second-db', label='PostgreSQL database'))
    request.diagram_context['notes'] = ['PostgreSQL database already has failover outside this diagram']
    assert len(shared_dependencies(request)) == 1


def test_agent_calls_graph_tools_and_returns_one_verified_finding():
    calls = []

    async def choose(messages):
        calls.append(messages)
        if len(calls) == 1:
            return {"tool": "shared_dependencies", "node_id": None}
        if len(calls) == 2:
            return {"tool": "trace_connections", "node_id": "db"}
        return {"tool": "finish", "finding_id": "shared:db"}

    result = asyncio.run(run_review(diagram(), choose=choose))
    assert result["mode"] == "agent"
    assert result["tools_used"] == ["shared_dependencies", "trace_connections"]
    assert result["finding"]["title"] == "Shared database dependency"
    assert len(calls) == 3


def test_review_degrades_to_explicit_rules_when_model_fails():
    async def fail(_messages):
        raise ValueError("Invalid model response")

    result = asyncio.run(run_review(diagram(), choose=fail))
    assert result["mode"] == "rules"
    assert result["finding"]["node_ids"][0] == "db"
