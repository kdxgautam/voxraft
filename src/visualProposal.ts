import {styleScene,type Node,type Scene} from './scene';

export type VisualStyle={color:string;fontFamily:2|3};
export type VisualResult={mode:'agent'|'rules';tools_used:string[];summary:string;node_styles:Record<string,VisualStyle>;edge_styles:Record<string,VisualStyle>;shape_suggestions?:Record<string,{shape:Node['shape'];reason:string}>;container_styles?:Record<string,{color:string}>;boundary_questions?:string[];roles:{id:string;label:string;role:string;group:string}[]};

export function applyVisualProposal(scene:Scene,result:VisualResult,allowExplicitShapes=false,applyStyles=true):Scene{
  const valid=(styles:Record<string,VisualStyle>,ids:string[])=>{
    const expected=new Set(ids);
    if(Object.keys(styles).length!==expected.size||Object.keys(styles).some(id=>!expected.has(id)))throw new Error('Visual proposal does not match this diagram.');
    for(const id of ids){const style=styles[id];if(!style||!/^#[0-9a-f]{6}$/i.test(style.color)||![2,3].includes(style.fontFamily))throw new Error('Visual proposal contains an invalid style.');}
  };
  valid(result.node_styles,scene.nodes.map(node=>node.id));
  valid(result.edge_styles,scene.edges.map(edge=>edge.id));
  const containerStyles=result.container_styles||{};
  const ids=new Set((scene.containers||[]).map(container=>container.id));
  if(Object.entries(containerStyles).some(([id,style])=>!ids.has(id)||!/^#[0-9a-f]{6}$/i.test(style.color)))throw new Error('Visual proposal contains an invalid container style.');
  const shapes=result.shape_suggestions||{};
  for(const [id,suggestion] of Object.entries(shapes)){
    const node=scene.nodes.find(item=>item.id===id);
    if(!node||!suggestion||!['rectangle','ellipse','diamond','cylinder'].includes(suggestion.shape)||typeof suggestion.reason!=='string'||!suggestion.reason.trim()||suggestion.reason.length>240)throw new Error('Visual proposal contains an invalid shape suggestion.');
    if(!allowExplicitShapes&&(node.shapeSource==='explicit'||!node.shapeSource&&node.shape!=='rectangle'))throw new Error('Visual proposal would replace a user-chosen shape.');
  }
  return styleScene(scene,applyStyles?result.node_styles:{},applyStyles?result.edge_styles:{},applyStyles?containerStyles:{},shapes);
}
