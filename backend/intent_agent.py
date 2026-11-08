"""Bounded, read-only diagram intent inference used before the first edit."""
import re
from typing import Any

import httpx

from review_agent import model_available, model_decision


def explicit_start(text: str) -> tuple[str, str, list[dict[str, Any]]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?mixed\s+(?:canvas|diagram)(?:\s+(?:for|of|about)\s+(.+))?', value, re.I)
    if match:
        return 'mixed', (match[1] or '').strip(), []
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?mind\s*map\s+(?:about|for|of)\s+(.+)', value, re.I)
    if match:
        topic = match[1].strip()
        return 'mindmap', topic, [{'type': 'ADD_NODE', 'label': topic}]
    if re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?mind\s*map', value, re.I):
        return 'mindmap', '', []
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:system\s+)?architecture\s+(?:for|of|about)\s+(.+)', value, re.I)
    if match:
        return 'architecture', match[1].strip(), []
    if re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:system\s+)?architecture', value, re.I):
        return 'architecture', '', []
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:hierarchy|org(?:anization)?\s+chart)\s+(?:for|of|about)\s+(.+)', value, re.I)
    if match:
        return 'hierarchy', match[1].strip(), []
    if re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:hierarchy|org(?:anization)?\s+chart)', value, re.I):
        return 'hierarchy', '', []
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:brainstorm(?:ing)?(?:\s+(?:board|diagram))?|notes?(?:\s+(?:board|diagram|canvas))?)\s+(?:for|of|about)\s+(.+)', value, re.I)
    if match:
        return 'brainstorming', match[1].strip(), []
    if re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?(?:brainstorm(?:ing)?(?:\s+(?:board|diagram))?|notes?(?:\s+(?:board|diagram|canvas))?)', value, re.I):
        return 'brainstorming', '', []
    match = re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?flow\s*chart\s+(?:for|of|about)\s+(.+)', value, re.I)
    if match:
        return 'flowchart', match[1].strip(), []
    if re.fullmatch(r'(?:create|make|start|draw)\s+(?:a\s+)?flow\s*chart', value, re.I):
        return 'flowchart', '', []
    return None


def evidence(text: str) -> tuple[str | None, str]:
    requested = explicit_start(text)
    if requested:
        return requested[0], 'The command explicitly requests this diagram type.'
    value = text.casefold()
    if re.search(r'\bmixed\s+(?:canvas|diagram|types?)\b|\bmultiple\s+diagram\s+types?\b', value):
        return 'mixed', 'The command asks to combine diagram types on one canvas.'
    signals = [
        ('hierarchy', r'\b(?:hierarchy|org(?:anization)?\s+chart|report(?:s|ing)?\s+to|department|team\s+under)\b', 'The command describes an organizational or parent–child hierarchy.'),
        ('brainstorming', r'\b(?:brainstorm(?:ing)?|notes?\s+(?:board|canvas|diagram)|idea\s+board)\b', 'The command describes a free-form idea board.'),
        ('flowchart', r'\b(?:flow\s*chart|workflow|if\s+.+\s+otherwise|decision\s+step)\b', 'The command describes ordered steps and decisions.'),
        ('mindmap', r'\b(?:mind\s*map|subtopics?|branch(?:es)?|ideas?\s+under|topics?\s+under)\b', 'The command describes topics and branches.'),
        ('architecture', r'\b(?:system\s+architecture|server|service|backend|frontend|client|gateway|api)\b', 'The command describes system components.'),
    ]
    matched = [(kind, reason) for kind, pattern, reason in signals if re.search(pattern, value)]
    if len(matched) > 1 and not re.search(r'\barchitecture\b', value):
        # A component name can also be a topic in a mind map or another diagram.
        matched = [(kind, reason) for kind, reason in matched if kind != 'architecture'] or matched
    if len(matched) > 1:
        return 'mixed', 'The command describes more than one diagram type.'
    if matched:
        return matched[0]
    return None, 'The command does not establish a diagram type.'


async def suggest(text: str, nodes: list[dict[str, Any]], client: httpx.AsyncClient | None = None,
                  recent_command: str | None = None, existing_types: list[str] | None = None) -> dict[str, Any]:
    kind, reason = evidence(text)
    scoped = {item for item in existing_types or [] if item not in ('mixed', None)}
    if kind is None and recent_command:
        kind, _ = evidence(recent_command)
        if kind:
            reason = {'architecture': 'A recent command described system components.', 'mindmap': 'A recent command described topics and branches.', 'hierarchy': 'A recent command described a hierarchy.', 'brainstorming': 'A recent command described an idea board.', 'flowchart': 'A recent command described a workflow.', 'mixed': 'A recent command combined diagram types.'}[kind]
    if kind is None and nodes:
        kind, _ = evidence(' '.join(str(node.get('label', ''))[:120] for node in nodes[:40]))
        if kind:
            reason = 'Existing canvas labels support this diagram type.'
    if len(scoped) > 1 or kind and scoped and kind not in scoped and kind != 'mixed':
        kind, reason = 'mixed', 'The canvas combines more than one diagram type.'
    if kind or not model_available():
        return {'type': kind, 'reason': reason, 'mode': 'rules'}
    owned = client is None
    if owned:
        client = httpx.AsyncClient(timeout=25)
    try:
        decision = await model_decision([
            {'role': 'system', 'content': 'You are a read-only diagram intent agent. Return JSON {"type":"architecture"|"mindmap"|"hierarchy"|"brainstorming"|"flowchart"|"mixed"|null,"reason":"short evidence"}. Infer Mixed when multiple diagram types are clearly present. Infer only from the user command and existing labels. A database name alone is insufficient. Choose null when ambiguous. Never create diagram content.'},
            {'role': 'user', 'content': str({'command': text, 'recent_command': recent_command, 'existing_labels': [str(node.get('label', ''))[:120] for node in nodes[:40]]})},
        ], client)
        chosen = decision.get('type')
        if chosen not in ('architecture', 'mindmap', 'hierarchy', 'brainstorming', 'flowchart', 'mixed', None):
            raise ValueError('Invalid intent decision')
        if chosen and scoped and chosen not in scoped and chosen != 'mixed':
            return {'type': 'mixed', 'reason': 'The canvas combines more than one diagram type.', 'mode': 'agent'}
        explanation = decision.get('reason')
        if not isinstance(explanation, str) or len(explanation) > 180:
            raise ValueError('Invalid intent reason')
        return {'type': chosen, 'reason': explanation, 'mode': 'agent'}
    finally:
        if owned:
            await client.aclose()  # type: ignore[union-attr]


def mindmap_actions(text: str) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:add|create)\s+(?:a\s+)?(?:topic\s+|idea\s+|branch\s+)?(.+?)\s+(?:under|beneath|as\s+a\s+branch\s+of)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_NODE', 'label': match[1].strip()}, {'type': 'ADD_EDGE', 'source': match[2].strip(), 'target': match[1].strip(), 'relation': 'branch'}]
    match = re.fullmatch(r'(?:move|reparent|put)\s+(.+?)\s+under\s+(.+)', value, re.I)
    if match:
        return [{'type': 'REPARENT_BRANCH', 'target': match[1].strip(), 'parent': match[2].strip()}]
    match = re.fullmatch(r'(?:make|set)\s+(.+?)\s+(?:a\s+)?(?:child|branch|subtopic)\s+of\s+(.+)', value, re.I)
    if match:
        return [{'type': 'REPARENT_BRANCH', 'target': match[1].strip(), 'parent': match[2].strip()}]
    match = re.fullmatch(r'(?:make|set)\s+(.+?)\s+(?:the\s+)?(?:central|main|root)\s+topic', value, re.I)
    if match:
        return [{'type': 'SET_MINDMAP_ROOT', 'target': match[1].strip()}]
    return None


def hierarchy_actions(text: str) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:make|set)\s+(.+?)\s+(?:the\s+)?parent\s+of\s+(.+)', value, re.I)
    if match:
        return [{'type': 'REPARENT_BRANCH', 'target': match[2].strip(), 'parent': match[1].strip()}]
    match = re.fullmatch(r'(?:add|create)\s+(?:a\s+)?(?:node\s+)?(.+?)\s+(?:under|beneath|as\s+a\s+child\s+of)\s+(.+)', value, re.I)
    if match:
        child, parent = (part.strip() for part in match.groups())
        return [{'type': 'ADD_NODE', 'label': child}, {'type': 'ADD_EDGE', 'source': parent, 'target': child, 'relation': 'parent_child', 'relationSource': 'intent'}]
    match = re.fullmatch(r'(?:move|reparent|put|place)\s+(.+?)\s+(?:under|beneath|as\s+a\s+child\s+of)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'REPARENT_BRANCH', 'target': match[1].strip(), 'parent': match[2].strip()}]
    match = re.fullmatch(r'(.+?)\s+reports?\s+to\s+(.+)', value, re.I)
    if match:
        return [{'type': 'REPARENT_BRANCH', 'target': match[1].strip(), 'parent': match[2].strip()}]
    return None


def brainstorming_actions(text: str) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:add|create|jot(?:\s+down)?)\s+(.+?)\s+as\s+an?\s+(?:idea|note)', value, re.I)
    if match:
        return [{'type': 'ADD_NODE', 'label': match[1].strip(), 'role': 'note', 'roleSource': 'explicit'}]
    match = re.fullmatch(r'(?:add|create|jot(?:\s+down)?)\s+an?\s+(?:idea|note)\s+(?:called|named|about)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_NODE', 'label': match[1].strip(), 'role': 'note', 'roleSource': 'explicit'}]
    return None


def flowchart_actions(text: str, nodes: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'if\s+(.+?)\s*,\s*(.+?)\s*;\s*otherwise\s+(.+)', value, re.I)
    if match:
        condition, yes, no = match.groups()
        decision = condition.strip().capitalize().rstrip('?') + '?'
        yes, no = yes.strip().capitalize(), no.strip().capitalize()
        existing = {str(node.get('label', '')).casefold() for node in nodes}
        actions = []
        for label, role in ((decision, 'decision'), (yes, 'process'), (no, 'process')):
            if label.casefold() not in existing:
                actions.append({'type': 'ADD_NODE', 'label': label, 'role': role, 'roleSource': 'intent'})
                existing.add(label.casefold())
        actions.extend([{'type': 'ADD_EDGE', 'source': decision, 'target': yes, 'label': 'Yes', 'relation': 'sequence', 'relationSource': 'intent'},
                        {'type': 'ADD_EDGE', 'source': decision, 'target': no, 'label': 'No', 'relation': 'sequence', 'relationSource': 'intent'}])
        return actions
    match = re.fullmatch(r'(?:connect|link)\s+(.+?)\s+to\s+(.+?)\s+(?:labeled|labelled|with\s+label)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_EDGE', 'source': match[1].strip(), 'target': match[2].strip(), 'label': match[3].strip(), 'relation': 'sequence', 'relationSource': 'intent'}]
    return None


def explicit_role_action(text: str) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:add|create|make)\s+an?\s+(component|database|topic|note|process|decision|start|end)(?:\s+(?:node|block|point))?\s+(?:called|named|about)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_NODE', 'label': match[2].strip(), 'role': match[1].lower(), 'roleSource': 'explicit'}]
    match = re.fullmatch(r'(?:make|mark|set)\s+(.+?)\s+(?:as\s+)?an?\s+(component|database|topic|note|process|decision|start|end)(?:\s+(?:node|block|point))?', value, re.I)
    if match:
        return [{'type': 'UPDATE_NODE', 'target': match[1].strip(), 'role': match[2].lower(), 'roleSource': 'explicit'}]
    return None


def explicit_relation_action(text: str) -> list[dict[str, Any]] | None:
    value = text.strip().rstrip('.!')
    match = re.fullmatch(r'(?:make|set)\s+(.+?)\s+(?:the\s+)?parent\s+of\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_EDGE', 'source': match[1].strip(), 'target': match[2].strip(), 'relation': 'parent_child', 'relationSource': 'explicit'}]
    match = re.fullmatch(r'(?:associate|relate)\s+(.+?)\s+(?:to|with)\s+(.+)', value, re.I)
    if match:
        return [{'type': 'ADD_EDGE', 'source': match[1].strip(), 'target': match[2].strip(), 'relation': 'association', 'relationSource': 'explicit'}]
    match = re.fullmatch(r'(?:connect|link)\s+(.+?)\s+(?:to|with)\s+(.+?)\s+as\s+(?:an?\s+)?(sequence|dependency|association|parent[\s-]child)(?:\s+relationship)?', value, re.I)
    if match:
        relation = {'dependency': 'connection', 'parent child': 'parent_child', 'parent-child': 'parent_child'}.get(match[3].lower(), match[3].lower())
        return [{'type': 'ADD_EDGE', 'source': match[1].strip(), 'target': match[2].strip(), 'relation': relation, 'relationSource': 'explicit'}]
    return None
