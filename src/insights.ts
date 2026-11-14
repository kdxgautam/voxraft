import {effectiveDiagramType,intentScope,type Scene} from './scene';

export type DiagramInsight={key:string;message:string;nodeId:string;edgeIds:string[]};

export function diagramInsight(scene:Pick<Scene,'nodes'|'edges'> & Partial<Pick<Scene,'context'|'containers'>>):DiagramInsight|null{
  const ids=new Set(scene.nodes.map(node=>node.id));
  const labels=new Map(scene.nodes.map(node=>[node.id,node.label]));
  for(const node of scene.nodes){
    if(scene.context&&effectiveDiagramType({context:scene.context,containers:scene.containers},node.id)!=='architecture')continue;
    if(!/\b(?:database|db|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite)\b/i.test(node.label))continue;
    if(scene.edges.some(edge=>(!edge.relation||edge.relation==='connection')&&edge.sourceId===node.id&&/\b(?:replica|backup|standby)\b/i.test(labels.get(edge.targetId)||'')&&(!scene.context||intentScope({context:scene.context,containers:scene.containers},edge.targetId)?.id===intentScope({context:scene.context,containers:scene.containers},node.id)?.id)))continue;
    const edges=scene.edges.filter(edge=>(!edge.relation||edge.relation==='connection')&&edge.targetId===node.id&&ids.has(edge.sourceId)&&(!scene.context||effectiveDiagramType({context:scene.context,containers:scene.containers},edge.sourceId)==='architecture'&&intentScope({context:scene.context,containers:scene.containers},edge.sourceId)?.id===intentScope({context:scene.context,containers:scene.containers},node.id)?.id));
    const sources=[...new Set(edges.map(edge=>edge.sourceId))];
    if(sources.length<3)continue;
    return {
      key:`${node.id}:${sources.sort().join(',')}`,
      message:`${sources.length} components connect to ${node.label}. Consider whether this database needs a replica or failover path.`,
      nodeId:node.id,
      edgeIds:edges.map(edge=>edge.id),
    };
  }
  return null;
}
