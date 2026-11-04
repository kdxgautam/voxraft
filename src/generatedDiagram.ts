import {arrangeScene,emptyScene,execute,newId,type Action,type Scene} from './scene';

export type GeneratedType=Exclude<NonNullable<Scene['context']['type']>,'mixed'>;

function arrangeGeneratedMindmap(scene:Scene):Scene{
  const rootId=scene.context.rootId;
  if(!rootId)return scene;
  const branches=scene.edges.filter(edge=>edge.relation==='branch'&&edge.sourceId===rootId).map(edge=>edge.targetId);
  if(branches.length<3||branches.length>6)return scene;
  const children=new Map(branches.map(id=>[id,scene.edges.filter(edge=>edge.relation==='branch'&&edge.sourceId===id).map(edge=>edge.targetId)]));
  const covered=new Set([rootId,...branches,...[...children.values()].flat()]);
  if(covered.size!==scene.nodes.length)return scene;
  const positions=new Map<string,{x:number;y:number}>();
  const rows=Math.ceil(branches.length/2);
  positions.set(rootId,{x:620,y:120+(rows-1)*150});
  branches.forEach((id,index)=>{
    const left=index%2===0,row=Math.floor(index/2),y=120+row*300;
    positions.set(id,{x:left?320:920,y});
    const topics=children.get(id)||[];
    topics.forEach((child,topicIndex)=>positions.set(child,{
      x:left?40:1200,
      y:y+(topicIndex-(topics.length-1)/2)*140,
    }));
  });
  return {...scene,nodes:scene.nodes.map(node=>({...node,...positions.get(node.id)}))};
}

export function appendGeneratedDiagram(scene:Scene,actions:Action[],kind:GeneratedType,description:string):Scene{
  const arranged=arrangeScene(execute(emptyScene(),[
    {type:'SET_DIAGRAM_CONTEXT',diagramType:kind,purpose:description.slice(0,240),source:'explicit'},
    ...actions
  ]));
  const built=kind==='mindmap'?arrangeGeneratedMindmap(arranged):arranged;
  if(!built.nodes.length)throw new Error('The generated diagram has no blocks.');

  const base=execute(scene,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mixed',source:'explicit'}]);
  const oldRight=Math.max(0,...base.nodes.map(node=>node.x+node.width),...(base.extras||[]).map(extra=>typeof extra.x==='number'&&typeof extra.width==='number'?extra.x+extra.width:0));
  const left=Math.min(...built.nodes.map(node=>node.x));
  const top=Math.min(...built.nodes.map(node=>node.y));
  const dx=base.nodes.length||base.extras?.length?oldRight+240-left:0;
  const dy=base.nodes.length||base.extras?.length?100-top:0;
  const nodes=built.nodes.map(node=>({...node,x:node.x+dx,y:node.y+dy}));
  const names=new Set((base.containers||[]).map(container=>container.name.toLowerCase()));
  const label={flowchart:'Flowchart',mindmap:'Mind map',hierarchy:'Org chart',architecture:'System architecture',brainstorming:'Ideas'}[kind];
  let index=1;
  while(names.has(`${label} ${index}`.toLowerCase()))index++;
  const container={id:newId(),name:`${label} ${index}`,nodeIds:nodes.map(node=>node.id),intentType:kind,...(kind==='mindmap'&&built.context.rootId?{rootId:built.context.rootId}:{})};
  return {...base,nodes:[...base.nodes,...nodes],edges:[...base.edges,...built.edges],containers:[...(base.containers||[]),container],recentIds:[...built.recentIds,...base.recentIds].slice(0,5),future:[]};
}
