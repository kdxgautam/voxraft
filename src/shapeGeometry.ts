import type {Node} from './scene';
import {cylinderCapHeight} from './cylinder';

type Point={x:number;y:number};
type Shape=Node['shape'];
const center=(node:Pick<Node,'x'|'y'|'width'|'height'>):Point=>({x:node.x+node.width/2,y:node.y+node.height/2});

export function shapeBoundary(node:Pick<Node,'shape'|'x'|'y'|'width'|'height'>,toward:Point):Point{
  const from=center(node),dx=toward.x-from.x,dy=toward.y-from.y;
  if(!dx&&!dy)return from;
  if(node.shape==='cylinder'){
    const rx=node.width/2,cap=cylinderCapHeight(node.height),ry=cap/2;
    const inside=(distance:number)=>{
      const px=dx*distance,py=node.height/2+dy*distance;
      if(Math.abs(px)>rx)return false;
      if(py<ry)return (px/rx)**2+((py-ry)/ry)**2<=1;
      if(py>node.height-ry)return (px/rx)**2+((py-(node.height-ry))/ry)**2<=1;
      return true;
    };
    let low=0,high=1;
    while(inside(high))high*=2;
    for(let i=0;i<36;i++){const mid=(low+high)/2;if(inside(mid))low=mid;else high=mid;}
    return {x:from.x+dx*low,y:from.y+dy*low};
  }
  const rx=node.width/2,ry=node.height/2;
  const denominator=node.shape==='ellipse'?Math.hypot(dx/rx,dy/ry)
    :node.shape==='diamond'?Math.abs(dx)/rx+Math.abs(dy)/ry
    :Math.max(Math.abs(dx)/rx,Math.abs(dy)/ry);
  return {x:from.x+dx/denominator,y:from.y+dy/denominator};
}

function interior(node:Pick<Node,'shape'|'width'|'height'>){
  return node.shape==='diamond'?{width:node.width*.50-16,height:node.height*.48-12}
    :node.shape==='ellipse'?{width:node.width*.69-16,height:node.height*.68-12}
    :node.shape==='cylinder'?{width:node.width-28,height:node.height-cylinderCapHeight(node.height)-12}
    :{width:node.width-28,height:node.height-16};
}

function wrap(text:string,capacity:number):string[]{
  const lines:string[]=[];
  for(const paragraph of text.split('\n')){
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      if(line&&line.length+1+word.length<=capacity){line+=` ${word}`;continue;}
      if(line){lines.push(line);line='';}
      for(let start=0;start+capacity<word.length;start+=capacity)lines.push(word.slice(start,start+capacity));
      line=word.slice(Math.floor((word.length-1)/capacity)*capacity);
    }
    lines.push(line);
  }
  return lines;
}

export function nodeLabelLayout(node:Pick<Node,'shape'|'x'|'y'|'width'|'height'|'label'>){
  const area=interior(node);
  for(let fontSize=16;fontSize>=5;fontSize--){
    const capacity=Math.max(1,Math.floor(Math.max(8,area.width)/(fontSize*.62)));
    const lines=wrap(node.label,capacity);
    if(lines.length*fontSize*1.25<=Math.max(8,area.height)||fontSize===5)
      return {x:node.x+node.width/2,y:node.y+node.height/2,width:Math.max(8,area.width),height:Math.max(8,area.height),fontSize,lines,text:lines.join('\n')};
  }
  throw new Error('Text layout failed');
}

export function nodeDimensions(label:string,shape:Shape){
  const width=Math.max(shape==='diamond'?300:shape==='ellipse'?250:220,
    Math.min(shape==='diamond'?420:shape==='ellipse'?360:300,label.length*(shape==='diamond'?11:9)+40));
  const minimumHeight=shape==='diamond'?150:shape==='ellipse'?110:shape==='cylinder'?112:82;
  const sample={shape,x:0,y:0,width,height:minimumHeight,label};
  const layout=nodeLabelLayout(sample);
  const lines=layout.lines.length;
  const height=Math.max(minimumHeight,Math.ceil((lines*20+24)/(shape==='diamond'?.48:shape==='ellipse'?.68:1))+(shape==='cylinder'?cylinderCapHeight(minimumHeight):0));
  return {width,height};
}

export function resizeForShape(node:Node,shape:Shape):Node{
  const minimum=nodeDimensions(node.label,shape);
  const width=Math.max(node.width,minimum.width),height=Math.max(node.height,minimum.height);
  return {...node,shape,x:node.x-(width-node.width)/2,y:node.y-(height-node.height)/2,width,height};
}
