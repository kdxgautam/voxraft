import {resizeForShape} from './shapeGeometry';
import {execute,intentScope,SceneError,type DiagramContext,type Edge,type Node,type Relation,type Scene} from './scene';

export type DiagramType=NonNullable<DiagramContext['type']>;
export type ConversionChoices=Record<string,Relation>;

export function convertedRelation(relation:Relation|undefined,target:DiagramType):Relation|undefined{
  const kind=relation||'connection';
  if(target==='mixed')return kind;
  if(kind==='association')return 'association';
  if(target==='architecture'&&kind==='connection')return kind;
  if(target==='flowchart'&&kind==='sequence')return kind;
  if(target==='mindmap'&&(kind==='branch'||kind==='parent_child'))return 'branch';
  if(target==='hierarchy'&&(kind==='parent_child'||kind==='branch'))return 'parent_child';
  return undefined;
}

export function conversionQuestions(scene:Scene,target:DiagramType):Edge[]{
  return scene.edges.filter(edge=>!intentScope(scene,edge.sourceId)&&!intentScope(scene,edge.targetId)&&convertedRelation(edge.relation,target)===undefined);
}

export function conversionOptions(target:DiagramType,edge:Edge):Relation[]{
  const preferred:Relation=target==='architecture'?'connection':target==='mindmap'?'branch':target==='hierarchy'?'parent_child':target==='flowchart'?'sequence':'association';
  return [...new Set([preferred,'association' as const,edge.relation||'connection'])];
}

export function conversionRootChoices(scene:Scene,target:DiagramType):Node[]{
  if(target!=='mindmap'||scene.context.type==='mindmap'&&scene.context.rootId)return [];
  const parented=new Set(scene.edges.filter(edge=>edge.relation==='parent_child'||edge.relation==='branch').map(edge=>edge.targetId));
  const roots=scene.nodes.filter(node=>!intentScope(scene,node.id)&&!parented.has(node.id));
  return roots.length===1?[]:roots.length?roots:scene.nodes.filter(node=>!intentScope(scene,node.id));
}

function inferredRole(node:Node,target:DiagramType):Node['role']{
  if(target==='architecture')return /\b(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite|database)\b/i.test(node.label)?'database':'component';
  if(target==='mindmap'||target==='hierarchy')return 'topic';
  if(target==='brainstorming')return 'note';
  return /^start$/i.test(node.label.trim())?'start':/^(?:end|finish)$/i.test(node.label.trim())?'end':node.label.trim().endsWith('?')?'decision':'process';
}

function inferredShape(role:Node['role'],target:DiagramType,isRoot:boolean):Node['shape']{
  if(target==='architecture'&&role==='database')return 'cylinder';
  if(target==='mindmap'&&isRoot)return 'ellipse';
  if(target==='flowchart'&&role==='decision')return 'diamond';
  if(target==='flowchart'&&(role==='start'||role==='end'))return 'ellipse';
  return 'rectangle';
}

export function convertScene(scene:Scene,target:DiagramType,choices:ConversionChoices={},rootId?:string):Scene{
  if(scene.context.type===target)throw new SceneError(`This diagram is already ${target}.`);
  if(target==='mixed')return execute(scene,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mixed',source:'explicit'}]);
  for(const edge of conversionQuestions(scene,target))if(!choices[edge.id]||!conversionOptions(target,edge).includes(choices[edge.id]))
    throw new SceneError('Choose a meaning for every connection before previewing conversion.');
  const roots=conversionRootChoices(scene,target);
  if(roots.length&&!rootId)throw new SceneError('Choose a central topic before previewing the mind map.');
  if(rootId&&(!scene.nodes.some(node=>node.id===rootId)||intentScope(scene,rootId)))throw new SceneError('Choose a central topic on the canvas.');
  const known=new Set(scene.nodes.map(node=>node.id));
  const root=target==='mindmap'?(rootId||scene.context.rootId||scene.nodes.find(node=>!intentScope(scene,node.id)&&!scene.edges.some(edge=>['branch','parent_child'].includes(edge.relation||'')&&edge.targetId===node.id))?.id):undefined;
  const nodes=scene.nodes.map(node=>{
    if(intentScope(scene,node.id))return {...node};
    const role=node.roleSource==='explicit'?node.role:inferredRole(node,target);
    const desired=inferredShape(role,target,node.id===root);
    const chosen=node.shapeSource==='explicit'||!node.shapeSource&&node.shape!=='rectangle';
    return {...node,...(!chosen&&desired!==node.shape?resizeForShape(node,desired):{}),role,roleSource:node.roleSource==='explicit'?'explicit' as const:'intent' as const,
      shapeSource:chosen?node.shapeSource:'intent' as const};
  });
  const edges=scene.edges.map(edge=>{
    if(intentScope(scene,edge.sourceId)||intentScope(scene,edge.targetId))return {...edge};
    const relation=convertedRelation(edge.relation,target)||choices[edge.id];
    const manualArrow=edge.arrowheadSource==='explicit'||edge.arrowheadSource==='manual';
    return {...edge,relation,relationSource:relation===edge.relation?edge.relationSource:'explicit' as const,
      endArrowhead:manualArrow?edge.endArrowhead:relation==='connection'||relation==='sequence'?'arrow' as const:null,
      arrowheadSource:manualArrow?edge.arrowheadSource:'intent' as const};
  });
  const parents=edges.filter(edge=>edge.relation==='branch'||edge.relation==='parent_child');
  const parentOf=new Map<string,string>();
  const rootIds=new Set([root,...(scene.containers||[]).map(container=>container.rootId)]);
  for(const edge of parents){
    if(!known.has(edge.sourceId)||!known.has(edge.targetId)||parentOf.has(edge.targetId)||rootIds.has(edge.targetId))throw new SceneError('The chosen relationships would give a topic more than one parent or parent the root.');
    parentOf.set(edge.targetId,edge.sourceId);
  }
  for(const id of parentOf.keys()){
    const visited=new Set<string>();let cursor:string|undefined=id;
    while(cursor){if(visited.has(cursor))throw new SceneError('The chosen parent relationships would create a cycle.');visited.add(cursor);cursor=parentOf.get(cursor);}
  }
  const {past:unusedPast,future:unusedFuture,...snapshot}=scene;
  void unusedPast;void unusedFuture;
  return {...scene,nodes,edges,context:{type:target,purpose:scene.context.purpose,source:'explicit',rootId:root},
    past:[...scene.past.slice(-49),snapshot],future:[]};
}

export function withConversionPositions(scene:Scene,positions:Record<string,{x:number;y:number}>):Scene{
  return {...scene,nodes:scene.nodes.map(node=>positions[node.id]?{...node,...positions[node.id]}:node)};
}
