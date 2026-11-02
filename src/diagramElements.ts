import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { Scene } from './scene';
import { containerView,routeNodesForEdge } from './containerView';
import { routeEdge } from './edgeRouting';
import { edgeStyle } from './edgeStyle';
import { nodeLabelLayout } from './shapeGeometry';
import { cylinderCanvasElements } from './cylinder';
import {nodeFill,nodeTextColor} from './nodeAppearance';

export function toElements(scene:Pick<Scene,'nodes'|'edges'|'containers'|'extras'>){
  const view=containerView(scene);
  const containers=view.frames.flatMap(({container,bounds})=>{const color=container.color||'#8aa6d2';return [
    {type:'rectangle',id:`container:${container.id}`,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,strokeColor:color,backgroundColor:'#eaf2ff',fillStyle:'solid',strokeStyle:container.collapsed?'solid':'dashed',strokeWidth:2,opacity:container.collapsed?90:65,roundness:{type:3}},
    {type:'text',id:`container:${container.id}:label`,x:bounds.x+14,y:bounds.y+11,width:Math.min(bounds.width-28,Math.max(90,container.name.length*9)),height:26,text:`${container.collapsed?'▸ ':'▾ '}${container.name}`,fontSize:16,fontFamily:2,strokeColor:'#34547f',locked:true}
  ];});
  const nodes=view.nodes.flatMap(n=>{const label=nodeLabelLayout(n);const groupIds=n.shape==='cylinder'?[`cylinder:${n.id}`]:[];const text={type:'text',id:`${n.id}:label`,x:label.x,y:label.y,width:label.width,height:label.height,text:label.text,originalText:n.label,autoResize:false,fontSize:label.fontSize,fontFamily:n.fontFamily||2,textAlign:'center',verticalAlign:'middle',strokeColor:nodeTextColor(n.fillColor),groupIds};
    if(n.shape==='cylinder'){
      return [...cylinderCanvasElements(n),text];
    }
    return [{type:n.shape,id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,strokeColor:n.color,backgroundColor:nodeFill(n),fillStyle:'solid',strokeWidth:2,roundness:n.shape==='rectangle'?{type:3}:null,groupIds},text];});
  const edges=view.edges.flatMap(e=>{const {x,y,tx,ty,points,labelX,labelY}=routeEdge({nodes:routeNodesForEdge(scene,view,e),edges:view.edges},e);const style=edgeStyle(e),styled=e.fontFamily===3;const arrow={type:'arrow',id:e.id,x,y,width:tx-x,height:ty-y,points,strokeColor:style.stroke,strokeWidth:2,endArrowhead:e.endArrowhead===undefined?'arrow':e.endArrowhead};if(!e.label)return [arrow];const width=Math.min(240,Math.max(56,e.label.length*(styled?9.5:8)+20));return [arrow,{type:'text',id:`${e.id}:label`,x:labelX-width/2,y:labelY-(styled?30:24),width,height:styled?28:24,text:e.label,fontSize:styled?16:14,fontFamily:e.fontFamily||2,textAlign:'center',verticalAlign:'middle',strokeColor:style.text,backgroundColor:'#ffffff'}];});
  // Canvas selection and drag edits must map back to canonical scene IDs.
  return [...convertToExcalidrawElements([...containers,...edges,...nodes] as Parameters<typeof convertToExcalidrawElements>[0],{regenerateIds:false}),...(scene.extras||[])] as ReturnType<typeof convertToExcalidrawElements>;
}
