import { z } from 'zod';
import {nodeDimensions,resizeForShape} from './shapeGeometry';
import {cylinderCapHeight,cylinderOwner,cylinderPartId,cylinderParts} from './cylinder';

export type NodeRole='component'|'database'|'topic'|'note'|'process'|'decision'|'start'|'end';
export type Relation='connection'|'branch'|'association'|'parent_child'|'sequence';
export type SemanticSource='explicit'|'intent'|'manual'|'legacy';
export const diagramTypes=['architecture','mindmap','hierarchy','brainstorming','flowchart','mixed'] as const;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('SET_DIAGRAM_CONTEXT'),diagramType:z.enum(diagramTypes),purpose:z.string().max(240).optional(),source:z.enum(['explicit','confirmed']).optional()}),
  z.object({type:z.literal('SET_PURPOSE'),purpose:z.string().max(240)}),
  z.object({type:z.literal('REMEMBER_NOTE'),note:z.string().trim().min(1).max(200)}),
  z.object({type:z.literal('FORGET_NOTE'),note:z.string().trim().min(1).max(200)}),
  z.object({type:z.literal('SET_MINDMAP_ROOT'),target:z.string()}),
  z.object({type:z.literal('NEW_DIAGRAM')}),
  z.object({type:z.literal('ADD_NODE'), label:z.string().min(1), shape:z.enum(['rectangle','ellipse','diamond','cylinder']).optional(), shapeSource:z.enum(['explicit','default']).optional(), role:z.enum(['component','database','topic','note','process','decision','start','end']).optional(),roleSource:z.enum(['explicit','intent']).optional(),color:z.string().optional(), id:z.string().optional(),container:z.string().optional()}),
  z.object({type:z.literal('ADD_EDGE'), source:z.string(), target:z.string(), label:z.string().optional(),relation:z.enum(['connection','branch','association','parent_child','sequence']).optional(),relationSource:z.enum(['explicit','intent']).optional(),arrowhead:z.enum(['arrow','none']).optional()}),
  z.object({type:z.literal('REPARENT_BRANCH'),target:z.string(),parent:z.string()}),
  z.object({type:z.literal('DELETE_EDGE'), edge:z.string().optional(), source:z.string().optional(), target:z.string().optional()}),
  z.object({type:z.literal('REVERSE_EDGE'), edge:z.string().optional(), source:z.string().optional(), target:z.string().optional()}),
  z.object({type:z.literal('UPDATE_EDGE'), edge:z.string().optional(), source:z.string().optional(), target:z.string().optional(), label:z.string()}),
  z.object({type:z.literal('CREATE_GROUP'), name:z.string().min(1), targets:z.array(z.string()).min(1)}),
  z.object({type:z.literal('CREATE_CONTAINER'), name:z.string().min(1), targets:z.array(z.string()), childContainers:z.array(z.string()).optional()}),
  z.object({type:z.literal('ADD_TO_CONTAINER'), container:z.string().min(1), targets:z.array(z.string()).min(1)}),
  z.object({type:z.literal('REMOVE_FROM_CONTAINER'), container:z.string().min(1), targets:z.array(z.string()).min(1)}),
  z.object({type:z.literal('MOVE_CONTAINER'), container:z.string().min(1), direction:z.enum(['above','below','left','right']).optional(), x:z.number().finite().optional(), y:z.number().finite().optional()}),
  z.object({type:z.literal('RENAME_CONTAINER'), container:z.string().min(1), name:z.string().min(1)}),
  z.object({type:z.literal('DELETE_CONTAINER'), container:z.string().min(1)}),
  z.object({type:z.literal('NEST_CONTAINER'), container:z.string().min(1), parent:z.string().min(1)}),
  z.object({type:z.literal('UNNEST_CONTAINER'), container:z.string().min(1)}),
  z.object({type:z.literal('SET_CONTAINER_COLLAPSED'), container:z.string().min(1), collapsed:z.boolean()}),
  z.object({type:z.literal('SET_CONTAINER_INTENT'),container:z.string().min(1),diagramType:z.enum(['architecture','mindmap','hierarchy','brainstorming','flowchart']).nullable()}),
  z.object({type:z.literal('SET_CONTAINER_ROOT'),container:z.string().min(1),target:z.string()}),
  z.object({type:z.literal('MOVE_NODE'), target:z.string(), direction:z.enum(['above','below','left','right']).optional(), relativeTo:z.string().optional(), x:z.number().optional(), y:z.number().optional()}),
  z.object({type:z.literal('UPDATE_NODE'), target:z.string(), label:z.string().optional(), color:z.string().optional(), shape:z.enum(['rectangle','ellipse','diamond','cylinder']).optional(),role:z.enum(['component','database','topic','note','process','decision','start','end']).optional(),roleSource:z.enum(['explicit','intent']).optional()}),
  z.object({type:z.literal('DELETE_NODE'), target:z.string()}),
  z.object({type:z.literal('INSERT_BETWEEN'), label:z.string().min(1), source:z.string(), target:z.string(), shape:z.enum(['rectangle','ellipse','diamond','cylinder']).optional(), shapeSource:z.enum(['explicit','default']).optional(), id:z.string().optional()}),
  z.object({type:z.literal('UNDO'),steps:z.number().int().min(1).max(5).optional()}), z.object({type:z.literal('REDO'),steps:z.number().int().min(1).max(5).optional()}), z.object({type:z.literal('CLEAR')}), z.object({type:z.literal('ARRANGE')})
]);
export type Action = z.infer<typeof actionSchema>;
export type DiagramContext={type:typeof diagramTypes[number]|null;purpose:string;source?:'explicit'|'confirmed'|'legacy';rootId?:string;notes?:string[]};
export type Node = {id:string;label:string;shape:'rectangle'|'ellipse'|'diamond'|'cylinder';shapeSource?:'explicit'|'suggested'|'intent';role?:NodeRole;roleSource?:SemanticSource;x:number;y:number;width:number;height:number;color:string;fillColor?:string;fontFamily?:2|3};
export type Edge = {id:string;sourceId:string;targetId:string;label:string;relation?:Relation;relationSource?:SemanticSource;endArrowhead?:'arrow'|null;arrowheadSource?:SemanticSource;color?:string;fontFamily?:2|3};
export type NodeGroup = {name:string;nodeIds:string[]};
export type Container = {id:string;name:string;nodeIds:string[];parentId?:string;collapsed?:boolean;color?:string;intentType?:Exclude<NonNullable<DiagramContext['type']>,'mixed'>;rootId?:string};
export type CanvasExtra = {id:string;type:string;[key:string]:unknown};
export type Snapshot = {nodes:Node[];edges:Edge[];recentIds:string[];context:DiagramContext;recentEdgeId?:string|null;groups?:NodeGroup[];containers?:Container[];extras?:CanvasExtra[]};
export type Scene = Snapshot & {past:Snapshot[];future:Snapshot[]};
export const emptyScene = ():Scene => ({nodes:[],edges:[],recentIds:[],context:{type:null,purpose:''},past:[],future:[]});
export const diagramTypeLocked=(scene:Scene)=>!!scene.context.type&&scene.nodes.length>0;
const copy = (scene:Snapshot):Snapshot => ({nodes:scene.nodes.map(n=>({...n})),edges:scene.edges.map(e=>({...e})),recentIds:[...scene.recentIds],context:{...scene.context,...(scene.context.notes?{notes:[...scene.context.notes]}:{})},recentEdgeId:scene.recentEdgeId,groups:scene.groups?.map(group=>({...group,nodeIds:[...group.nodeIds]})),containers:scene.containers?.map(container=>({...container,nodeIds:[...container.nodeIds]})),extras:scene.extras?.map(e=>({...e}))});
export function clearScene(scene:Scene):Scene {
  if (!scene.nodes.length && !scene.edges.length && !scene.extras?.length) return scene;
  return {nodes:[],edges:[],recentIds:[],context:{...scene.context,rootId:undefined},recentEdgeId:null,groups:[],containers:[],extras:[],past:[...scene.past.slice(-49),copy(scene)],future:[]};
}
export function newId():string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
}
const norm = (s:string) => s.toLowerCase().replace(/\bfront[\s-]?end\b/g,'frontend').replace(/^(the|a|an)\s+/,'').replace(/\s+(node|service|server|block|component)$/,'').trim();
const colorMap:Record<string,string> = {orange:'#f59e0b',blue:'#3b82f6',green:'#10b981',red:'#ef4444',purple:'#8b5cf6',pink:'#ec4899',yellow:'#eab308',gray:'#64748b',grey:'#64748b'};
export const nodeColor = (s?:string) => colorMap[s?.toLowerCase() || ''] || (s?.startsWith('#') ? s : '#6366f1');
export class SceneError extends Error { actions?:Action[];constructor(message:string, public clarification=false, public reference?:string, public candidateIds:string[]=[]){super(message);} }
export function resolveNode(scene:Snapshot, ref:string):Node {
  const value=norm(ref);
  if (/^(this|this one|this node|selected|selected node)$/.test(value))
    throw new SceneError('Select a node, or tell me which node you mean.',true,ref);
  if (/^(that|it|last|that server|that node)$/.test(value)) {
    const found=scene.nodes.find(n=>n.id===scene.recentIds[0]);
    if(found)return found;
    throw new SceneError('Which node do you mean?',true,ref);
  }
  const ordinal=value.match(/^(first|second|third|\d+)(?:\s+)(.+)$/);
  let candidates=scene.nodes.filter(n=>n.id===ref || norm(n.label)===value);
  if(!candidates.length){const phrase=ordinal?.[2] || value;candidates=scene.nodes.filter(n=>norm(n.label).includes(phrase)||phrase.includes(norm(n.label)));}
  if(ordinal){const index={first:0,second:1,third:2}[ordinal[1]] ?? Number(ordinal[1])-1; candidates=candidates.filter(n=>norm(n.label).includes(ordinal[2])); if(candidates[index])return candidates[index];}
  if(candidates.length===1)return candidates[0];
  if(candidates.length>1)throw new SceneError(`Which ${ref} do you mean: ${candidates.map(n=>n.label).join(', ')}?`,true,ref,candidates.map(n=>n.id));
  throw new SceneError(`I couldn't find “${ref}”.`);
}
export function resolveContainer(scene:Snapshot,ref:string):Container{
  const value=ref.trim().replace(/^(?:the|a)\s+/i,'').replace(/\s+container$/i,'').toLowerCase();
  const found=scene.containers?.find(container=>container.id===ref||container.name.toLowerCase()===value);
  if(!found)throw new SceneError(`I couldn't find a container named “${ref}”.`);
  return found;
}
export function descendantNodeIds(scene:Pick<Snapshot,'containers'>,container:Container):string[]{
  const ids=new Set(container.nodeIds);
  for(const child of scene.containers||[])if(child.parentId===container.id)
    for(const id of descendantNodeIds(scene,child))ids.add(id);
  return [...ids];
}
export function intentScope(scene:Pick<Snapshot,'containers'|'context'>,nodeId:string):Container|undefined{
  let current=scene.containers?.find(container=>container.nodeIds.includes(nodeId));
  while(current){
    if(current.intentType)return current;
    current=scene.containers?.find(container=>container.id===current?.parentId);
  }
  return undefined;
}
export function effectiveDiagramType(scene:Pick<Snapshot,'containers'|'context'>,nodeId:string):DiagramContext['type']{
  return intentScope(scene,nodeId)?.intentType||scene.context.type;
}
export function containerBounds(scene:Pick<Snapshot,'nodes'> & Partial<Pick<Snapshot,'containers'>>,container:Container){
  const boxes=scene.nodes.filter(node=>container.nodeIds.includes(node.id)).map(node=>({x:node.x,y:node.y,width:node.width,height:node.height}));
  for(const child of scene.containers||[])if(child.parentId===container.id)boxes.push(containerBounds(scene,child));
  if(!boxes.length)throw new SceneError(`Container “${container.name}” has no blocks or nested containers.`);
  const left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y));
  const right=Math.max(...boxes.map(box=>box.x+box.width)),bottom=Math.max(...boxes.map(box=>box.y+box.height));
  return {x:left-40,y:top-58,width:container.collapsed?Math.max(220,container.name.length*10+32):right-left+80,height:container.collapsed?76:bottom-top+98};
}
export function hiddenNodeIds(scene:Pick<Snapshot,'containers'>):Set<string>{
  const hidden=new Set<string>();
  for(const container of scene.containers||[])if(container.collapsed)
    for(const id of descendantNodeIds(scene,container))hidden.add(id);
  return hidden;
}
export function visibleContainers(scene:Pick<Snapshot,'containers'>):Container[]{
  const all=scene.containers||[];
  const depth=(container:Container)=>{let count=0,parent=all.find(item=>item.id===container.parentId);while(parent){count++;const parentId=parent.parentId;parent=all.find(item=>item.id===parentId);}return count;};
  return all.filter(container=>{let parent=all.find(item=>item.id===container.parentId);while(parent){if(parent.collapsed)return false;const parentId=parent.parentId;parent=all.find(item=>item.id===parentId);}return true;}).sort((a,b)=>depth(a)-depth(b));
}
function pruneEmptyContainers(scene:Snapshot){
  let changed=true;
  while(changed){
    const before=scene.containers?.length||0;
    scene.containers=scene.containers?.filter(container=>container.nodeIds.length||scene.containers?.some(child=>child.parentId===container.id));
    changed=(scene.containers?.length||0)!==before;
  }
}
function assertCanNest(scene:Snapshot,child:Container,parent:Container){
  if(child.id===parent.id)throw new SceneError('A container cannot contain itself.');
  let ancestor:Container|undefined=parent;
  while(ancestor){if(ancestor.id===child.id)throw new SceneError('Nesting would create a container cycle.');ancestor=scene.containers?.find(item=>item.id===ancestor?.parentId);}
}
const selectedWord=(value:string)=>/^(?:the )?(?:this|that|it|this one|that one|this node|that node|selected|selected node)$/i.test(value.trim());
export function bindSelection(input:unknown,selectedId:string|null):Action[]{
  const actions=z.array(actionSchema).min(1).parse(input);
  if(!selectedId)return actions;
  return actions.map(action=>{
    const next={...action};
    if('target' in next&&typeof next.target==='string'&&selectedWord(next.target))next.target=selectedId;
    if('source' in next&&typeof next.source==='string'&&selectedWord(next.source))next.source=selectedId;
    if('parent' in next&&typeof next.parent==='string'&&selectedWord(next.parent))next.parent=selectedId;
    if('relativeTo' in next&&next.relativeTo&&selectedWord(next.relativeTo))next.relativeTo=selectedId;
    return next;
  });
}
export function selectedNodeId(scene:Snapshot,selectedElementIds:Record<string,boolean>):string|null{
  const ids=selectedNodeIds(scene,selectedElementIds);
  return ids.length===1?ids[0]:null;
}
export function selectedNodeIds(scene:Snapshot,selectedElementIds:Record<string,boolean>):string[]{
  return [...new Set(Object.keys(selectedElementIds).filter(id=>selectedElementIds[id]).map(id=>cylinderOwner(scene.nodes,id)||id.replace(/:label$/,'')).filter(id=>scene.nodes.some(node=>node.id===id)))];
}
export function selectedEdgeId(scene:Snapshot,selectedElementIds:Record<string,boolean>):string|null{
  const ids=[...new Set(Object.keys(selectedElementIds).filter(id=>selectedElementIds[id]).map(id=>id.replace(/:label$/,'')).filter(id=>scene.edges.some(edge=>edge.id===id)))];
  return ids.length===1?ids[0]:null;
}
export function clarifyActions(scene:Snapshot,actions:Action[],reference:string,candidateIds:string[],answer:string,selectedId:string|null):Action[]{
  const words=norm(answer).replace(/\s+(one|node)$/,'');
  const ordinal={first:0,second:1,third:2}[words as 'first'|'second'|'third'] ?? (/^[1-9]$/.test(words)?Number(words)-1:-1);
  let node:Node;
  if(ordinal>=0&&candidateIds[ordinal])node=scene.nodes.find(item=>item.id===candidateIds[ordinal])!;
  else if(selectedId&&selectedWord(answer))node=scene.nodes.find(item=>item.id===selectedId) ?? resolveNode(scene,answer);
  else node=resolveNode(scene,answer);
  if(candidateIds.length&&!candidateIds.includes(node.id))throw new SceneError('That node is not one of the choices. Please name one of the listed nodes.',true,reference,candidateIds);
  let replaced=false;
  const result=actions.map(action=>{
    const next={...action} as Record<string,unknown>;
    for(const field of ['source','target','parent','relativeTo'])if(next[field]===reference){next[field]=node.id;replaced=true;}
    return next as Action;
  });
  if(!replaced)throw new SceneError('The pending command could not be resolved. Please try the command again.');
  return result;
}
function position(nodes:Node[], width=220,height=82):{x:number;y:number}{
  for(let row=0;row<20;row++)for(let col=0;col<5;col++){
    const x=80+col*310,y=100+row*160;
    if(nodes.every(n=>x+width+24<n.x||n.x+n.width+24<x||y+height+24<n.y||n.y+n.height+24<y))return {x,y};
  }
  return {x:80,y:100+nodes.length*160};
}
function positionInContainer(draft:Snapshot,container:Container,width:number,height:number):{x:number;y:number}{
  const members=descendantNodeIds(draft,container);
  const nodes=draft.nodes.filter(node=>members.includes(node.id));
  if(!nodes.length)return position(draft.nodes,width,height);
  const x=Math.min(...nodes.map(node=>node.x));
  let y=Math.max(...nodes.map(node=>node.y+node.height))+80;
  while(draft.nodes.some(node=>!(x+width+24<node.x||node.x+node.width+24<x||y+height+24<node.y||node.y+node.height+24<y)))y+=height+40;
  return {x,y};
}
function addNode(draft:Snapshot,label:string,shape?:Node['shape'],color?:string,id?:string,x?:number,y?:number,shapeSource?:'explicit'|'default',role?:NodeRole,roleSource?:'explicit'|'intent',containerRef?:string):Node{
  const container=containerRef?resolveContainer(draft,containerRef):undefined;
  let scope=container;
  while(scope&&!scope.intentType)scope=draft.containers?.find(item=>item.id===scope?.parentId);
  const mode=scope?.intentType||draft.context.type;
  const isRoot=mode==='mindmap'&&!(scope?scope.rootId:draft.context.rootId)&&!(scope?descendantNodeIds(draft,scope).length:draft.nodes.some(node=>!intentScope(draft,node.id)));
  const database=mode==='architecture'&&/\b(?:postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|sqlite|database)\b/i.test(label);
  const flowRole=mode==='flowchart'?(role||(/^start$/i.test(label.trim())?'start':/^(?:end|finish)$/i.test(label.trim())?'end':/\?$/.test(label.trim())?'decision':'process')):undefined;
  const inferred=database?'cylinder':isRoot?'ellipse':flowRole==='decision'?'diamond':flowRole==='start'||flowRole==='end'?'ellipse':'rectangle';
  const chosenShape=shapeSource==='default'?inferred:shape||inferred;
  const {width,height}=nodeDimensions(label,chosenShape);
  const pos=x===undefined||y===undefined?(container?positionInContainer(draft,container,width,height):position(draft.nodes,width,height)):{x,y};
  const provenance=shapeSource==='explicit'||shapeSource===undefined&&shape!==undefined?'explicit':mode?'intent':undefined;
  const chosenRole=role||(mode==='architecture'?(database?'database':'component'):mode==='mindmap'?'topic':mode==='brainstorming'?'note':flowRole);
  const node:Node={id:id||newId(),label,shape:chosenShape,x:pos.x,y:pos.y,width,height,color:nodeColor(color),...(color?{fillColor:nodeColor(color)}:{}),...(provenance?{shapeSource:provenance as Node['shapeSource']}:{}),...(chosenRole?{role:chosenRole,roleSource:role?roleSource||'explicit':'intent' as const}:{})};
  if(draft.nodes.some(n=>n.id===node.id))throw new SceneError(`Duplicate node ID ${node.id}`);
  draft.nodes.push(node);if(container)container.nodeIds.push(node.id);if(isRoot){if(scope)scope.rootId=node.id;else draft.context.rootId=node.id;}draft.recentIds=[node.id,...draft.recentIds.filter(v=>v!==node.id)].slice(0,5);return node;
}
function mindmapPosition(draft:Snapshot,parent:Node,child:Node,rootId:string,ignoreIds:Set<string>=new Set([child.id])){
  const branches=draft.edges.filter(edge=>edge.relation==='branch');
  let anchor=parent.id;
  while(anchor!==rootId){const edge=branches.find(item=>item.targetId===anchor);if(!edge)break;anchor=edge.sourceId;if(anchor===rootId)break;}
  const root=draft.nodes.find(node=>node.id===rootId);
  const rootChildren=branches.filter(edge=>edge.sourceId===root?.id);
  const side=parent.id===root?.id?((rootChildren.length-1)%2===0?1:-1):parent.x>=root!.x?1:-1;
  const x=side>0?parent.x+parent.width+120:parent.x-child.width-120;
  let y=parent.y;
  for(let step=0;step<100;step++,y+=child.height+36){if(draft.nodes.every(node=>ignoreIds.has(node.id)||x+child.width+24<node.x||node.x+node.width+24<x||y+child.height+24<node.y||node.y+node.height+24<y))break;}
  child.x=x;child.y=y;
}
function addEdge(draft:Snapshot,source:Node,target:Node,label='',options:{relation?:Relation;placeNew?:boolean;relationSource?:SemanticSource;arrowhead?:'arrow'|'none';arrowheadSource?:SemanticSource}={}){
  if(source.id===target.id)throw new SceneError('An edge needs two different nodes.');
  const sourceMode=effectiveDiagramType(draft,source.id),targetMode=effectiveDiagramType(draft,target.id);
  const sourceScope=intentScope(draft,source.id),targetScope=intentScope(draft,target.id);
  if(sourceMode!==targetMode&&(!options.relation||options.relationSource!=='explicit'))throw new SceneError('These blocks have different diagram types. Name the relationship explicitly, such as association, dependency, sequence, or parent–child.');
  const kind=options.relation|| (sourceMode==='architecture'?'connection':sourceMode==='hierarchy'?'parent_child':sourceMode==='flowchart'?'sequence':'association');
  const relationSource=options.relationSource||(options.relation?'explicit':'intent');
  const existing=draft.edges.find(e=>e.sourceId===source.id&&e.targetId===target.id);
  if(existing&&(existing.relation===kind||!['branch','parent_child'].includes(kind)&&relationSource!=='explicit'))return;
  if(kind==='branch'||kind==='parent_child'){
    if(kind==='branch'&&(sourceMode!=='mindmap'||targetMode!=='mindmap'||sourceScope?.id!==targetScope?.id))throw new SceneError('Branches must stay within one mind map.');
    const rootId=kind==='branch'?(sourceScope?.rootId||draft.context.rootId):draft.context.rootId;
    if(kind==='branch'&&(!rootId||!draft.nodes.some(node=>node.id===rootId)))throw new SceneError('Choose a central topic before adding branches.');
    if(target.id===rootId||draft.edges.some(edge=>(edge.relation==='branch'||edge.relation==='parent_child')&&edge.targetId===target.id&&edge.id!==existing?.id))throw new SceneError('A topic can have only one parent.');
    let cursor=source.id;
    while(cursor){if(cursor===target.id)throw new SceneError('That parent–child relationship would create a cycle.');cursor=draft.edges.find(edge=>(edge.relation==='branch'||edge.relation==='parent_child')&&edge.targetId===cursor)?.sourceId||'';}
  }
  const arrowhead=options.arrowhead?options.arrowhead==='arrow'?'arrow':null:kind==='connection'||kind==='sequence'?'arrow':null;
  const arrowheadSource=options.arrowheadSource||(options.arrowhead?'explicit':'intent');
  if(existing){existing.relation=kind;existing.relationSource=relationSource;existing.endArrowhead=arrowhead;existing.arrowheadSource=arrowheadSource;draft.recentEdgeId=existing.id;return;}
  const edge:Edge={id:newId(),sourceId:source.id,targetId:target.id,label,relation:kind,relationSource,endArrowhead:arrowhead,arrowheadSource};
  draft.edges.push(edge);draft.recentEdgeId=edge.id;
  if(kind==='branch'&&options.placeNew)mindmapPosition(draft,source,target,sourceScope?.rootId||draft.context.rootId!);
  draft.recentIds=[target.id,source.id,...draft.recentIds.filter(v=>v!==target.id&&v!==source.id)].slice(0,5);
}
function resolveEdge(scene:Snapshot,action:{edge?:string;source?:string;target?:string}):Edge{
  if(action.edge){
    const id=/^(?:this|that|it|last)(?:\s+(?:arrow|connection|edge))?$/i.test(action.edge.trim())?scene.recentEdgeId:action.edge;
    const found=scene.edges.find(edge=>edge.id===id);
    if(found){
      if(action.source&&action.target){
        const source=resolveNode(scene,action.source),target=resolveNode(scene,action.target);
        if(!((found.sourceId===source.id&&found.targetId===target.id)||(found.sourceId===target.id&&found.targetId===source.id)))
          throw new SceneError('That arrow does not connect the named blocks. Nothing was changed.');
      }
      return found;
    }
    throw new SceneError('Select an arrow, or name both blocks in the connection.');
  }
  if(!action.source||!action.target)throw new SceneError('Name both blocks in the connection, or select an arrow.');
  const source=resolveNode(scene,action.source),target=resolveNode(scene,action.target);
  const matches=scene.edges.filter(edge=>(edge.sourceId===source.id&&edge.targetId===target.id)||(edge.sourceId===target.id&&edge.targetId===source.id));
  if(matches.length===1)return matches[0];
  if(matches.length>1)throw new SceneError('Both arrow directions exist. Select the arrow you mean.');
  throw new SceneError(`${source.label} and ${target.label} are not connected.`);
}
export function arrangeScene(scene:Scene):Scene{
  if(scene.nodes.length<2||!scene.edges.length)return scene;
  const indegree=new Map(scene.nodes.map(node=>[node.id,0]));
  const outgoing=new Map(scene.nodes.map(node=>[node.id,[] as string[]]));
  for(const edge of scene.edges)outgoing.get(edge.sourceId)?.push(edge.targetId);
  const forward=new Map(scene.nodes.map(node=>[node.id,[] as string[]]));
  const state=new Map<string,number>();
  const visit=(id:string)=>{
    state.set(id,1);
    for(const target of outgoing.get(id)||[]){
      if(state.get(target)===1)continue;
      if(!state.has(target))visit(target);
      forward.get(id)?.push(target);
      indegree.set(target,(indegree.get(target)||0)+1);
    }
    state.set(id,2);
  };
  for(const node of scene.nodes)if(!state.has(node.id))visit(node.id);
  const layers=new Map<string,number>(),ready=scene.nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id);
  for(const id of ready)layers.set(id,0);
  for(let index=0;index<ready.length;index++){
    const id=ready[index];
    for(const target of forward.get(id)||[]){
      layers.set(target,Math.max(layers.get(target)||0,(layers.get(id)||0)+1));
      indegree.set(target,(indegree.get(target)||0)-1);
      if(indegree.get(target)===0)ready.push(target);
    }
  }
  const columns=new Map<number,Node[]>();
  for(const node of scene.nodes){const layer=layers.get(node.id)!;columns.set(layer,[...(columns.get(layer)||[]),node]);}
  const xByLayer=new Map<number,number>();let x=80;
  for(const layer of [...columns.keys()].sort((a,b)=>a-b)){xByLayer.set(layer,x);x+=Math.max(...columns.get(layer)!.map(node=>node.width))+90;}
  const arranged=scene.nodes.map(node=>{const column=columns.get(layers.get(node.id)!)!;return {...node,x:xByLayer.get(layers.get(node.id)!)!,y:100+column.indexOf(node)*160};});
  if(arranged.every((node,index)=>node.x===scene.nodes[index].x&&node.y===scene.nodes[index].y))return scene;
  return {...scene,nodes:arranged,past:[...scene.past.slice(-49),copy(scene)],future:[]};
}
export function execute(scene:Scene, input:unknown):Scene{
  const actions=z.array(actionSchema).min(1).parse(input);
  if(actions.length===1&&actions[0].type==='CLEAR')return clearScene(scene);
  if(actions.length===1&&actions[0].type==='NEW_DIAGRAM')return {...emptyScene(),past:[...scene.past.slice(-49),copy(scene)]};
  if(actions.length===1&&actions[0].type==='ARRANGE')return arrangeScene(scene);
  if(actions.length===1&&actions[0].type==='UNDO'){
    const steps=actions[0].steps||1;
    if(scene.past.length<steps)throw new SceneError(scene.past.length?'Not enough edits to undo.':'Nothing to undo.');
    let next=scene;
    for(let index=0;index<steps;index++)next={...copy(next.past.at(-1)!),past:next.past.slice(0,-1),future:[copy(next),...next.future]};
    return next;
  }
  if(actions.length===1&&actions[0].type==='REDO'){
    const steps=actions[0].steps||1;
    if(scene.future.length<steps)throw new SceneError(scene.future.length?'Not enough edits to redo.':'Nothing to redo.');
    let next=scene;
    for(let index=0;index<steps;index++)next={...copy(next.future[0]),past:[...next.past,copy(next)],future:next.future.slice(1)};
    return next;
  }
  if(actions.some(a=>a.type==='UNDO'||a.type==='REDO'||a.type==='CLEAR'||a.type==='ARRANGE'||a.type==='NEW_DIAGRAM'))throw new SceneError('Undo, redo, clear, new diagram, or arrange must be a command on its own.');
  const draft=copy(scene);
  const created=new Set<string>();
  for(const action of actions){
    switch(action.type){
      case 'SET_DIAGRAM_CONTEXT':{
        if(draft.context.type&&draft.context.type!==action.diagramType&&diagramTypeLocked(scene)&&action.diagramType!=='mixed')throw new SceneError('Start a new diagram to choose a different type.');
        if(action.diagramType==='mixed'&&draft.context.type&&draft.context.type!=='mixed'){
          const previous=draft.context.type;
          draft.containers=draft.containers?.map(container=>!container.parentId&&!container.intentType?{...container,intentType:previous}:container);
          const loose=draft.nodes.filter(node=>!draft.containers?.some(container=>container.nodeIds.includes(node.id)));
          if(loose.length){
            const names=new Set((draft.containers||[]).map(container=>container.name.toLowerCase()));
            let name=`${previous[0].toUpperCase()}${previous.slice(1)} section`,index=2;
            while(names.has(name.toLowerCase()))name=`${previous[0].toUpperCase()}${previous.slice(1)} section ${index++}`;
            draft.containers=[...(draft.containers||[]),{id:newId(),name,nodeIds:loose.map(node=>node.id),intentType:previous,...(previous==='mindmap'&&draft.context.rootId?{rootId:draft.context.rootId}:{})}];
          }
        }
        draft.context={...draft.context,type:action.diagramType,purpose:action.purpose??draft.context.purpose,source:action.source||'explicit',rootId:action.diagramType==='mindmap'?(draft.context.rootId|| (draft.nodes.length===1?draft.nodes[0].id:undefined)):undefined};break;
      }
      case 'SET_PURPOSE':draft.context.purpose=action.purpose;break;
      case 'REMEMBER_NOTE':{
        const note=action.note.trim();
        const notes=draft.context.notes||[];
        if(!notes.some(item=>item.toLocaleLowerCase()===note.toLocaleLowerCase())){
          if(notes.length>=8)throw new SceneError('This diagram already has eight notes. Remove one before adding another.');
          draft.context.notes=[...notes,note];
        }
        break;
      }
      case 'FORGET_NOTE':{
        const notes=draft.context.notes||[];
        const match=notes.find(item=>item.toLocaleLowerCase()===action.note.toLocaleLowerCase());
        if(!match)throw new SceneError(`I couldn't find the note “${action.note}”.`);
        draft.context.notes=notes.filter(item=>item!==match);
        break;
      }
      case 'SET_MINDMAP_ROOT':{
        if(draft.context.type!=='mindmap')throw new SceneError('Choose Mind map first.');
        const node=resolveNode(draft,action.target);
        if(intentScope(draft,node.id))throw new SceneError('Choose a topic in the canvas mind map.');
        if(draft.edges.some(edge=>edge.relation==='branch'&&edge.targetId===node.id))throw new SceneError('A branch topic cannot become the central topic.');
        draft.context.rootId=node.id;break;
      }
      case 'ADD_NODE':created.add(addNode(draft,action.label,action.shape,action.color,action.id,undefined,undefined,action.shapeSource,action.role,action.roleSource,action.container).id);break;
      case 'ADD_EDGE':{const source=resolveNode(draft,action.source),target=resolveNode(draft,action.target);addEdge(draft,source,target,action.label,{relation:action.relation,placeNew:created.has(target.id),relationSource:action.relationSource,arrowhead:action.arrowhead});break;}
      case 'REPARENT_BRANCH':{
        const target=resolveNode(draft,action.target),parent=resolveNode(draft,action.parent);
        const mode=effectiveDiagramType(draft,target.id),scope=intentScope(draft,target.id);
        if(mode!=='mindmap'&&mode!=='hierarchy')throw new SceneError('Reparenting requires a mind map or hierarchy.');
        if(mode!==effectiveDiagramType(draft,parent.id)||scope?.id!==intentScope(draft,parent.id)?.id)throw new SceneError('Parent and child must be in the same diagram scope.');
        if(target.id===(scope?.rootId||draft.context.rootId))throw new SceneError('The central topic cannot be a child.');
        const subtree=new Set([target.id]);
        if(mode==='mindmap'){
          let changed=true;
          while(changed){changed=false;for(const edge of draft.edges)if(edge.relation==='branch'&&subtree.has(edge.sourceId)&&!subtree.has(edge.targetId)){subtree.add(edge.targetId);changed=true;}}
        }
        const previous={x:target.x,y:target.y};
        draft.edges=draft.edges.filter(edge=>!['branch','parent_child'].includes(edge.relation||'')||edge.targetId!==target.id);
        addEdge(draft,parent,target,'',{relation:mode==='mindmap'?'branch':'parent_child',relationSource:'explicit'});
        if(mode==='mindmap'){
          mindmapPosition(draft,parent,target,scope?.rootId||draft.context.rootId!,subtree);
          const dx=target.x-previous.x,dy=target.y-previous.y;
          for(const node of draft.nodes)if(node.id!==target.id&&subtree.has(node.id)){node.x+=dx;node.y+=dy;}
        }
        break;
      }
      case 'DELETE_EDGE':{
        const edge=resolveEdge(draft,action);draft.edges=draft.edges.filter(item=>item.id!==edge.id);draft.recentEdgeId=null;break;
      }
      case 'REVERSE_EDGE':{
        const edge=resolveEdge(draft,action);
        if(edge.relation==='branch')throw new SceneError('Use “Move topic under parent” to change a mind-map branch.');
        if(edge.relation==='parent_child')throw new SceneError('Use a parent–child command to change ancestry.');
        if(draft.edges.some(item=>item.id!==edge.id&&item.sourceId===edge.targetId&&item.targetId===edge.sourceId))throw new SceneError('The reverse connection already exists.');
        [edge.sourceId,edge.targetId]=[edge.targetId,edge.sourceId];draft.recentEdgeId=edge.id;break;
      }
      case 'UPDATE_EDGE':{
        const edge=resolveEdge(draft,action);edge.label=action.label;draft.recentEdgeId=edge.id;break;
      }
      case 'CREATE_GROUP':{
        const ids=[...new Set(action.targets.map(target=>resolveNode(draft,target).id))];
        const name=action.name.trim();
        if(draft.groups?.some(group=>group.name.toLowerCase()===name.toLowerCase()))throw new SceneError(`A group named “${name}” already exists.`);
        draft.groups=[...(draft.groups||[]),{name,nodeIds:ids}];break;
      }
      case 'CREATE_CONTAINER':{
        const ids=[...new Set(action.targets.map(target=>resolveNode(draft,target).id))];
        const children=[...new Set((action.childContainers||[]).map(target=>resolveContainer(draft,target).id))];
        if(!ids.length&&!children.length)throw new SceneError('Name at least one block or container to put inside.');
        const name=action.name.trim();
        if(draft.containers?.some(container=>container.name.toLowerCase()===name.toLowerCase())||draft.nodes.some(node=>node.label.toLowerCase()===name.toLowerCase())||draft.groups?.some(group=>group.name.toLowerCase()===name.toLowerCase()))throw new SceneError(`The name “${name}” is already used in this diagram.`);
        const owners=ids.map(id=>draft.containers?.find(container=>container.nodeIds.includes(id)));
        const owner=owners[0];
        if(owners.some(item=>item?.id!==owner?.id))throw new SceneError('Those blocks are in different containers. Move them into one container first.');
        if(owner&&children.includes(owner.id))throw new SceneError('A container cannot contain its own parent.');
        const container:Container={id:newId(),name,nodeIds:ids,...(owner?{parentId:owner.id}:{})};
        if(owner)owner.nodeIds=owner.nodeIds.filter(id=>!ids.includes(id));
        draft.containers=[...(draft.containers||[]),container];
        for(const child of draft.containers.filter(item=>children.includes(item.id))){assertCanNest(draft,child,container);child.parentId=container.id;}
        pruneEmptyContainers(draft);break;
      }
      case 'ADD_TO_CONTAINER':{
        const container=resolveContainer(draft,action.container);
        const ids=[...new Set(action.targets.map(target=>resolveNode(draft,target).id))];
        for(const id of ids){
          const owner=draft.containers?.find(item=>item.nodeIds.includes(id));
          if(!owner||owner.id===container.id)continue;
          let ancestor=draft.containers?.find(item=>item.id===container.parentId);
          while(ancestor&&ancestor.id!==owner.id)ancestor=draft.containers?.find(item=>item.id===ancestor?.parentId);
          if(!ancestor)throw new SceneError('A block can be inside only one container. Remove it from its current container first.');
          owner.nodeIds=owner.nodeIds.filter(nodeId=>nodeId!==id);
        }
        container.nodeIds=[...new Set([...container.nodeIds,...ids])];break;
      }
      case 'REMOVE_FROM_CONTAINER':{
        const container=resolveContainer(draft,action.container);
        const ids=[...new Set(action.targets.map(target=>resolveNode(draft,target).id))];
        if(ids.some(id=>!container.nodeIds.includes(id)))throw new SceneError('One of those blocks is not inside this container.');
        container.nodeIds=container.nodeIds.filter(id=>!ids.includes(id));
        pruneEmptyContainers(draft);
        break;
      }
      case 'MOVE_CONTAINER':{
        const container=resolveContainer(draft,action.container),bounds=containerBounds(draft,container);
        const dx=action.x!==undefined&&action.y!==undefined?action.x-bounds.x:action.direction==='right'?260:action.direction==='left'?-260:0;
        const dy=action.x!==undefined&&action.y!==undefined?action.y-bounds.y:action.direction==='below'?160:action.direction==='above'?-160:0;
        if(action.x===undefined&&action.y===undefined&&!action.direction)throw new SceneError('Move needs a direction or coordinates.');
        if((action.x===undefined)!==(action.y===undefined))throw new SceneError('Move needs both coordinates.');
        const memberIds=new Set(descendantNodeIds(draft,container));
        draft.nodes=draft.nodes.map(node=>memberIds.has(node.id)?{...node,x:node.x+dx,y:node.y+dy}:node);break;
      }
      case 'RENAME_CONTAINER':{
        const container=resolveContainer(draft,action.container),name=action.name.trim();
        if(draft.nodes.some(node=>node.label.toLowerCase()===name.toLowerCase())||draft.groups?.some(group=>group.name.toLowerCase()===name.toLowerCase())||draft.containers?.some(other=>other.id!==container.id&&other.name.toLowerCase()===name.toLowerCase()))throw new SceneError(`The name “${name}” is already used in this diagram.`);
        container.name=name;break;
      }
      case 'DELETE_CONTAINER':{
        const container=resolveContainer(draft,action.container);
        draft.containers=draft.containers?.filter(item=>item.id!==container.id).map(item=>item.parentId===container.id?{...item,parentId:container.parentId}:item);pruneEmptyContainers(draft);break;
      }
      case 'NEST_CONTAINER':{
        const child=resolveContainer(draft,action.container),parent=resolveContainer(draft,action.parent);
        assertCanNest(draft,child,parent);child.parentId=parent.id;pruneEmptyContainers(draft);break;
      }
      case 'UNNEST_CONTAINER':{
        const child=resolveContainer(draft,action.container);delete child.parentId;pruneEmptyContainers(draft);break;
      }
      case 'SET_CONTAINER_COLLAPSED':resolveContainer(draft,action.container).collapsed=action.collapsed;break;
      case 'SET_CONTAINER_INTENT':{
        const container=resolveContainer(draft,action.container);
        if(action.diagramType)container.intentType=action.diagramType;else delete container.intentType;
        if(action.diagramType!=='mindmap')delete container.rootId;
        else if(!container.rootId){
          const members=descendantNodeIds(draft,container);
          const roots=members.filter(id=>!draft.edges.some(edge=>edge.relation==='branch'&&edge.targetId===id));
          if(roots.length===1)container.rootId=roots[0];
        }
        break;
      }
      case 'SET_CONTAINER_ROOT':{
        const container=resolveContainer(draft,action.container),node=resolveNode(draft,action.target);
        if(container.intentType!=='mindmap'||intentScope(draft,node.id)?.id!==container.id)throw new SceneError('Choose a topic in this mind-map container.');
        if(draft.edges.some(edge=>edge.relation==='branch'&&edge.targetId===node.id))throw new SceneError('A branch topic cannot become the central topic.');
        container.rootId=node.id;break;
      }
      case 'MOVE_NODE':{
        const node=resolveNode(draft,action.target);
        if(action.relativeTo){const other=resolveNode(draft,action.relativeTo); const direction=action.direction||'right';node.x=other.x+(direction==='right'?260:direction==='left'?-260:0);node.y=other.y+(direction==='below'?160:direction==='above'?-160:0);}
        else if(action.x!==undefined&&action.y!==undefined){node.x=action.x;node.y=action.y;}
        else if(action.direction){node.x+=action.direction==='right'?260:action.direction==='left'?-260:0;node.y+=action.direction==='below'?160:action.direction==='above'?-160:0;}
        else throw new SceneError('Move needs a direction or coordinates.');
        draft.recentIds=[node.id,...draft.recentIds.filter(v=>v!==node.id)].slice(0,5);break;
      }
      case 'UPDATE_NODE':{
        const node=resolveNode(draft,action.target);if(action.label!==undefined)node.label=action.label;if(action.color){node.color=nodeColor(action.color);node.fillColor=node.color;}if(action.shape){Object.assign(node,resizeForShape(node,action.shape));node.shapeSource='explicit';}if(action.role){node.role=action.role;node.roleSource=action.roleSource||'explicit';}draft.recentIds=[node.id,...draft.recentIds.filter(v=>v!==node.id)].slice(0,5);break;
      }
      case 'DELETE_NODE':{
        const node=resolveNode(draft,action.target);draft.nodes=draft.nodes.filter(n=>n.id!==node.id);draft.edges=draft.edges.filter(e=>e.sourceId!==node.id&&e.targetId!==node.id);if(draft.context.rootId===node.id)draft.context.rootId=undefined;draft.recentIds=draft.recentIds.filter(id=>id!==node.id);draft.groups=draft.groups?.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>id!==node.id)})).filter(group=>group.nodeIds.length);draft.containers=draft.containers?.map(container=>({...container,nodeIds:container.nodeIds.filter(id=>id!==node.id)}));pruneEmptyContainers(draft);if(!draft.edges.some(edge=>edge.id===draft.recentEdgeId))draft.recentEdgeId=null;break;
      }
      case 'INSERT_BETWEEN':{
        const source=resolveNode(draft,action.source),target=resolveNode(draft,action.target);
        const edge=draft.edges.find(e=>e.sourceId===source.id&&e.targetId===target.id);
        if(!edge)throw new SceneError(`${source.label} is not connected to ${target.label}.`);
        const scope=intentScope(draft,source.id),sameScope=scope?.id===intentScope(draft,target.id)?.id;
        const node=addNode(draft,action.label,action.shape,undefined,action.id,(source.x+target.x)/2,(source.y+target.y)/2+160,action.shapeSource,undefined,undefined,sameScope?scope?.id:undefined);
        draft.edges=draft.edges.filter(e=>e.id!==edge.id);
        const options={relation:edge.relation,relationSource:edge.relationSource,arrowhead:edge.endArrowhead===null?'none' as const:'arrow' as const,arrowheadSource:edge.arrowheadSource};
        addEdge(draft,source,node,'',options);addEdge(draft,node,target,edge.label,options);break;
      }
    }
  }
  for(const container of draft.containers||[])if(container.rootId&&!descendantNodeIds(draft,container).includes(container.rootId))delete container.rootId;
  if(draft.context.rootId&&intentScope(draft,draft.context.rootId))draft.context.rootId=undefined;
  for(const edge of draft.edges.filter(item=>item.relation==='branch')){
    const sourceScope=intentScope(draft,edge.sourceId),targetScope=intentScope(draft,edge.targetId);
    if(effectiveDiagramType(draft,edge.sourceId)!=='mindmap'||effectiveDiagramType(draft,edge.targetId)!=='mindmap'||sourceScope?.id!==targetScope?.id||!(sourceScope?.rootId||draft.context.rootId))
      throw new SceneError('A mind-map branch must stay within one mind-map scope with a central topic.');
  }
  return {...draft,past:[...scene.past.slice(-49),copy(scene)],future:[]};
}
export function replaceLastEdit(current:Scene,before:Scene,after:Scene,input:unknown):Scene{
  if(current!==after)throw new SceneError('The diagram changed after that command. Please give the full command.');
  return execute(before,input);
}
export function moveFromCanvas(scene:Scene,positions:Record<string,{x:number;y:number}>):Scene{
  const changed=scene.nodes.some(n=>positions[n.id]&&(Math.abs(n.x-positions[n.id].x)>1||Math.abs(n.y-positions[n.id].y)>1));
  if(!changed)return scene;
  return {...scene,nodes:scene.nodes.map(n=>positions[n.id]?{...n,...positions[n.id]}:n),past:[...scene.past.slice(-49),copy(scene)],future:[]};
}

export function styleScene(scene:Scene,nodeStyles:Record<string,{color:string;fontFamily:2|3}>,edgeStyles:Record<string,{color:string;fontFamily:2|3}>,containerStyles:Record<string,{color:string}>={},shapeSuggestions:Record<string,{shape:Node['shape']}>={}):Scene{
  const nodes=scene.nodes.map(node=>{const styled=nodeStyles[node.id]?{...node,...nodeStyles[node.id]}:node;const suggested=shapeSuggestions[node.id];return suggested&&suggested.shape!==node.shape?{...styled,...resizeForShape(styled,suggested.shape),shapeSource:'suggested' as const}:styled;});
  const edges=scene.edges.map(edge=>edgeStyles[edge.id]?{...edge,...edgeStyles[edge.id]}:edge);
  const containers=scene.containers?.map(container=>containerStyles[container.id]?{...container,color:containerStyles[container.id].color}:container);
  if(nodes.every((node,index)=>JSON.stringify(node)===JSON.stringify(scene.nodes[index]))&&edges.every((edge,index)=>JSON.stringify(edge)===JSON.stringify(scene.edges[index]))&&JSON.stringify(containers)===JSON.stringify(scene.containers))return scene;
  return {...scene,nodes,edges,containers,past:[...scene.past.slice(-49),copy(scene)],future:[]};
}

export type CanvasElement = CanvasExtra & {x:number;y:number;width:number;height:number;strokeColor:string;backgroundColor?:string;isDeleted?:boolean;text?:string;originalText?:string;endArrowhead?:string|null;containerId?:string;startBinding?:{elementId:string}|null;endBinding?:{elementId:string}|null};
const nodeShapes=new Set(['rectangle','ellipse','diamond']);
function syncedCylinder(old:Node,body:CanvasElement,top?:CanvasElement,bottom?:CanvasElement):Node{
  const expected=cylinderParts(old),cap=cylinderCapHeight(old.height);
  const moved=(element:CanvasElement,reference:{x:number;y:number;width:number;height:number})=>
    Math.abs(element.x-reference.x)>1||Math.abs(element.y-reference.y)>1||Math.abs(element.width-reference.width)>1||Math.abs(element.height-reference.height)>1;
  const bodyChanged=moved(body,expected.body),topChanged=top&&moved(top,expected.top),bottomChanged=bottom&&moved(bottom,expected.bottom);
  let x=body.x,y=body.y-cap/2,width=body.width,height=body.height+cap;
  if(top&&bottom&&topChanged&&bottomChanged){x=top.x;y=top.y;width=top.width;height=bottom.y+bottom.height-top.y;}
  else if(top&&topChanged&&!bodyChanged&&!bottomChanged){x=old.x+(top.x-expected.top.x);y=old.y+(top.y-expected.top.y);width=top.width;height=old.height+(top.height-expected.top.height);}
  else if(bottom&&bottomChanged&&!bodyChanged&&!topChanged){x=old.x+(bottom.x-expected.bottom.x);y=old.y+(bottom.y-expected.bottom.y);width=bottom.width;height=old.height+(bottom.height-expected.bottom.height);}
  const color=top&&top.strokeColor!==old.color?top.strokeColor:bottom&&bottom.strokeColor!==old.color?bottom.strokeColor:body.strokeColor;
  const previousFill=old.fillColor||'#ffffff';
  const background=[top,bottom,body].find(part=>part?.backgroundColor&&part.backgroundColor!==previousFill)?.backgroundColor
    ??body.backgroundColor??top?.backgroundColor??bottom?.backgroundColor;
  return {...old,x,y,width:Math.max(1,width),height:Math.max(1,height),color,...(background===undefined?{}:{fillColor:background==='#ffffff'?undefined:background})};
}
export function syncCanvas(scene:Scene,elements:readonly CanvasElement[]):Scene {
  const live=elements.filter(element=>!element.isDeleted);
  const byId=new Map(live.map(element=>[element.id,element]));
  const generatedPart=(id:string)=>scene.nodes.some(node=>node.shape==='cylinder'&&(id===cylinderPartId(node.id,'top')||id===cylinderPartId(node.id,'bottom')));
  const containerElementIds=new Set((scene.containers||[]).flatMap(container=>[`container:${container.id}`,`container:${container.id}:label`]));
  const hidden=hiddenNodeIds(scene);
  const collapsedMembers=visibleContainers(scene).filter(container=>container.collapsed).map(container=>({id:container.id,members:new Set(descendantNodeIds(scene,container))}));
  const visibleEndpoint=(id:string)=>hidden.has(id)?collapsedMembers.find(container=>container.members.has(id))?.id:id;
  const frameMoves=new Map<string,{x:number;y:number}>();
  for(const container of visibleContainers(scene)){
    const frame=byId.get(`container:${container.id}`);
    if(!frame||frame.type!=='rectangle')continue;
    const bounds=containerBounds(scene,container);
    const dx=frame.x-bounds.x,dy=frame.y-bounds.y;
    if(Math.abs(dx)<1&&Math.abs(dy)<1)continue;
    for(const id of descendantNodeIds(scene,container))if(!frameMoves.has(id))frameMoves.set(id,{x:dx,y:dy});
  }
  const nodes:Node[]=[];
  for(const old of scene.nodes){
    const shape=byId.get(old.id);
    if((!shape||!nodeShapes.has(shape.type))&&!hidden.has(old.id))continue;
    if(!shape||!nodeShapes.has(shape.type)){
      const delta=frameMoves.get(old.id);
      nodes.push(delta?{...old,x:old.x+delta.x,y:old.y+delta.y}:{...old});
      continue;
    }
    const text=byId.get(`${old.id}:label`);
    const delta=frameMoves.get(old.id);
    if(old.shape==='cylinder'&&shape.type==='rectangle'){
      const top=byId.get(cylinderPartId(old.id,'top')),bottom=byId.get(cylinderPartId(old.id,'bottom'));
      const synced=syncedCylinder(old,shape,top?.type==='ellipse'?top:undefined,bottom?.type==='ellipse'?bottom:undefined);
      const movedWithFrame=delta&&Math.abs(synced.x-old.x-delta.x)<1&&Math.abs(synced.y-old.y-delta.y)<1;
      nodes.push({...synced,x:synced.x+(delta&&!movedWithFrame?delta.x:0),y:synced.y+(delta&&!movedWithFrame?delta.y:0),label:text?.type==='text'?text.originalText??text.text??old.label:old.label});
      continue;
    }
    const movedWithFrame=delta&&Math.abs(shape.x-old.x-delta.x)<1&&Math.abs(shape.y-old.y-delta.y)<1;
    nodes.push({...old,x:shape.x+(delta&&!movedWithFrame?delta.x:0),y:shape.y+(delta&&!movedWithFrame?delta.y:0),width:Math.max(1,shape.width),height:Math.max(1,shape.height),color:shape.strokeColor,...(shape.backgroundColor===undefined?{}:{fillColor:shape.backgroundColor==='#ffffff'?undefined:shape.backgroundColor}),shape:shape.type as Node['shape'],shapeSource:shape.type!==old.shape?'explicit':old.shapeSource,label:text?.type==='text'?text.originalText??text.text??old.label:old.label});
  }
  const known=new Set(nodes.map(node=>node.id));
  for(const shape of live){
    if(!nodeShapes.has(shape.type)||generatedPart(shape.id)||containerElementIds.has(shape.id)||scene.nodes.some(node=>node.id===shape.id))continue;
    const text=live.find(item=>item.type==='text'&&item.containerId===shape.id);
    nodes.push({id:shape.id,label:text?.text||'Untitled block',shape:shape.type as Node['shape'],shapeSource:'explicit',x:shape.x,y:shape.y,width:Math.max(1,shape.width),height:Math.max(1,shape.height),color:shape.strokeColor,...(shape.backgroundColor&&shape.backgroundColor!=='#ffffff'?{fillColor:shape.backgroundColor}:{})});
    known.add(shape.id);
  }
  const edges:Edge[]=[];
  for(const old of scene.edges){
    const arrow=byId.get(old.id);
    if(!arrow||arrow.type!=='arrow'){
      if(hidden.has(old.sourceId)&&hidden.has(old.targetId)&&visibleEndpoint(old.sourceId)===visibleEndpoint(old.targetId))edges.push({...old});
      continue;
    }
    const boundSource=cylinderOwner(nodes,arrow.startBinding?.elementId||'')||arrow.startBinding?.elementId||'';
    const boundTarget=cylinderOwner(nodes,arrow.endBinding?.elementId||'')||arrow.endBinding?.elementId||'';
    const sourceId=known.has(boundSource)?boundSource:old.sourceId;
    const targetId=known.has(boundTarget)?boundTarget:old.targetId;
    const label=byId.get(`${old.id}:label`)||live.find(element=>element.type==='text'&&element.containerId===old.id);
    if(known.has(sourceId)&&known.has(targetId)&&sourceId!==targetId){
      const retargeted=sourceId!==old.sourceId||targetId!==old.targetId;
      const endArrowhead=arrow.endArrowhead==='arrow'?'arrow':arrow.endArrowhead===null?null:old.endArrowhead;
      const structured=old.relation==='branch'||old.relation==='parent_child'||old.relation==='sequence';
      edges.push({...old,sourceId,targetId,relation:retargeted&&structured?'association':old.relation,relationSource:retargeted?'manual':old.relationSource,label:label?.type==='text'?label.text??old.label:old.label,endArrowhead,arrowheadSource:retargeted||endArrowhead!==old.endArrowhead?'manual':old.arrowheadSource});
    }
  }
  for(const arrow of live){
    if(arrow.type!=='arrow'||scene.edges.some(edge=>edge.id===arrow.id))continue;
    const sourceId=cylinderOwner(nodes,arrow.startBinding?.elementId||'')||arrow.startBinding?.elementId;
    const targetId=cylinderOwner(nodes,arrow.endBinding?.elementId||'')||arrow.endBinding?.elementId;
    const text=live.find(element=>element.type==='text'&&element.containerId===arrow.id);
    if(sourceId&&targetId&&known.has(sourceId)&&known.has(targetId)&&sourceId!==targetId)edges.push({id:arrow.id,sourceId,targetId,label:text?.text||'',relation:'association',relationSource:'manual',endArrowhead:arrow.endArrowhead==='arrow'?'arrow':null,arrowheadSource:'manual'});
  }
  const edgeIds=new Set(edges.map(edge=>edge.id));
  const extras=live.filter(element=>!known.has(element.id)&&!generatedPart(element.id)&&!containerElementIds.has(element.id)&&!edgeIds.has(element.id)&&!edges.some(edge=>element.id===`${edge.id}:label`||element.type==='text'&&element.containerId===edge.id)&&!scene.nodes.some(node=>element.id===`${node.id}:label`)&&!nodes.some(node=>element.type==='text'&&element.containerId===node.id));
  const recentIds=scene.recentIds.filter(id=>known.has(id)).slice(0,5);
  const groups=scene.groups?.map(group=>({...group,nodeIds:group.nodeIds.filter(id=>known.has(id))})).filter(group=>group.nodeIds.length);
  const containerDraft:Snapshot={nodes,edges,recentIds,context:scene.context,groups,containers:scene.containers?.map(container=>({...container,nodeIds:container.nodeIds.filter(id=>known.has(id))}))};
  pruneEmptyContainers(containerDraft);
  const containers=containerDraft.containers;
  for(const container of containers||[])if(container.rootId&&!descendantNodeIds(containerDraft,container).includes(container.rootId))delete container.rootId;
  const recentEdgeId=scene.recentEdgeId==null?scene.recentEdgeId:edgeIds.has(scene.recentEdgeId)?scene.recentEdgeId:null;
  const context=scene.context.rootId&&(!known.has(scene.context.rootId)||intentScope(containerDraft,scene.context.rootId))?{...scene.context,rootId:undefined}:scene.context.type==='mindmap'&&!scene.context.rootId&&nodes.length===1&&!intentScope(containerDraft,nodes[0].id)?{...scene.context,rootId:nodes[0].id}:scene.context;
  const changed=JSON.stringify({nodes,edges,extras,recentIds,groups,containers,recentEdgeId,context})!==JSON.stringify({nodes:scene.nodes,edges:scene.edges,extras:scene.extras||[],recentIds:scene.recentIds,groups:scene.groups,containers:scene.containers,recentEdgeId:scene.recentEdgeId,context:scene.context});
  if(!changed)return scene;
  return {nodes,edges,extras,recentIds,groups,containers,context,recentEdgeId,past:[...scene.past.slice(-49),copy(scene)],future:[]};
}
