import { z } from 'zod';
import {descendantNodeIds,effectiveDiagramType,intentScope,type Scene,type Snapshot} from './scene';

export const logSchema = z.object({text:z.string(),kind:z.enum(['command','error','info']),time:z.string()});
export type Log = z.infer<typeof logSchema>;
const semanticSource=z.enum(['explicit','intent','manual','legacy']);
const nodeSchema=z.object({id:z.string().min(1),label:z.string(),shape:z.enum(['rectangle','ellipse','diamond','cylinder']),shapeSource:z.enum(['explicit','suggested','intent']).optional(),role:z.enum(['component','database','topic','note','process','decision','start','end']).optional(),roleSource:semanticSource.optional(),x:z.number().finite(),y:z.number().finite(),width:z.number().positive(),height:z.number().positive(),color:z.string(),fillColor:z.string().optional(),fontFamily:z.union([z.literal(2),z.literal(3)]).optional()});
const edgeSchema=z.object({id:z.string().min(1),sourceId:z.string().min(1),targetId:z.string().min(1),label:z.string(),relation:z.enum(['connection','branch','association','parent_child','sequence']).optional(),relationSource:semanticSource.optional(),endArrowhead:z.union([z.literal('arrow'),z.null()]).optional(),arrowheadSource:semanticSource.optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),fontFamily:z.union([z.literal(2),z.literal(3)]).optional()});
const diagramTypeSchema=z.enum(['architecture','mindmap','hierarchy','brainstorming','flowchart','mixed']);
const contextSchema=z.object({type:diagramTypeSchema.nullable(),purpose:z.string().max(240),source:z.enum(['explicit','confirmed','legacy']).optional(),rootId:z.string().optional(),notes:z.array(z.string().min(1).max(200)).max(8).optional()});
const extraSchema=z.object({id:z.string().min(1),type:z.string().min(1)}).catchall(z.unknown());
const snapshotSchema=z.object({nodes:z.array(nodeSchema).max(500),edges:z.array(edgeSchema).max(1000),recentIds:z.array(z.string()).max(5),context:contextSchema,recentEdgeId:z.string().nullable().optional(),groups:z.array(z.object({name:z.string().min(1),nodeIds:z.array(z.string()).max(500)})).max(100).optional(),containers:z.array(z.object({id:z.string().min(1),name:z.string().min(1),nodeIds:z.array(z.string()).max(500),parentId:z.string().optional(),collapsed:z.boolean().optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),intentType:z.enum(['architecture','mindmap','hierarchy','brainstorming','flowchart']).optional(),rootId:z.string().optional()})).max(100).optional(),extras:z.array(extraSchema).max(1000).optional()});
const fileSchema=z.object({id:z.string().min(1),mimeType:z.string().min(1),dataURL:z.string().startsWith('data:').max(2_000_000),created:z.number().finite(),lastRetrieved:z.number().finite().optional(),version:z.number().finite().optional()});
const sceneSchema=snapshotSchema.extend({past:z.array(snapshotSchema).max(50),future:z.array(snapshotSchema).max(50)});
const projectSchema=z.object({format:z.literal('bolcanvas-project'),version:z.union([z.literal(1),z.literal(2)]),scene:sceneSchema,logs:z.array(logSchema).max(100),latest:z.string(),files:z.record(fileSchema).optional()});
export type ProjectFiles=Record<string,z.infer<typeof fileSchema>>;

function checkSnapshot(snapshot:Snapshot){
  const nodeIds=new Set(snapshot.nodes.map(n=>n.id));
  if(nodeIds.size!==snapshot.nodes.length)throw new Error('Project has duplicate node IDs.');
  const edgeIds=new Set(snapshot.edges.map(e=>e.id));
  if(edgeIds.size!==snapshot.edges.length||snapshot.edges.some(e=>!nodeIds.has(e.sourceId)||!nodeIds.has(e.targetId)))throw new Error('Project has invalid connections.');
  if(snapshot.groups?.some(group=>group.nodeIds.some(id=>!nodeIds.has(id))))throw new Error('Project has invalid groups.');
  if(snapshot.context.rootId&&!nodeIds.has(snapshot.context.rootId))throw new Error('Project has an invalid central topic.');
  const parentEdges=snapshot.edges.filter(item=>item.relation==='branch'||item.relation==='parent_child');
  const children=new Set<string>();
  const rootIds=new Set([snapshot.context.rootId,...(snapshot.containers||[]).map(container=>container.rootId)]);
  for(const edge of parentEdges){if(children.has(edge.targetId)||rootIds.has(edge.targetId))throw new Error('Project has invalid parent–child ancestry.');children.add(edge.targetId);}
  for(const id of children){const seen=new Set<string>();let cursor:string|undefined=id;while(cursor){if(seen.has(cursor))throw new Error('Project has a parent–child cycle.');seen.add(cursor);cursor=parentEdges.find(edge=>edge.targetId===cursor)?.sourceId;}}
  const containers=snapshot.containers||[],members=containers.flatMap(container=>container.nodeIds);
  if(new Set(containers.map(container=>container.id)).size!==containers.length||new Set(containers.map(container=>container.name.toLowerCase())).size!==containers.length||new Set(members).size!==members.length||members.some(id=>!nodeIds.has(id)))throw new Error('Project has invalid containers.');
  const byContainerId=new Map(containers.map(container=>[container.id,container]));
  for(const container of containers){
    if((container.parentId&&!byContainerId.has(container.parentId))||(!container.nodeIds.length&&!containers.some(child=>child.parentId===container.id)))throw new Error('Project has invalid containers.');
    const seen=new Set<string>();let parent=container;
    while(parent.parentId){if(seen.has(parent.id))throw new Error('Project has a container cycle.');seen.add(parent.id);const next=byContainerId.get(parent.parentId);if(!next)throw new Error('Project has invalid containers.');parent=next;}
    if(container.rootId&&(!container.intentType||container.intentType!=='mindmap'||!descendantNodeIds(snapshot,container).includes(container.rootId)||intentScope(snapshot,container.rootId)?.id!==container.id))throw new Error('Project has an invalid container root.');
  }
  if(snapshot.context.rootId&&intentScope(snapshot,snapshot.context.rootId))throw new Error('Project has an invalid canvas root.');
  for(const edge of snapshot.edges.filter(item=>item.relation==='branch'))if(effectiveDiagramType(snapshot,edge.sourceId)!=='mindmap'||effectiveDiagramType(snapshot,edge.targetId)!=='mindmap'||intentScope(snapshot,edge.sourceId)?.id!==intentScope(snapshot,edge.targetId)?.id||!(intentScope(snapshot,edge.sourceId)?.rootId||snapshot.context.rootId))throw new Error('Project has invalid mind-map branches.');
}
export function readProject(json:string):{scene:Scene;logs:Log[];latest:string;files:ProjectFiles}{
  const raw=JSON.parse(json);
  // Older projects could accumulate more than five recent IDs after moves.
  for(const snapshot of [raw?.scene,...(raw?.scene?.past||[]),...(raw?.scene?.future||[])])
    if(snapshot&&Array.isArray(snapshot.recentIds)){
      snapshot.recentIds=snapshot.recentIds.slice(0,5);
      snapshot.context??={type:(snapshot.nodes?.length||snapshot.edges?.length)?'architecture':null,purpose:'',...((snapshot.nodes?.length||snapshot.edges?.length)?{source:'legacy'}:{})};
      for(const node of snapshot.nodes||[])if(node.role&&!node.roleSource)node.roleSource='legacy';
      for(const edge of snapshot.edges||[]){
        edge.relation??=snapshot.context.type==='mindmap'?'association':'connection';
        if(!('endArrowhead' in edge))edge.endArrowhead=edge.relation==='connection'||edge.relation==='sequence'?'arrow':null;
        edge.relationSource??='legacy';edge.arrowheadSource??='legacy';
      }
    }
  const project=projectSchema.parse(raw);
  [project.scene,...project.scene.past,...project.scene.future].forEach(checkSnapshot);
  return {scene:project.scene,logs:project.logs,latest:project.latest,files:project.files||{}};
}
export function readSavedScene(value:string):Scene{
  return readProject(JSON.stringify({format:'bolcanvas-project',version:2,scene:JSON.parse(value),logs:[],latest:''})).scene;
}
export function writeProject(scene:Scene,logs:Log[],latest:string,files:ProjectFiles={}):string{
  return JSON.stringify({format:'bolcanvas-project',version:2,scene,logs,latest,files},null,2);
}
export function readSavedLogs(value:string|null):Log[]{
  try{return logSchema.array().parse(JSON.parse(value||'[]'));}catch{return [];}
}
