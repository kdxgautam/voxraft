import type {Edge,Node,Scene} from './scene';
import {shapeBoundary} from './shapeGeometry';

export function routeEdge(scene:Pick<Scene,'nodes'> & Partial<Pick<Scene,'edges'>>,edge:Edge){
  const source=scene.nodes.find(node=>node.id===edge.sourceId)!;
  const target=scene.nodes.find(node=>node.id===edge.targetId)!;
  const dx=(target.x+target.width/2)-(source.x+source.width/2);
  const dy=(target.y+target.height/2)-(source.y+source.height/2);
  const horizontal=Math.abs(dx)>=Math.abs(dy);
  const x=horizontal?source.x+(dx>=0?source.width:0):source.x+source.width/2;
  const y=horizontal?source.y+source.height/2:source.y+(dy>=0?source.height:0);
  let tx=horizontal?target.x+(dx>=0?0:target.width):target.x+target.width/2;
  let ty=horizontal?target.y+target.height/2:target.y+(dy>=0?0:target.height);
  const between=(node:Node)=>node.id!==source.id&&node.id!==target.id
    &&node.x<Math.max(x,tx)&&node.x+node.width>Math.min(x,tx)
    &&node.y<Math.max(y,ty)+6&&node.y+node.height>Math.min(y,ty)-6;
  const points:[number,number][]= [[0,0],[tx-x,ty-y]];
  let labelX=(x+tx)/2,labelY=(y+ty)/2;
  const blocked=scene.nodes.some(between);
  if(!blocked&&horizontal&&dx>0){
    const incoming=(scene.edges||[edge]).filter(candidate=>candidate.targetId===target.id)
      .map(candidate=>({candidate,node:scene.nodes.find(node=>node.id===candidate.sourceId)}))
      .filter((item):item is {candidate:Edge;node:Node}=>!!item.node&&item.node.x+item.node.width<=target.x)
      .sort((a,b)=>(a.node.y+a.node.height/2)-(b.node.y+b.node.height/2)||a.node.x-b.node.x);
    if(incoming.length>1){
      const index=incoming.findIndex(item=>item.candidate.id===edge.id);
      if(index>=0){ty=target.y+target.height*(index+1)/(incoming.length+1);points[1]=[tx-x,ty-y];labelY=(y+ty)/2;}
    }
  }
  if(blocked){
    const stub=Math.min(14,Math.abs(horizontal?tx-x:ty-y)/3);
    if(horizontal){
      const corridor=scene.nodes.filter(node=>node.x<Math.max(x,tx)+stub&&node.x+node.width>Math.min(x,tx)-stub);
      const top=Math.min(...corridor.map(node=>node.y))-30;
      const bottom=Math.max(...corridor.map(node=>node.y+node.height))+30;
      const lane=Math.abs(y-top)+Math.abs(ty-top)<=Math.abs(y-bottom)+Math.abs(ty-bottom)?top:bottom;
      if(dx>0){
        // Long incoming arrows use separate lanes and top/bottom anchors. The
        // farthest source gets the outer lane and the farthest target anchor,
        // so routes cannot collapse into one line before reaching the block.
        const incoming=(scene.edges||[edge]).filter(candidate=>candidate.targetId===target.id&&candidate.sourceId!==target.id)
          .map(candidate=>({candidate,node:scene.nodes.find(node=>node.id===candidate.sourceId)}))
          .filter((item):item is {candidate:Edge;node:Node}=>!!item.node&&item.node.x+item.node.width<=target.x)
          .filter(({node})=>scene.nodes.some(block=>block.id!==node.id&&block.id!==target.id
            &&block.x<target.x&&block.x+block.width>node.x+node.width
            &&block.y<node.y+node.height/2+6&&block.y+block.height>node.y+node.height/2-6))
          .sort((a,b)=>a.node.x-b.node.x);
        const index=Math.max(0,incoming.findIndex(item=>item.candidate.id===edge.id));
        const count=Math.max(1,incoming.length);
        const labeled=incoming.some(item=>item.candidate.label);
        const useTop=labeled?false:count>1?index%2===0:lane===top;
        tx=target.x+target.width*(count-index)/(count+1);
        ty=useTop?target.y:target.y+target.height;
        const separatedLane=(useTop?top:bottom+(labeled?30:0))+(useTop?-1:1)*(labeled?count-index-1:Math.floor(index/2))*(labeled?44:22);
        const start=Math.sign(tx-x)*stub;
        points.splice(1,points.length-1,[start,0],[start,separatedLane-y],[tx-x,separatedLane-y],[tx-x,ty-y]);
        labelX=(x+tx)/2;labelY=separatedLane;
      }else{
        const start=Math.sign(tx-x)*stub,end=tx-x-start;
        points.splice(1,0,[start,0],[start,lane-y],[end,lane-y],[end,ty-y]);
        labelY=lane;
      }
    }else{
      const corridor=scene.nodes.filter(node=>node.y<Math.max(y,ty)+stub&&node.y+node.height>Math.min(y,ty)-stub);
      const left=Math.min(...corridor.map(node=>node.x))-30;
      const right=Math.max(...corridor.map(node=>node.x+node.width))+30;
      const lane=Math.abs(x-left)+Math.abs(tx-left)<=Math.abs(x-right)+Math.abs(tx-right)?left:right;
      const start=Math.sign(ty-y)*stub,end=ty-y-start;
      points.splice(1,0,[0,start],[lane-x,start],[lane-x,end],[tx-x,end]);
      labelX=lane;
    }
  }
  if(source.shape==='rectangle'&&target.shape==='rectangle')return {x,y,tx,ty,points,labelX,labelY};
  const absolute=points.map(([px,py])=>({x:x+px,y:y+py}));
  const first=absolute.length===2?{x:target.x+target.width/2,y:target.y+target.height/2}:absolute[1];
  const last=absolute.length===2?{x:source.x+source.width/2,y:source.y+source.height/2}:absolute.at(-2)!;
  if(source.shape!=='rectangle')absolute[0]=shapeBoundary(source,first);
  if(target.shape!=='rectangle')absolute[absolute.length-1]=shapeBoundary(target,last);
  const start=absolute[0],end=absolute.at(-1)!;
  if(absolute.length===2){labelX=(start.x+end.x)/2;labelY=(start.y+end.y)/2;}
  return {x:start.x,y:start.y,tx:end.x,ty:end.y,points:absolute.map(point=>[point.x-start.x,point.y-start.y] as [number,number]),labelX,labelY};
}
