import type {Node} from './scene';
import {nodeFill} from './nodeAppearance';

export const cylinderCapHeight=(height:number)=>Math.min(36,Math.max(22,height*.28));
export const cylinderPartId=(id:string,part:'top'|'bottom')=>`${id}:cylinder:${part}`;

export function cylinderParts(node:Node){
  const cap=cylinderCapHeight(node.height);
  return {
    body:{x:node.x,y:node.y+cap/2,width:node.width,height:node.height-cap},
    top:{x:node.x,y:node.y,width:node.width,height:cap},
    bottom:{x:node.x,y:node.y+node.height-cap,width:node.width,height:cap},
  };
}

export function cylinderCanvasElements(node:Node){
  const parts=cylinderParts(node),groupIds=[`cylinder:${node.id}`];
  const common={strokeColor:node.color,backgroundColor:nodeFill(node),fillStyle:'solid',strokeWidth:2,groupIds};
  return [
    {type:'rectangle',id:node.id,...parts.body,...common,roundness:null},
    {type:'ellipse',id:cylinderPartId(node.id,'bottom'),...parts.bottom,...common},
    {type:'ellipse',id:cylinderPartId(node.id,'top'),...parts.top,...common},
  ];
}

export function cylinderOwner(nodes:readonly Node[],elementId:string):string|null{
  const owner=nodes.find(node=>node.shape==='cylinder'&&
    (elementId===node.id||elementId===`${node.id}:label`||
     elementId===cylinderPartId(node.id,'top')||elementId===cylinderPartId(node.id,'bottom')));
  return owner?.id||null;
}
