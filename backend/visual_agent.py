"""Read-only visual design agent with grounded, user-approved style proposals."""
import json
import re
from typing import Any, Awaitable, Callable, Literal

import httpx
from pydantic import BaseModel, Field
from scope_context import scopes

from review_agent import model_available, model_decision


class VisualNode(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    shape: Literal['rectangle', 'ellipse', 'diamond', 'cylinder'] = 'rectangle'
    shapeSource: Literal['explicit', 'suggested', 'intent'] | None = None
    role: Literal['component', 'database', 'topic', 'note', 'process', 'decision', 'start', 'end'] | None = None
    roleSource: Literal['explicit', 'intent', 'manual', 'legacy'] | None = None


class VisualEdge(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    sourceId: str
    targetId: str
    label: str = Field(max_length=120)
    relation: str | None = None


class VisualGroup(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    nodeIds: list[str] = Field(max_length=100)


class VisualContainer(VisualGroup):
    id: str = Field(min_length=1, max_length=80)
    parentId: str | None = None
    collapsed: bool = False
    intentType: str | None = None
    rootId: str | None = None


class VisualRequest(BaseModel):
    nodes: list[VisualNode] = Field(max_length=100)
    edges: list[VisualEdge] = Field(max_length=300)
    groups: list[VisualGroup] = Field(default_factory=list, max_length=50)
    containers: list[VisualContainer] = Field(default_factory=list, max_length=50)
    suggest_shapes: bool = False
    reconsider_explicit_shapes: bool = False
    diagram_context: dict[str, Any] = Field(default_factory=dict)


COLORS = {
    'gateway': '#3869a8', 'client': '#5577a4', 'service': '#6259a6',
    'database': '#187d70', 'cache': '#a66728', 'messaging': '#8a54a1',
    'replica': '#218294', 'component': '#65748b',
    'start': '#247d74', 'end': '#a66728', 'decision': '#8a54a1', 'process': '#6259a6',
}
GROUP_COLORS = ['#6259a6', '#3869a8', '#8a54a1', '#a66728', '#247d74']


def role(label: str) -> str:
    value = label.casefold()
    if re.search(r'\b(replica|backup|standby|failover)\b', value):
        return 'replica'
    if re.search(r'\b(redis|memcache|cache)\b', value):
        return 'cache'
    if re.search(r'\b(kafka|rabbitmq|queue|broker|event bus|pubsub)\b', value):
        return 'messaging'
    if re.search(r'\b(postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite|database|db)\b', value):
        return 'database'
    if re.search(r'\b(gateway|ingress|load balancer|proxy)\b', value):
        return 'gateway'
    if re.search(r'\b(frontend|front-end|browser|web app|mobile app|client|ui)\b', value):
        return 'client'
    if re.search(r'\b(service|backend|api|auth|orders?|billing|payments?|worker)\b', value):
        return 'service'
    return 'component'


def semantic_role(node: VisualNode, diagram_type: str | None = None) -> str:
    if node.roleSource == 'explicit' and node.role:
        return node.role
    if diagram_type in ('mindmap', 'hierarchy'):
        return 'topic'
    if diagram_type == 'brainstorming':
        return 'note'
    if diagram_type == 'flowchart':
        return 'start' if node.label.casefold() == 'start' else 'end' if node.label.casefold() == 'end' else 'decision' if node.label.endswith('?') else 'process'
    if diagram_type in (None, 'mixed'):
        return 'component'
    return role(node.label)


def inspect_roles(request: VisualRequest) -> dict[str, Any]:
    return {'nodes': [{'id': node.id, 'label': node.label, 'role': semantic_role(node, request.diagram_context.get('type')), 'shape': node.shape,
                       'shapeSource': node.shapeSource} for node in request.nodes],
            'groups': [group.model_dump() for group in request.groups],
            'containers': [container.model_dump() for container in request.containers]}


def inspect_connections(request: VisualRequest) -> dict[str, Any]:
    nodes = {node.id: node for node in request.nodes}
    return {'edges': [{'id': edge.id, 'source': nodes[edge.sourceId].label, 'target': nodes[edge.targetId].label,
                       'label': edge.label, 'relation': edge.relation, 'target_role': semantic_role(nodes[edge.targetId], request.diagram_context.get('type'))}
                      for edge in request.edges if edge.sourceId in nodes and edge.targetId in nodes]}


def shape_suggestions(request: VisualRequest) -> dict[str, dict[str, str]]:
    if not request.suggest_shapes or request.diagram_context.get('type') == 'mindmap':
        return {}
    suggestions = {}
    for node in request.nodes:
        if request.diagram_context.get('type') in (None, 'hierarchy', 'brainstorming', 'flowchart', 'mixed') and node.roleSource != 'explicit':
            continue
        # Existing user choices, including non-rectangle shapes from older project files, win.
        if not request.reconsider_explicit_shapes and (node.shapeSource == 'explicit' or (node.shapeSource is None and node.shape != 'rectangle')):
            continue
        if node.roleSource == 'explicit' and node.role in ('note', 'topic', 'component', 'process'):
            continue
        label = node.label.strip()
        explicit_role = node.role if node.roleSource == 'explicit' else None
        if explicit_role == 'decision' or (explicit_role is None and (label.endswith('?') or re.search(r'\b(?:decision|condition)\b', label, re.I)
                or re.match(r'^(?:is|are|does|do|should|can|has|have|was|were)\b', label, re.I))):
            desired = 'diamond'
            reason = 'The label states a decision or condition; a diamond makes its branches easier to read.'
        elif explicit_role == 'database' or (explicit_role is None and re.search(r'\b(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite|database)\b', label, re.I)):
            desired = 'cylinder'
            reason = 'The label explicitly identifies a persistent database; a cylinder marks data storage.'
        elif explicit_role in ('start', 'end') or (explicit_role is None and re.fullmatch(r'(?:start|begin|entry|end|finish|completed|done)(?:\s+(?:flow|workflow|process))?', label, re.I)):
            desired = 'ellipse'
            reason = 'The label explicitly marks the start or end of a workflow.'
        else:
            continue
        if desired != node.shape:
            suggestions[node.id] = {'shape': desired, 'reason': reason}
    return suggestions


def proposal(request: VisualRequest, mode: str, tools: list[str], emphasis: str = 'roles') -> dict[str, Any]:
    if any(container.intentType for container in request.containers):
        by_id = {node.id: node for node in request.nodes}
        node_styles: dict[str, Any] = {};edge_styles: dict[str, Any] = {};shapes: dict[str, Any] = {};roles=[]
        for scope in scopes(request.nodes, request.edges, request.containers, request.diagram_context):
            ids = set(scope['nodes'])
            sub = VisualRequest(nodes=[by_id[id] for id in scope['nodes']], edges=scope['edges'],
                                groups=[group for group in request.groups if ids.intersection(group.nodeIds)],
                                diagram_context={'type':scope['type'],'rootId':scope['rootId']},
                                suggest_shapes=request.suggest_shapes,reconsider_explicit_shapes=request.reconsider_explicit_shapes)
            result = proposal(sub,'rules',[],emphasis)
            node_styles.update(result['node_styles']);edge_styles.update(result['edge_styles'])
            shapes.update(result['shape_suggestions']);roles.extend(result['roles'])
        edge_styles.update({edge.id:{'color':'#65748b','fontFamily':2} for edge in request.edges if edge.id not in edge_styles})
        container_styles = {container.id:{'color':{'architecture':'#3869a8','mindmap':'#6259a6','hierarchy':'#247d74','brainstorming':'#a66728','flowchart':'#8a54a1'}.get(container.intentType,'#65748b')} for container in request.containers}
        return {'mode':mode,'tools_used':tools or ['inspect_scopes'],'node_styles':node_styles,'edge_styles':edge_styles,
                'shape_suggestions':shapes,'container_styles':container_styles,'boundary_questions':[],
                'roles':roles,'summary':'Styles follow each container’s diagram type and named groups.'}
    if request.diagram_context.get('type') == 'mindmap':
        root = request.diagram_context.get('rootId')
        parent = {edge.targetId: edge.sourceId for edge in request.edges if edge.relation == 'branch'}
        primary = [edge.targetId for edge in request.edges if edge.relation == 'branch' and edge.sourceId == root]
        def branch(id: str) -> str:
            seen = set()
            while id in parent and id not in seen and parent[id] != root:
                seen.add(id); id = parent[id]
            return id if id in primary else ''
        palette = {id: GROUP_COLORS[index % len(GROUP_COLORS)] for index, id in enumerate(primary)}
        colors = {node.id: '#6259a6' if node.id == root else palette.get(branch(node.id), '#65748b') for node in request.nodes}
        return {'mode': mode, 'tools_used': tools or ['inspect_branches'],
                'node_styles': {node.id: {'color': colors[node.id], 'fontFamily': 2} for node in request.nodes},
                'edge_styles': {edge.id: {'color': colors.get(branch(edge.targetId), '#65748b'), 'fontFamily': 2} for edge in request.edges},
                'shape_suggestions': {}, 'container_styles': {}, 'boundary_questions': [],
                'roles': [{'id': node.id, 'label': node.label, 'role': 'central topic' if node.id == root else 'topic', 'group': branch(node.id)} for node in request.nodes],
                'summary': 'Colors follow branches from the central topic; typography stays consistent across topics.'}
    if request.diagram_context.get('type') == 'brainstorming':
        group_colors = {id: GROUP_COLORS[index % len(GROUP_COLORS)] for index, group in enumerate(request.groups)
                        for id in group.nodeIds}
        colors = {node.id: group_colors.get(node.id, '#65748b') for node in request.nodes}
        return {'mode': mode, 'tools_used': tools or ['inspect_notes_and_groups'],
                'node_styles': {node.id: {'color': colors[node.id], 'fontFamily': 2} for node in request.nodes},
                'edge_styles': {edge.id: {'color': colors.get(edge.targetId, '#65748b'), 'fontFamily': 2} for edge in request.edges},
                'shape_suggestions': shape_suggestions(request),
                'container_styles': {container.id: {'color': '#65748b'} for container in request.containers},
                'boundary_questions': [],
                'roles': [{'id': node.id, 'label': node.label, 'role': semantic_role(node, 'brainstorming'),
                           'group': next((group.name for group in request.groups if node.id in group.nodeIds), '')} for node in request.nodes],
                'summary': 'Named idea groups get distinct colors; ungrouped notes stay neutral with consistent typography.'}
    ids = {node.id for node in request.nodes}
    group_by_node = {id: (index, group.name) for index, group in enumerate([*request.groups,*request.containers])
                     for id in group.nodeIds if id in ids}
    node_styles: dict[str, dict[str, Any]] = {}
    roles: list[dict[str, str]] = []
    for node in request.nodes:
        kind = semantic_role(node, request.diagram_context.get('type'))
        group = group_by_node.get(node.id)
        color = GROUP_COLORS[group[0] % len(GROUP_COLORS)] if emphasis == 'groups' and group and kind in ('service', 'component') else COLORS.get(kind, COLORS['component'])
        node_styles[node.id] = {'color': color, 'fontFamily': 3 if kind in ('database', 'cache', 'messaging', 'replica') else 2}
        roles.append({'id': node.id, 'label': node.label, 'role': kind, 'group': group[1] if group else ''})
    edge_styles: dict[str, dict[str, Any]] = {}
    for edge in request.edges:
        if edge.sourceId not in ids or edge.targetId not in ids:
            continue
        target = next(node for node in request.nodes if node.id == edge.targetId)
        label = edge.label.casefold()
        if request.diagram_context.get('type') == 'hierarchy':
            color = node_styles[target.id]['color']
        elif re.search(r'\b(replication|replica|sync|backup)\b', label):
            color = COLORS['replica']
        elif re.search(r'\b(auth|token|oauth|jwt)\b', label):
            color = COLORS['gateway']
        else:
            color = node_styles[target.id]['color']
        edge_styles[edge.id] = {'color': color, 'fontFamily': 2 if request.diagram_context.get('type') == 'hierarchy' else 3}
    counts: dict[str, int] = {}
    for item in roles:
        counts[item['role']] = counts.get(item['role'], 0) + 1
    details = ', '.join(f'{count} {kind}{"s" if count != 1 else ""}' for kind, count in counts.items())
    group_note = ' Named groups and containers share a color.' if emphasis == 'groups' and (request.groups or request.containers) else ''
    container_styles = {container.id: {'color': '#65748b' if request.diagram_context.get('type') == 'hierarchy' else COLORS[role(container.name)]}
                        for container in request.containers}
    boundary_questions = [f'What does the “{container.name}” boundary represent? Rename it to a specific role if you want a role-based style.'
                          for container in request.containers if role(container.name) == 'component']
    shapes = shape_suggestions(request)
    summary = (f'{len(shapes)} shape change(s) suggested from explicit node roles.' if request.suggest_shapes else
               'Start, decisions, steps, and end states use distinct colors; branch labels remain readable.'
               if request.diagram_context.get('type') == 'flowchart' else
               f'Hierarchy nodes use consistent typography; parent–child links follow their child nodes.{group_note}'
               if request.diagram_context.get('type') == 'hierarchy' else
               f'Colors follow component roles and connection targets ({details}). Data stores and connection labels use monospace.{group_note}')
    return {'mode': mode, 'tools_used': tools, 'node_styles': node_styles, 'edge_styles': edge_styles,
            'shape_suggestions': shapes,
            'container_styles': container_styles, 'boundary_questions': boundary_questions,
            'roles': roles, 'summary': summary}


async def run_visual_design(request: VisualRequest, client: httpx.AsyncClient | None = None,
                            choose: Callable[[list[dict[str, str]]], Awaitable[dict[str, Any]]] | None = None) -> dict[str, Any]:
    if any(container.intentType for container in request.containers):
        return proposal(request, 'rules', ['inspect_scopes'])
    if request.diagram_context.get('type') == 'mindmap':
        return proposal(request, 'rules', ['inspect_branches'])
    if request.diagram_context.get('type') == 'hierarchy':
        return proposal(request, 'rules', ['inspect_roles', 'inspect_connections'])
    if request.diagram_context.get('type') == 'brainstorming':
        return proposal(request, 'rules', ['inspect_notes_and_groups'])
    if request.diagram_context.get('type') == 'flowchart':
        return proposal(request, 'rules', ['inspect_roles', 'inspect_connections'])
    if not request.nodes:
        return proposal(request, 'rules', [])
    if choose is None and not model_available():
        return proposal(request, 'rules', ['inspect_roles', 'inspect_connections'], 'groups' if request.groups or request.containers else 'roles')
    system = ('You are a read-only visual design agent. Return only JSON. Call one tool at a time: '
              '{"tool":"inspect_roles"} or {"tool":"inspect_connections"}. '
              'After up to two tool calls finish with {"tool":"finish","emphasis":"roles|groups"}. '
              'Use groups only when named groups or containers exist. A nested boundary does not imply a security or deployment role. Do not invent architecture roles, IDs, colors, or edit actions; '
              'saved diagram decisions are context, not permission to style existing elements; the server constructs all styles from verified graph evidence.')
    messages = [{'role': 'system', 'content': system},
                {'role': 'user', 'content': json.dumps({'nodes': [node.model_dump() for node in request.nodes],
                                                      'edges': [edge.model_dump() for edge in request.edges],
                                                      'groups': [group.model_dump() for group in request.groups],
                                                      'containers': [container.model_dump() for container in request.containers],
                                                      'suggest_shapes': request.suggest_shapes,
                                                      'reconsider_explicit_shapes': request.reconsider_explicit_shapes,
                                                      'diagram_context': request.diagram_context})}]
    tools: list[str] = []
    owned = client is None and choose is None
    if owned:
        client = httpx.AsyncClient(timeout=25)
    try:
        for _ in range(3):
            decision = await (choose(messages) if choose else model_decision(messages, client))  # type: ignore[arg-type]
            tool = decision.get('tool')
            if tool == 'finish':
                if not tools or decision.get('emphasis') not in ('roles', 'groups'):
                    raise ValueError('Invalid visual design choice')
                emphasis = decision['emphasis'] if request.groups or request.containers else 'roles'
                return proposal(request, 'agent', tools, emphasis)
            if len(tools) >= 2:
                break
            if tool == 'inspect_roles':
                evidence = inspect_roles(request)
            elif tool == 'inspect_connections':
                evidence = inspect_connections(request)
            else:
                raise ValueError('Invalid visual design tool')
            tools.append(tool)
            messages.extend([{'role': 'assistant', 'content': json.dumps(decision)},
                             {'role': 'user', 'content': json.dumps({'tool_result': evidence})}])
        raise ValueError('Visual design agent did not finish')
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return proposal(request, 'rules', ['inspect_roles', 'inspect_connections'], 'groups' if request.groups or request.containers else 'roles')
    finally:
        if owned:
            await client.aclose()  # type: ignore[union-attr]
