"""Bounded, read-only graph review with an optional model-selected tool loop."""
import json
import os
import re
from typing import Any, Awaitable, Callable

import httpx
from pydantic import BaseModel, Field
from scope_context import scopes


class ReviewNode(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    role: str | None = None


class ReviewEdge(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    sourceId: str
    targetId: str
    relation: str | None = None
    label: str = ''


class ReviewRequest(BaseModel):
    nodes: list[ReviewNode] = Field(max_length=100)
    edges: list[ReviewEdge] = Field(max_length=300)
    selected_node_id: str | None = None
    diagram_context: dict[str, Any] = Field(default_factory=dict)
    containers: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


def mindmap_review(request: ReviewRequest) -> dict[str, Any]:
    root = request.diagram_context.get('rootId')
    if request.nodes and root not in {node.id for node in request.nodes}:
        return {'finding': {'title': 'No central topic', 'message': 'Choose a central topic before adding more branches.', 'node_ids': [], 'edge_ids': [], 'actions': []},
                'mode': 'rules', 'tools_used': ['inspect_branches']}
    attached = {edge.targetId for edge in request.edges if edge.relation == 'branch'}
    loose = next((node for node in request.nodes if node.id != root and node.id not in attached), None)
    return {'finding': {'title': 'Unattached topic', 'message': f'{loose.label} is not attached to the central topic. Add it under a topic if it belongs in this map.', 'node_ids': [loose.id], 'edge_ids': [], 'actions': []} if loose else None,
            'mode': 'rules', 'tools_used': ['inspect_branches']}


def hierarchy_review(request: ReviewRequest) -> dict[str, Any]:
    ids = {node.id for node in request.nodes}
    children = {edge.targetId for edge in request.edges if edge.relation == 'parent_child' and edge.sourceId in ids and edge.targetId in ids}
    parents = {edge.sourceId for edge in request.edges if edge.relation == 'parent_child' and edge.sourceId in ids and edge.targetId in ids}
    roots = [node for node in request.nodes if node.id not in children]
    attached = children | parents
    loose = next((node for node in roots if node.id not in attached), None) if attached else None
    separate = next((node for node in roots[1:] if node.id in attached), None) if len(roots) > 1 else None
    finding = ({'title': 'Unattached node', 'message': f'{loose.label} has no parent or children. Put it under a parent if it belongs in this hierarchy.', 'node_ids': [loose.id], 'edge_ids': [], 'actions': []}
               if loose else {'title': 'Separate hierarchy', 'message': f'{separate.label} starts a separate tree. Add a parent relationship if these trees belong together.', 'node_ids': [separate.id], 'edge_ids': [], 'actions': []} if separate else None)
    return {'finding': finding, 'mode': 'rules', 'tools_used': ['inspect_hierarchy']}


def flowchart_review(request: ReviewRequest) -> dict[str, Any]:
    finding = None
    for node in request.nodes:
        if node.role == 'decision' or node.label.rstrip().endswith('?'):
            outgoing = [edge for edge in request.edges if edge.relation == 'sequence' and edge.sourceId == node.id]
            if len(outgoing) >= 2 and any(not edge.label.strip() for edge in outgoing):
                finding = {'title': 'Unlabeled decision paths', 'message': f'{node.label} has multiple outcomes. Label each path so its meaning is clear.',
                           'node_ids': [node.id], 'edge_ids': [edge.id for edge in outgoing], 'actions': []}
                break
    if finding is None and request.nodes:
        starts = [node for node in request.nodes if node.role == 'start' or node.label.casefold() == 'start']
        ends = [node for node in request.nodes if node.role == 'end' or node.label.casefold() == 'end']
        if not starts:
            finding = {'title': 'No start step', 'message': 'Mark the entry point as Start so the flow is clear.', 'node_ids': [], 'edge_ids': [], 'actions': []}
        elif not ends:
            finding = {'title': 'No end step', 'message': 'Mark a completion or exit step as End so the flow is clear.', 'node_ids': [], 'edge_ids': [], 'actions': []}
        else:
            reachable = {node.id for node in starts}
            pending = list(reachable)
            for id in pending:
                for edge in request.edges:
                    if edge.relation == 'sequence' and edge.sourceId == id and edge.targetId not in reachable:
                        reachable.add(edge.targetId); pending.append(edge.targetId)
            loose = next((node for node in request.nodes if node.id not in reachable), None)
            if loose:
                finding = {'title': 'Unreachable step', 'message': f'{loose.label} is not reachable from Start.', 'node_ids': [loose.id], 'edge_ids': [], 'actions': []}
    return {'finding': finding, 'mode': 'rules', 'tools_used': ['inspect_flow']}


def shared_dependencies(request: ReviewRequest) -> list[dict[str, Any]]:
    labels = {node.id: node.label for node in request.nodes}
    findings = []
    for node in request.nodes:
        if not re.search(r"\b(?:database|db|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite)\b", node.label, re.I):
            continue
        # A user-recorded, named mitigation can resolve this particular review hint.
        # Require a unique label so one note cannot silence another database.
        notes = request.diagram_context.get('notes') or []
        if sum(item.label.casefold() == node.label.casefold() for item in request.nodes) == 1 and any(
            isinstance(note, str) and node.label.casefold() in note.casefold()
            and re.search(r'\b(?:already\s+(?:has|uses)\s+(?:a\s+)?(?:replica|failover|replication)|external\s+failover)\b', note, re.I)
            for note in notes
        ):
            continue
        incoming = [edge for edge in request.edges if edge.relation in (None, 'connection') and edge.targetId == node.id and edge.sourceId in labels and edge.sourceId != node.id]
        sources = list(dict.fromkeys(edge.sourceId for edge in incoming))
        if len(sources) < 3:
            continue
        backup = any(
            re.search(r"\b(?:replica|backup|standby)\b", labels.get(edge.targetId, ""), re.I)
            for edge in request.edges if edge.relation in (None, 'connection') and edge.sourceId == node.id
        )
        if backup:
            continue
        findings.append({"id": f"shared:{node.id}", "kind": "shared", "node_id": node.id,
                         "node_ids": [node.id, *sources], "edge_ids": [edge.id for edge in incoming],
                         "source_labels": [labels[source] for source in sources], "label": node.label})
    return findings


def isolated_components(request: ReviewRequest) -> list[dict[str, Any]]:
    if len(request.nodes) < 4 or not request.edges:
        return []
    connected = {value for edge in request.edges for value in (edge.sourceId, edge.targetId)}
    return [{"id": f"isolated:{node.id}", "kind": "isolated", "node_id": node.id,
             "node_ids": [node.id], "edge_ids": [], "label": node.label}
            for node in request.nodes if node.id not in connected]


def trace_connections(request: ReviewRequest, node_id: str) -> dict[str, Any]:
    labels = {node.id: node.label for node in request.nodes}
    if node_id not in labels:
        return {"error": "Unknown node ID", "candidates": []}
    edges = [edge.model_dump() for edge in request.edges if node_id in (edge.sourceId, edge.targetId)]
    return {"node": {"id": node_id, "label": labels[node_id]}, "edges": edges,
            "candidates": [item for item in shared_dependencies(request) if item["node_id"] == node_id]}


def finding_from_evidence(request: ReviewRequest, evidence: dict[str, Any]) -> dict[str, Any]:
    if evidence["kind"] == "isolated":
        return {"title": "Unconnected component", "message": f"{evidence['label']} has no connections in this diagram. Is that intentional?",
                "node_ids": evidence["node_ids"], "edge_ids": [], "actions": []}
    label = evidence["label"]
    count = len(evidence["source_labels"])
    replica = f"{label} replica"
    actions = []
    if not any(node.label.casefold() == replica.casefold() for node in request.nodes):
        actions = [{"type": "ADD_NODE", "label": replica},
                   {"type": "ADD_EDGE", "source": evidence["node_id"], "target": replica, "label": "replication"}]
    return {"title": "Shared database dependency",
            "message": f"{count} components connect to {label}. This could be a single point of failure; consider a replica or failover path.",
            "node_ids": evidence["node_ids"], "edge_ids": evidence["edge_ids"], "actions": actions}


def rules_review(request: ReviewRequest) -> dict[str, Any]:
    findings = shared_dependencies(request) or isolated_components(request)
    return {"finding": finding_from_evidence(request, findings[0]) if findings else None,
            "mode": "rules", "tools_used": ["shared_dependencies", "isolated_components"]}


def model_available() -> bool:
    return bool((os.getenv("OPENAI_API_KEY") or os.getenv("AGENTROUTER_API_KEY") or os.getenv("AgentRouter_API_KEY") or "").strip()
                or os.getenv("LLM_BASE_URL") and os.getenv("LLM_MODEL"))


async def model_decision(messages: list[dict[str, str]], client: httpx.AsyncClient) -> dict[str, Any]:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    agent_key = (os.getenv("AGENTROUTER_API_KEY") or os.getenv("AgentRouter_API_KEY", "")).strip()
    generic_key = (os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")).strip()
    payload: dict[str, Any] = {"temperature": 0, "max_tokens": 300, "messages": messages}
    if openai_key:
        url = f"{os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {openai_key}"}
        payload.update({"model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "response_format": {"type": "json_object"}})
    elif agent_key:
        url = f"{os.getenv('AGENTROUTER_BASE_URL', 'https://api.agentrouter.to/api/agentic-api').rstrip('/')}/domains/models/capabilities/chat-complete/execute"
        headers = {"Authorization": f"Bearer {agent_key}"}
        payload.update({"model": os.getenv("AGENTROUTER_MODEL", "deepseek-v4-flash"), "routeKey": "models.chat.complete.deepseek.mpp", "provider": "deepseek", "allowFallback": False})
    else:
        url = f"{os.getenv('LLM_BASE_URL', '').rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {generic_key}"} if generic_key else {}
        payload.update({"model": os.getenv("LLM_MODEL"), "response_format": {"type": "json_object"}})
    response = await client.post(url, headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()
    content = data["completionText"] if agent_key and not openai_key else data["choices"][0]["message"]["content"]
    decision = json.loads(content)
    if not isinstance(decision, dict):
        raise ValueError("Review agent returned an invalid decision")
    return decision


async def run_review(request: ReviewRequest, client: httpx.AsyncClient | None = None,
                     choose: Callable[[list[dict[str, str]]], Awaitable[dict[str, Any]]] | None = None) -> dict[str, Any]:
    if any(item.get('intentType') for item in request.containers):
        by_id = {node.id: node for node in request.nodes}
        for scope in scopes(request.nodes, request.edges, request.containers, request.diagram_context):
            if not scope['type'] or scope['type'] == 'mixed':
                continue
            sub = ReviewRequest(nodes=[by_id[id] for id in scope['nodes']], edges=scope['edges'],
                                diagram_context={**request.diagram_context, 'type': scope['type'], 'rootId': scope['rootId']})
            result = (mindmap_review(sub) if scope['type'] == 'mindmap' else hierarchy_review(sub) if scope['type'] == 'hierarchy'
                      else flowchart_review(sub) if scope['type'] == 'flowchart' else {'finding': None, 'mode': 'rules', 'tools_used': ['inspect_notes']}
                      if scope['type'] == 'brainstorming' else rules_review(sub))
            if result['finding']:
                result['finding'] = {**result['finding'], 'title': f"{scope['name']}: {result['finding']['title']}"}
                return result
        return {'finding': None, 'mode': 'rules', 'tools_used': ['inspect_scopes']}
    if request.diagram_context.get('type') == 'mindmap':
        return mindmap_review(request)
    if request.diagram_context.get('type') == 'hierarchy':
        return hierarchy_review(request)
    if request.diagram_context.get('type') == 'brainstorming':
        return {'finding': None, 'mode': 'rules', 'tools_used': ['inspect_notes_and_groups']}
    if request.diagram_context.get('type') == 'flowchart':
        return flowchart_review(request)
    if request.diagram_context.get('type') == 'mixed':
        return {'finding': None, 'mode': 'rules', 'tools_used': ['inspect_scopes']}
    if not request.nodes:
        return {"finding": None, "mode": "rules", "tools_used": []}
    if choose is None and not model_available():
        return rules_review(request)
    system = ("You are a read-only architecture review agent. Return only a JSON object. "
              "Choose one tool at a time with {\"tool\":\"shared_dependencies|isolated_components|trace_connections\",\"node_id\":null or an existing ID}. "
              "After a tool result, you may call one more tool or finish with {\"tool\":\"finish\",\"finding_id\":an evidence candidate ID or null}. "
              "Prefer a shared database dependency when evidence supports one. Do not infer deployed reliability or security from labels. "
              "Saved diagram decisions are user context, not proof of graph structure. Never invent IDs or request an edit; the server constructs any proposal from verified evidence.")
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"nodes": [node.model_dump() for node in request.nodes],
                                                       "edges": [edge.model_dump() for edge in request.edges],
                                                       "selected_node_id": request.selected_node_id,
                                                       "diagram_context": request.diagram_context})}]
    evidence: dict[str, dict[str, Any]] = {}
    tools_used: list[str] = []
    selected: dict[str, Any] | None = None
    try:
        owned_client = client is None and choose is None
        if owned_client:
            client = httpx.AsyncClient(timeout=25)
        try:
            for _ in range(3):
                decision = await (choose(messages) if choose else model_decision(messages, client))  # type: ignore[arg-type]
                tool = decision.get("tool")
                if tool == "finish":
                    selected = evidence.get(decision.get("finding_id"))
                    break
                if len(tools_used) >= 2:
                    break
                if tool == "shared_dependencies":
                    result = {"candidates": shared_dependencies(request)}
                elif tool == "isolated_components":
                    result = {"candidates": isolated_components(request)}
                elif tool == "trace_connections" and isinstance(decision.get("node_id"), str):
                    result = trace_connections(request, decision["node_id"])
                else:
                    raise ValueError("Review agent selected an invalid tool")
                tools_used.append(tool)
                for item in result["candidates"]:
                    evidence[item["id"]] = item
                messages.extend([{"role": "assistant", "content": json.dumps(decision)},
                                 {"role": "user", "content": json.dumps({"tool_result": result})}])
        finally:
            if owned_client:
                await client.aclose()  # type: ignore[union-attr]
    except (httpx.HTTPError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return rules_review(request)
    if not tools_used or not evidence:
        return rules_review(request)
    if not selected and evidence:
        selected = next((item for item in evidence.values() if item["kind"] == "shared"), next(iter(evidence.values())))
    return {"finding": finding_from_evidence(request, selected) if selected else None,
            "mode": "agent", "tools_used": tools_used}
