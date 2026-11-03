import type {Edge} from './scene';

export function edgeStyle(edge:Edge){
  return edge.color?{stroke:edge.color,text:edge.color}:{stroke:'#73819b',text:'#334155'};
}
