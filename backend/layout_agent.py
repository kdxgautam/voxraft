"""Bounded layout critique: measure candidate positions, then propose an undoable edit."""
import json
import math
from typing import Any, Awaitable, Callable

import httpx
from pydantic import BaseModel, Field

from review_agent import model_available, model_decision
from scope_context import scopes


class LayoutNode(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    x: float = Field(ge=-100000, le=100000)
    y: float = Field(ge=-100000, le=100000)
    width: float = Field(gt=0, le=3000)
    height: float = Field(gt=0, le=3000)
    role: str | None = None


class LayoutEdge(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    sourceId: str
    targetId: str
    relation: str | None = None

class LayoutContainer(BaseModel):
    id: str
    name: str = ''
    nodeIds: list[str] = Field(default_factory=list)
    parentId: str | None = None
    collapsed: bool = False
    intentType: str | None = None
    rootId: str | None = None


class LayoutRequest(BaseModel):
    nodes: list[LayoutNode] = Field(max_length=100)
    edges: list[LayoutEdge] = Field(max_length=300)
    containers: list[LayoutContainer] = Field(default_factory=list, max_length=50)
    diagram_context: dict[str, Any] = Field(default_factory=dict)


def mindmap_tree(request: LayoutRequest) -> dict[str, tuple[float, float]]:
    by_id = {node.id: node for node in request.nodes}
    root = by_id.get(request.diagram_context.get('rootId'))
    positions = {node.id: (node.x, node.y) for node in request.nodes}
    if not root:
        return positions
    children: dict[str, list[str]] = {node.id: [] for node in request.nodes}
    attached = set()
    for edge in request.edges:
        if edge.relation == 'branch' and edge.sourceId in children and edge.targetId in by_id and edge.targetId not in attached:
            children[edge.sourceId].append(edge.targetId); attached.add(edge.targetId)
    def height(id: str, seen: frozenset[str] = frozenset()) -> float:
        if id in seen:
            return 0
        descendants = children[id]
        return max(by_id[id].height + 45, sum(height(child, seen | {id}) for child in descendants)) if descendants else by_id[id].height + 45
    def place(id: str, x: float, center_y: float, side: int, seen: frozenset[str] = frozenset()):
        if id in seen:
            return
        node = by_id[id]
        positions[id] = (x, center_y - node.height / 2)
        cursor = center_y - sum(height(child) for child in children[id]) / 2
        for child in children[id]:
            child_node = by_id[child]
            band = height(child)
            child_x = x + node.width + 120 if side > 0 else x - child_node.width - 120
            place(child, child_x, cursor + band / 2, side, seen | {id})
            cursor += band
    branches = children[root.id]
    for side, ids in ((1, branches[::2]), (-1, branches[1::2])):
        cursor = root.y + root.height / 2 - sum(height(id) for id in ids) / 2
        for id in ids:
            band = height(id)
            x = root.x + root.width + 120 if side > 0 else root.x - by_id[id].width - 120
            place(id, x, cursor + band / 2, side)
            cursor += band
    reachable = {root.id}
    pending = [root.id]
    for parent in pending:
        for child in children[parent]:
            if child not in reachable:
                reachable.add(child); pending.append(child)
    separate_x = max(positions[id][0] + by_id[id].width for id in reachable) + 180
    cursor_y = root.y + root.height + 240
    loose_roots = [node.id for node in request.nodes if node.id not in reachable and node.id not in attached]
    for id in loose_roots + [node.id for node in request.nodes if node.id not in reachable and node.id in attached]:
        if id in reachable:
            continue
        band = height(id)
        place(id, separate_x, cursor_y + band / 2, 1)
        cursor_y += band + 80
        pending = [id]
        for parent in pending:
            for child in children[parent]:
                if child not in reachable:
                    reachable.add(child); pending.append(child)
    return positions


def hierarchy_tree(request: LayoutRequest) -> dict[str, tuple[float, float]]:
    """Lay out parent-child forests top down; keep the main root in place."""
    by_id = {node.id: node for node in request.nodes}
    positions = {node.id: (node.x, node.y) for node in request.nodes}
    if not by_id:
        return positions
    children: dict[str, list[str]] = {id: [] for id in by_id}
    parents: dict[str, str] = {}
    for edge in request.edges:
        if edge.relation == 'parent_child' and edge.sourceId in by_id and edge.targetId in by_id and edge.targetId not in parents and edge.sourceId != edge.targetId:
            children[edge.sourceId].append(edge.targetId)
            parents[edge.targetId] = edge.sourceId
    roots = [node.id for node in request.nodes if node.id not in parents]
    roots += [node.id for node in request.nodes if node.id in parents]  # Corrupt input still gets a bounded layout.
    def descendants(id: str, seen: frozenset[str] = frozenset()) -> int:
        if id in seen:
            return 0
        return 1 + sum(descendants(child, seen | {id}) for child in children[id])
    roots.sort(key=lambda id: -descendants(id))
    widths: dict[str, float] = {}
    def width(id: str, seen: frozenset[str] = frozenset()) -> float:
        if id in seen:
            return by_id[id].width
        if id not in widths:
            widths[id] = max(by_id[id].width, sum(width(child, seen | {id}) for child in children[id]) + max(0, len(children[id]) - 1) * 56)
        return widths[id]
    visited: set[str] = set()
    main = roots[0]
    origin_x = by_id[main].x + by_id[main].width / 2 - width(main) / 2
    next_x = origin_x
    def place_tree(root: str, left: float, top: float):
        levels: dict[int, float] = {}
        def inspect(id: str, depth: int, seen: frozenset[str] = frozenset()):
            if id in seen or id in visited:
                return
            levels[depth] = max(levels.get(depth, 0), by_id[id].height)
            for child in children[id]:
                inspect(child, depth + 1, seen | {id})
        inspect(root, 0)
        ys = {0: top}
        for depth in range(1, len(levels)):
            ys[depth] = ys[depth - 1] + levels[depth - 1] + 100
        def place(id: str, band_left: float, depth: int):
            if id in visited:
                return
            visited.add(id)
            node = by_id[id]
            positions[id] = (band_left + (width(id) - node.width) / 2, ys[depth])
            cursor = band_left + (width(id) - sum(width(child) for child in children[id]) - max(0, len(children[id]) - 1) * 56) / 2
            for child in children[id]:
                if child not in visited:
                    place(child, cursor, depth + 1)
                cursor += width(child) + 56
        place(root, left, 0)
    place_tree(main, origin_x, by_id[main].y)
    next_x = max(positions[id][0] + by_id[id].width for id in visited) + 180
    for root in roots[1:]:
        if root in visited:
            continue
        place_tree(root, next_x, by_id[main].y)
        next_x = max(positions[id][0] + by_id[id].width for id in visited) + 180
    return positions


def flowchart_layout(request: LayoutRequest) -> dict[str, tuple[float, float]]:
    by_id = {node.id: node for node in request.nodes}
    links = [edge for edge in request.edges if edge.relation == 'sequence' and edge.sourceId in by_id and edge.targetId in by_id]
    outgoing: dict[str, list[str]] = {id: [] for id in by_id}
    indegree = {id: 0 for id in by_id}
    for edge in links:
        outgoing[edge.sourceId].append(edge.targetId)
        indegree[edge.targetId] += 1
    roots = [node.id for node in request.nodes if node.role == 'start']
    roots += [node.id for node in request.nodes if indegree[node.id] == 0 and node.id not in roots]
    roots += [node.id for node in request.nodes if node.id not in roots]
    depth: dict[str, int] = {}
    for root in roots:
        if root in depth:
            continue
        depth[root] = max(depth.values(), default=-1) + 1 if depth else 0
        pending = [root]
        for source in pending:
            for target in outgoing[source]:
                if target not in depth:
                    depth[target] = depth[source] + 1
                    pending.append(target)
    levels: dict[int, list[LayoutNode]] = {}
    for node in request.nodes:
        levels.setdefault(depth[node.id], []).append(node)
    positions: dict[str, tuple[float, float]] = {}
    y = 100.0
    for level in sorted(levels):
        row = levels[level]
        width = sum(node.width for node in row) + max(0, len(row)-1)*100
        x = max(80.0, 500.0-width/2)
        for node in row:
            positions[node.id] = (x, y)
            x += node.width + 100
        y += max(node.height for node in row) + 120
    return positions


def candidates(request: LayoutRequest) -> dict[str, dict[str, tuple[float, float]]]:
    nodes = request.nodes
    current = {node.id: (node.x, node.y) for node in nodes}
    if any(item.intentType for item in request.containers):
        by_id = {node.id: node for node in nodes}
        scoped = dict(current)
        for scope in scopes(nodes, request.edges, request.containers, request.diagram_context):
            members = [by_id[id] for id in scope['nodes']]
            if len(members) < 2 or not scope['type']:
                continue
            sub = LayoutRequest(nodes=members, edges=scope['edges'], diagram_context={'type':scope['type'],'rootId':scope['rootId']})
            options = candidates(sub)
            if scope['type'] in ('mindmap','hierarchy'):
                choice = 'tree'
            elif scope['type'] == 'flowchart':
                choice = 'flow'
            elif scope['type'] == 'brainstorming':
                choice = 'grid' if measure(sub,options['grid'])['overlaps'] < measure(sub,options['current'])['overlaps'] else 'current'
            else:
                choice = min(options, key=lambda name: measure(sub, options[name])['score'])
            proposed = options[choice]
            dx = min(node.x for node in members) - min(point[0] for point in proposed.values())
            dy = min(node.y for node in members) - min(point[1] for point in proposed.values())
            for id, (x,y) in proposed.items():
                scoped[id] = (x+dx,y+dy)
        return {'current': current, 'scoped': scoped}
    if request.diagram_context.get('type') == 'mindmap':
        return {'current': current, 'tree': mindmap_tree(request)}
    if request.diagram_context.get('type') == 'hierarchy':
        return {'current': current, 'tree': hierarchy_tree(request)}
    if request.diagram_context.get('type') == 'flowchart':
        return {'current': current, 'flow': flowchart_layout(request)}
    if request.containers:
        by_container = {item.id: item for item in request.containers}
        by_node = {item.id: item for item in nodes}
        def members(item: LayoutContainer, seen: frozenset[str] = frozenset()) -> set[str]:
            if item.id in seen:
                return set()
            result = set(item.nodeIds) & by_node.keys()
            for child in request.containers:
                if child.parentId == item.id:
                    result |= members(child, seen | {item.id})
            return result
        roots = [item for item in request.containers if not item.parentId or item.parentId not in by_container]
        owner: dict[str, str] = {}
        virtual: list[LayoutNode] = []
        for item in roots:
            ids = members(item)
            if not ids:
                continue
            def depth(container: LayoutContainer, seen: frozenset[str] = frozenset()) -> int:
                children = [child for child in request.containers if child.parentId == container.id and child.id not in seen]
                return 1 + max((depth(child, seen | {container.id}) for child in children), default=0)
            padding = depth(item)
            left = min(by_node[id].x for id in ids) - 40 * padding
            top = min(by_node[id].y for id in ids) - 58 * padding
            right = max(by_node[id].x + by_node[id].width for id in ids) + 40 * padding
            bottom = max(by_node[id].y + by_node[id].height for id in ids) + 40 * padding
            virtual.append(LayoutNode(id=f'container:{item.id}', label=item.name or 'Container', x=left, y=top,
                                      width=max(220, right-left), height=max(76, bottom-top)))
            for id in ids:
                owner[id] = virtual[-1].id
        virtual.extend(item for item in nodes if item.id not in owner)
        for item in nodes:
            owner.setdefault(item.id, item.id)
        links = [LayoutEdge(id=edge.id, sourceId=owner[edge.sourceId], targetId=owner[edge.targetId], relation=edge.relation)
                 for edge in request.edges if edge.sourceId in owner and edge.targetId in owner
                 and owner[edge.sourceId] != owner[edge.targetId]]
        virtual_options = candidates(LayoutRequest(nodes=virtual, edges=links))
        origins = {item.id: (item.x, item.y) for item in virtual}
        return {'current': current, **{name: {node.id: (node.x + options[owner[node.id]][0] - origins[owner[node.id]][0],
                                                   node.y + options[owner[node.id]][1] - origins[owner[node.id]][1])
                                    for node in nodes} for name, options in virtual_options.items() if name != 'current'}}
    by_id = {node.id: node for node in nodes}
    valid = [edge for edge in request.edges if edge.sourceId in by_id and edge.targetId in by_id and edge.sourceId != edge.targetId and edge.relation in (None, 'connection')]
    neighbors = {node.id: set() for node in nodes}
    for edge in valid:
        neighbors[edge.sourceId].add(edge.targetId)
        neighbors[edge.targetId].add(edge.sourceId)
    components: list[set[str]] = []
    unseen = set(by_id)
    for node in nodes:
        if node.id not in unseen:
            continue
        component = {node.id}
        unseen.remove(node.id)
        pending = [node.id]
        for id in pending:
            for other in neighbors[id] & unseen:
                unseen.remove(other)
                component.add(other)
                pending.append(other)
        components.append(component)
    components.sort(key=lambda component: (-len(component), min(i for i, node in enumerate(nodes) if node.id in component)))
    layered: dict[str, tuple[float, float]] = {}
    y_offset = 100.0
    isolated: list[LayoutNode] = []
    for component in components:
        if len(component) == 1 and not neighbors[next(iter(component))]:
            isolated.append(by_id[next(iter(component))])
            continue
        members = [node for node in nodes if node.id in component]
        links = [edge for edge in valid if edge.sourceId in component and edge.targetId in component]
        indegree = {id: 0 for id in component}
        outgoing = {id: [] for id in component}
        for edge in links:
            outgoing[edge.sourceId].append(edge.targetId)
            indegree[edge.targetId] += 1
        ready = [node.id for node in members if indegree[node.id] == 0]
        layers = {id: 0 for id in ready}
        for id in ready:
            for target in outgoing[id]:
                layers[target] = max(layers.get(target, 0), layers[id] + 1)
                indegree[target] -= 1
                if indegree[target] == 0:
                    ready.append(target)
        cycle_layer = max(layers.values(), default=-1) + 1
        for node in members:
            layers.setdefault(node.id, cycle_layer)
        columns: dict[int, list[LayoutNode]] = {}
        for node in members:
            columns.setdefault(layers[node.id], []).append(node)
        x_by_layer: dict[int, float] = {}
        x = 80.0
        for layer in sorted(columns):
            x_by_layer[layer] = x
            x += max(node.width for node in columns[layer]) + 140
        local_y: dict[str, float] = {}
        for layer in sorted(columns):
            def desired(node: LayoutNode) -> float:
                parents = [by_id[edge.sourceId] for edge in links if edge.targetId == node.id and edge.sourceId in local_y]
                if parents:
                    return sum(local_y[parent.id] + parent.height / 2 for parent in parents) / len(parents) - node.height / 2
                return 0.0
            ordered = sorted(columns[layer], key=lambda node: (desired(node), node.y))
            bottom = -65.0
            for node in ordered:
                local_y[node.id] = max(0.0, desired(node), bottom + 65)
                bottom = local_y[node.id] + node.height
        for node in members:
            layered[node.id] = (x_by_layer[layers[node.id]], y_offset + local_y[node.id])
        y_offset += max(local_y[node.id] + node.height for node in members) + 150
    # Keep unconnected blocks beside the connected diagram so they do not
    # stretch its height or look like an extra stage in the flow.
    if isolated:
        col_width = max(node.width for node in isolated) + 90
        row_height = max(node.height for node in isolated) + 65
        connected_height = max((layered[id][1] + by_id[id].height - 100 for id in layered), default=0)
        rows = max(1, math.floor((connected_height + 65) / row_height))
        start_x = max((layered[id][0] + by_id[id].width for id in layered), default=-60) + 140
        for index, node in enumerate(isolated):
            layered[node.id] = (start_x + index // rows * col_width, 100.0 + index % rows * row_height)
    # A compact grid is useful for diagrams with few or no directed connections.
    grid: dict[str, tuple[float, float]] = {}
    cols = max(1, math.ceil(math.sqrt(len(nodes))))
    col_width = max((node.width for node in nodes), default=180) + 90
    row_height = max((node.height for node in nodes), default=100) + 80
    for index, node in enumerate(sorted(nodes, key=lambda item: (item.y, item.x))):
        grid[node.id] = (80.0 + index % cols * col_width, 100.0 + index // cols * row_height)
    return {"current": current, "layered": layered, "grid": grid}


def measure(request: LayoutRequest, positions: dict[str, tuple[float, float]]) -> dict[str, Any]:
    nodes = request.nodes
    by_id = {node.id: node for node in nodes}
    overlaps = 0
    for i, first in enumerate(nodes):
        ax, ay = positions[first.id]
        for second in nodes[i + 1:]:
            bx, by = positions[second.id]
            if ax < bx + second.width + 20 and bx < ax + first.width + 20 and ay < by + second.height + 20 and by < ay + first.height + 20:
                overlaps += 1
    if request.containers:
        by_container = {item.id: item for item in request.containers}
        def members(item: LayoutContainer, seen: frozenset[str] = frozenset()) -> set[str]:
            if item.id in seen:
                return set()
            ids = set(item.nodeIds) & by_id.keys()
            for child in request.containers:
                if child.parentId == item.id:
                    ids |= members(child, seen | {item.id})
            return ids
        roots = [item for item in request.containers if not item.parentId or item.parentId not in by_container]
        participants: list[tuple[float, float, float, float]] = []
        owned: set[str] = set()
        for item in roots:
            ids = members(item)
            if not ids:
                continue
            owned |= ids
            left = min(positions[id][0] for id in ids) - 40
            top = min(positions[id][1] for id in ids) - 58
            right = max(positions[id][0] + by_id[id].width for id in ids) + 40
            bottom = max(positions[id][1] + by_id[id].height for id in ids) + 40
            participants.append((left, top, right, bottom))
        participants.extend((positions[node.id][0], positions[node.id][1], positions[node.id][0] + node.width, positions[node.id][1] + node.height)
                            for node in nodes if node.id not in owned)
        for index, (ax, ay, ar, ab) in enumerate(participants):
            for bx, by, br, bb in participants[index + 1:]:
                if ax < br + 20 and bx < ar + 20 and ay < bb + 20 and by < ab + 20:
                    overlaps += 1
    valid = [edge for edge in request.edges if edge.sourceId in by_id and edge.targetId in by_id and edge.sourceId != edge.targetId]
    def center(id: str) -> tuple[float, float]:
        node = by_id[id]
        x, y = positions[id]
        return x + node.width / 2, y + node.height / 2
    def crosses(a: LayoutEdge, b: LayoutEdge) -> bool:
        if len({a.sourceId, a.targetId, b.sourceId, b.targetId}) < 4:
            return False
        p, q, r, s = center(a.sourceId), center(a.targetId), center(b.sourceId), center(b.targetId)
        def orient(v, w, z):
            return (w[0] - v[0]) * (z[1] - v[1]) - (w[1] - v[1]) * (z[0] - v[0])
        return orient(p, q, r) * orient(p, q, s) < 0 and orient(r, s, p) * orient(r, s, q) < 0
    crossings = sum(crosses(a, b) for i, a in enumerate(valid) for b in valid[i + 1:])
    def intersects_block(edge: LayoutEdge, block: LayoutNode) -> bool:
        if block.id in (edge.sourceId, edge.targetId):
            return False
        x1, y1 = center(edge.sourceId)
        x2, y2 = center(edge.targetId)
        bx, by = positions[block.id]
        dx, dy = x2 - x1, y2 - y1
        near, far = 0.0, 1.0
        for p, q in ((-dx, x1 - bx), (dx, bx + block.width - x1),
                     (-dy, y1 - by), (dy, by + block.height - y1)):
            if abs(p) < 1e-9:
                if q < 0:
                    return False
            else:
                t = q / p
                if p < 0:
                    near = max(near, t)
                else:
                    far = min(far, t)
                if near > far:
                    return False
        return True
    obstructions = sum(intersects_block(edge, block) for edge in valid for block in nodes)
    length = sum(math.dist(center(edge.sourceId), center(edge.targetId)) for edge in valid)
    backward = 0 if request.diagram_context.get('type') in ('mindmap', 'hierarchy') else sum(center(edge.sourceId)[0] > center(edge.targetId)[0] + 20 for edge in valid if edge.relation in (None, 'connection'))
    if request.diagram_context.get('type') == 'hierarchy':
        backward = sum(center(edge.sourceId)[1] >= center(edge.targetId)[1] - 20 for edge in valid if edge.relation == 'parent_child')
    xs = [positions[node.id][0] for node in nodes]
    ys = [positions[node.id][1] for node in nodes]
    spread = ((max(xs) - min(xs)) + (max(ys) - min(ys))) if nodes else 0
    # Weights express visual priorities; a collision costs much more than moving a node.
    score = round(overlaps * 1000 + obstructions * 700 + crossings * 450 + backward * 180 + length * .12 + spread * .05, 1)
    return {"score": score, "overlaps": overlaps, "obstructions": obstructions, "crossings": crossings,
            "backward_edges": backward, "edge_length": round(length), "spread": round(spread)}


def result(request: LayoutRequest, mode: str, tools: list[str], preferred: str | None = None) -> dict[str, Any]:
    options = candidates(request)
    scores = {name: measure(request, positions) for name, positions in options.items()}
    if 'scoped' in options:
        changed = any(math.dist(options['current'][id],options['scoped'][id]) > 1 for id in options['current'])
        return {'mode': mode, 'tools_used': tools, 'selected': 'scoped' if changed else 'current', 'scores': scores,
                'positions': {id:{'x':x,'y':y} for id,(x,y) in options['scoped'].items()} if changed else None,
                'summary': 'Each container uses its own diagram layout rules; boundaries follow their members.' if changed else 'Each container already follows its diagram layout rules.'}
    if request.diagram_context.get('type') == 'mindmap':
        changed = any(math.dist(options['current'][id], options['tree'][id]) > 1 for id in options['current'])
        selected = 'tree' if changed and scores['tree']['score'] < scores['current']['score'] - 1 else 'current'
        return {'mode': mode, 'tools_used': tools, 'selected': selected, 'scores': scores,
                'positions': {id: {'x': x, 'y': y} for id, (x, y) in options['tree'].items()} if selected == 'tree' else None,
                'summary': 'Balanced branches on both sides of the central topic.' if selected == 'tree' else 'The current placement scores as well as the balanced tree.'}
    if request.diagram_context.get('type') == 'hierarchy':
        changed = any(math.dist(options['current'][id], options['tree'][id]) > 1 for id in options['current'])
        selected = 'tree' if changed else 'current'
        return {'mode': mode, 'tools_used': tools, 'selected': selected, 'scores': scores,
                'positions': {id: {'x': x, 'y': y} for id, (x, y) in options['tree'].items()} if selected == 'tree' else None,
                'summary': 'Top-down hierarchy with separate areas for unattached nodes.' if selected == 'tree' else 'The hierarchy already follows the top-down tree placement.'}
    if request.diagram_context.get('type') == 'brainstorming':
        grid = options['grid']
        changed = any(math.dist(options['current'][id], grid[id]) > 1 for id in options['current'])
        selected = 'grid' if changed and scores['current']['overlaps'] > 0 and scores['grid']['overlaps'] < scores['current']['overlaps'] else 'current'
        return {'mode': mode, 'tools_used': tools, 'selected': selected, 'scores': scores,
                'positions': {id: {'x': x, 'y': y} for id, (x, y) in grid.items()} if selected == 'grid' else None,
                'summary': 'A grid would separate overlapping notes; existing groups remain intact.' if selected == 'grid' else 'Notes can stay where you placed them; no overlaps need correction.'}
    if request.diagram_context.get('type') == 'flowchart':
        changed = any(math.dist(options['current'][id], options['flow'][id]) > 1 for id in options['current'])
        selected = 'flow' if changed else 'current'
        return {'mode': mode, 'tools_used': tools, 'selected': selected, 'scores': scores,
                'positions': {id: {'x': x, 'y': y} for id, (x, y) in options['flow'].items()} if selected == 'flow' else None,
                'summary': 'Ordered steps run top to bottom; loop arrows keep their direction.' if selected == 'flow' else 'The current step layout already follows the flow.'}
    current = scores["current"]["score"]
    ranked = sorted((name for name in ("layered", "grid")), key=lambda name: scores[name]["score"])
    best = ranked[0]
    selected = preferred if preferred in ranked and scores[preferred]["score"] <= scores[best]["score"] * 1.1 else best
    improvement = current - scores[selected]["score"]
    # Ignore tiny differences and identical coordinates; otherwise preview the actual positions.
    changed = any(math.dist(options["current"][id], options[selected][id]) > 1 for id in options["current"])
    if not changed or improvement < max(25, current * .05):
        selected = "current"
    report = scores[selected]
    return {"mode": mode, "tools_used": tools, "selected": selected,
            "scores": scores,
            "positions": {id: {"x": x, "y": y} for id, (x, y) in options[selected].items()} if selected != "current" else None,
            "summary": (f"{selected.capitalize()} layout reduces the layout score by {round(current - report['score'])}; "
                        f"{report['overlaps']} overlaps, {report['obstructions']} blocked connections, "
                        f"and {report['crossings']} edge crossings remain."
                        if selected != "current" else "The current layout scores as well as the available alternatives.")}


async def run_layout_critique(request: LayoutRequest, client: httpx.AsyncClient | None = None,
                              choose: Callable[[list[dict[str, str]]], Awaitable[dict[str, Any]]] | None = None) -> dict[str, Any]:
    if any(item.intentType for item in request.containers):
        return result(request, 'rules', ['compare_scoped_layouts'])
    if request.diagram_context.get('type') in ('mindmap', 'hierarchy', 'brainstorming', 'flowchart'):
        kind = request.diagram_context.get('type')
        return result(request, 'rules', ['compare_note_spacing' if kind == 'brainstorming' else 'compare_flow_layout' if kind == 'flowchart' else 'compare_tree_layout'])
    if len(request.nodes) < 2:
        return result(request, "rules", [])
    if choose is None and not model_available():
        return result(request, "rules", ["compare_layouts"])
    system = ("You are a layout critic. Return only JSON. Call {\"tool\":\"compare_layouts\"} first. "
              "After seeing measured scores, finish with {\"tool\":\"finish\",\"layout\":\"layered|grid|current\"}. "
              "Prefer fewer overlaps, blocked connections, and crossings, then shorter connections. Saved diagram decisions are context, not verified geometry. The server validates your choice and applies no edit.")
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"nodes": [node.model_dump() for node in request.nodes],
                                                         "edges": [edge.model_dump() for edge in request.edges],
                                                         "containers": [item.model_dump() for item in request.containers],
                                                         "diagram_context": request.diagram_context})}]
    tools: list[str] = []
    owned = client is None and choose is None
    if owned:
        client = httpx.AsyncClient(timeout=25)
    try:
        first = await (choose(messages) if choose else model_decision(messages, client))  # type: ignore[arg-type]
        if first.get("tool") != "compare_layouts":
            raise ValueError("Invalid layout tool")
        tools.append("compare_layouts")
        options = candidates(request)
        measurements = {name: measure(request, positions) for name, positions in options.items()}
        messages.extend([{"role": "assistant", "content": json.dumps(first)},
                         {"role": "user", "content": json.dumps({"tool_result": measurements})}])
        second = await (choose(messages) if choose else model_decision(messages, client))  # type: ignore[arg-type]
        if second.get("tool") != "finish" or second.get("layout") not in options:
            raise ValueError("Invalid layout choice")
        return result(request, "agent", tools, second["layout"])
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return result(request, "rules", ["compare_layouts"])
    finally:
        if owned:
            await client.aclose()  # type: ignore[union-attr]
