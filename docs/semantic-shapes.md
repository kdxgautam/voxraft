# Meaningful shapes in Voxraft

Status: stages 1–3 implemented. Rectangle, ellipse, diamond, and a composite database cylinder work in the canvas and previews. On request, the Visual Design Agent proposes supported shapes with reasons and a preview. Actors, queues, and clouds are not implemented.

## Shape policy

Choose shapes to communicate the diagram's meaning. Keep the same meaning consistent within a diagram, and honor explicit user choices. A generic architecture component should remain a rectangle when evidence does not support a more specific symbol.

| Meaning | Proposed symbol | Evidence needed |
| --- | --- | --- |
| Service, API, worker, application, processing step | Rectangle or rounded rectangle | Component or process label; this is the default. |
| Decision or condition | Diamond | Explicit condition such as “Payment approved?” or a user request for a decision. Yes/no branches support the interpretation. Multiple outgoing connections alone are insufficient. |
| Start/end of a workflow | Ellipse or terminator | Explicit start/end role in a workflow. Do not infer this just because a component has no incoming/outgoing edges. |
| Persistent database | Cylinder | Explicit database identity, such as PostgreSQL or MongoDB. A replica can use the same cylinder with its replica label. |
| Cache | Component rectangle with a cache label initially | Redis alone does not establish whether it is used as a cache, database, or broker. Ask when its role matters. |
| Queue or event stream | Queue symbol with a label, added later | Explicit queue/stream role. A Kafka label does not establish how each connection is used. |
| Human actor | Person symbol, added later | Explicit human actor such as Customer or Administrator; distinguish it from a client application. |
| External network or provider | Cloud symbol, added later | Explicit external-system role; a component being deployed in a cloud is not sufficient. |
| Deployment/group/security boundary | Existing labeled container | User-defined membership and boundary meaning. A boundary is not a node or decision. |

These are a small notation for Voxraft, not a claim of formal UML, BPMN, or C4 compliance. A future notation choice would need its own consistent conventions.

## User control

- Explicit instructions such as “Make Payment approved a diamond” change that existing node directly and remain undoable.
- A request such as “Suggest meaningful shapes” opens a proposal from the existing Design Agent with the current shape, proposed shape, and a short reason for each affected node.
- The user applies or discards the proposal by voice, text, or button. A generic styling request should preserve explicitly chosen shapes unless the user requests their reconsideration.
- “Reconsider my shape choices” explicitly permits a proposal to change a previously chosen shape; it still requires Apply.
- Ordinary node creation continues to use a neutral component shape unless the user explicitly requests a shape or a semantic construct such as a decision.
- If “Auth” could mean an authentication service or an authentication decision, ask before assigning a semantic role. Explicit shape requests do not need that extra question.

## Implementation order

1. **Implemented:** render native ellipse/diamond in previews; fit labels inside their narrower interiors; size new and converted shapes appropriately; make arrows meet their visible outlines. Bounding boxes remain conservative routing obstacles.
2. **Implemented:** extend the existing Design Agent with optional shape proposals and reasons. Supply current shapes and user-choice provenance, and use the existing apply/discard and undo workflow. Keep semantic role separate from visual shape: a user choosing a diamond does not by itself turn a service into a decision.
3. **Implemented:** add a cylinder as the first additional architecture symbol. Excalidraw renders a grouped body and two caps, while the scene keeps one canonical node ID. Selection, drag, resize, color changes, labels, and arrow bindings map back to that node. Missing decorative caps regenerate from the canonical node.
4. Add actors, queues, and clouds only after composite symbols work reliably across direct canvas edits, nested containers, collapse/expand, previews, save/import, and Excalidraw export.

## Correctness requirements

- Changing shape preserves node ID, label, connections, membership, and unrelated scene elements. Any necessary size adjustment appears in the preview.
- Arrow endpoints meet the actual shape outline, including oblique connections to diamonds and ellipses. Bounding boxes may remain conservative routing obstacles.
- Each compound symbol remains one logical component; its decorative pieces never become extra nodes during canvas synchronization.
- A collapsed container substitutes a boundary endpoint without losing the hidden nodes' original shapes.
- Reject stale proposals, validate all shape values, and commit an accepted proposal as one undoable edit.

## Example acceptance scenario

Build `Customer → Checkout Service → Payment approved?`, with approved/rejected branches and a PostgreSQL dependency. Request meaningful shapes, then inspect the proposal: service rectangle, decision diamond, and database cylinder. An actor symbol remains planned. Applying it must retain every connection and container membership. Undo must restore the original shapes, and saving/importing must preserve the result.
