"""Facts derived from the current scene, without assigning architecture meaning."""
from typing import Any
from scope_context import scopes


def canvas_facts(nodes: list[dict[str, Any]], edges: list[dict[str, Any]],
                 containers: list[dict[str, Any]], context: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    facts = {node['id']: {'id': node['id'], 'incoming_from': [], 'outgoing_to': [],
                          'container_path': [], 'hidden_by_collapse': False}
             for node in nodes if isinstance(node.get('id'), str)}
    for edge in edges:
        source, target = edge.get('sourceId'), edge.get('targetId')
        if isinstance(source, str) and isinstance(target, str) and source in facts and target in facts:
            facts[source]['outgoing_to'].append(target)
            facts[target]['incoming_from'].append(source)
    by_id = {item['id']: item for item in containers if isinstance(item.get('id'), str)}
    direct_parent = {id: item['id'] for item in by_id.values() if isinstance(item.get('nodeIds'), list)
                     for id in item['nodeIds'] if isinstance(id, str)}
    for id, fact in facts.items():
        parent = direct_parent.get(id)
        seen = set()
        while isinstance(parent, str) and parent in by_id and parent not in seen:
            seen.add(parent)
            container = by_id[parent]
            fact['container_path'].insert(0, parent)
            fact['hidden_by_collapse'] |= bool(container.get('collapsed'))
            parent = container.get('parentId')
    for scope in scopes(nodes,edges,containers,context or {}):
        for id in scope['nodes']:
            facts[id]['diagram_type'] = scope['type']
            facts[id]['intent_scope'] = scope['id']
    return list(facts.values())
