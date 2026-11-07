"""Resolve the nearest explicit container intent for each node."""
from typing import Any


def scopes(nodes: list[Any], edges: list[Any], containers: list[Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    raw = [item.model_dump() if hasattr(item, 'model_dump') else item for item in containers]
    by_id = {item['id']: item for item in raw if isinstance(item, dict) and isinstance(item.get('id'), str)}
    direct = {node_id: item['id'] for item in raw for node_id in item.get('nodeIds', []) if isinstance(node_id, str)}
    node_ids = [node.id if hasattr(node, 'id') else node['id'] for node in nodes]
    assigned: dict[str, str] = {}
    groups: dict[str, dict[str, Any]] = {}
    for id in node_ids:
        cursor = direct.get(id)
        seen = set()
        owner = None
        while cursor in by_id and cursor not in seen:
            seen.add(cursor)
            item = by_id[cursor]
            if item.get('intentType'):
                owner = item
                break
            cursor = item.get('parentId')
        key = owner['id'] if owner else 'canvas'
        assigned[id] = key
        groups.setdefault(key, {'id': key, 'name': owner['name'] if owner else 'Canvas',
                                'type': owner['intentType'] if owner else context.get('type'),
                                'rootId': owner.get('rootId') if owner else context.get('rootId'),
                                'nodes': [], 'edges': []})['nodes'].append(id)
    for edge in edges:
        source = edge.sourceId if hasattr(edge, 'sourceId') else edge.get('sourceId')
        target = edge.targetId if hasattr(edge, 'targetId') else edge.get('targetId')
        if source in assigned and assigned[source] == assigned.get(target):
            groups[assigned[source]]['edges'].append(edge)
    return list(groups.values())
