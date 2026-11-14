import { type Scene } from './scene';
import { containerView,routeNodesForEdge } from './containerView';
import { routeEdge } from './edgeRouting';
import { edgeStyle } from './edgeStyle';
import {nodeLabelLayout} from './shapeGeometry';
import {cylinderCapHeight} from './cylinder';
import {nodeFill,nodeTextColor} from './nodeAppearance';

export type LayoutResult={
  mode:'agent'|'rules';tools_used:string[];selected:'current'|'layered'|'grid'|'tree'|'flow'|'scoped';summary:string;
  scores:Record<string,{score:number;overlaps:number;obstructions:number;crossings:number;backward_edges:number;edge_length:number;spread:number}>;
  positions:Record<string,{x:number;y:number}>|null;
};

export function verifiedPositions(scene:Scene,result:LayoutResult):Record<string,{x:number;y:number}>|null{
  if(result.selected==='current'||!result.positions)return null;
  const positions=result.positions;
  const ids=new Set(scene.nodes.map(node=>node.id));
  if(Object.keys(positions).length!==ids.size||Object.keys(positions).some(id=>!ids.has(id)))throw new Error('Layout proposal has unknown or missing blocks.');
  for(const id of ids){
    const point=positions[id];
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>100000||Math.abs(point.y)>100000)throw new Error('Layout proposal has an invalid position.');
  }
  return positions;
}

export function LayoutPreview({scene,positions}:{scene:Scene;positions:Record<string,{x:number;y:number}>}){
  const positioned={...scene,nodes:scene.nodes.map(node=>({...node,...positions[node.id]}))};
  const view=containerView(positioned);
  const {nodes,frames}=view;
  const routes=view.edges.map(edge=>({edge,route:routeEdge({nodes:routeNodesForEdge(positioned,view,edge),edges:view.edges},edge)}));
  const xs=[...nodes.flatMap(node=>[node.x,node.x+node.width]),...frames.flatMap(({bounds})=>[bounds.x,bounds.x+bounds.width]),...routes.flatMap(({route})=>route.points.map(([px])=>route.x+px))];
  const ys=[...nodes.flatMap(node=>[node.y,node.y+node.height]),...frames.flatMap(({bounds})=>[bounds.y,bounds.y+bounds.height]),...routes.flatMap(({route})=>route.points.map(([,py])=>route.y+py))];
  const minX=Math.min(...xs),minY=Math.min(...ys);
  const width=Math.max(200,Math.max(...xs)-minX+40),height=Math.max(100,Math.max(...ys)-minY+40);
  return <svg className="layout-preview" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Proposed diagram layout preview" preserveAspectRatio="xMidYMid meet">
    {frames.map(({container,bounds})=><g key={container.id}><rect x={bounds.x-minX+20} y={bounds.y-minY+20} width={bounds.width} height={bounds.height} rx="10" fill="#eaf2ff" stroke={container.color||'#8aa6d2'} strokeWidth="2" strokeDasharray={container.collapsed?undefined:'7 5'}/><text x={bounds.x-minX+34} y={bounds.y-minY+45} fontSize="16" fill="#34547f">{container.collapsed?'▸':'▾'} {container.name}</text></g>)}
    <defs>{routes.map(({edge},index)=><marker key={edge.id} id={`layout-preview-arrow-${index}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke={edgeStyle(edge).stroke} strokeWidth="1.5"/></marker>)}</defs>
    {routes.map(({edge,route},index)=><polyline key={edge.id} points={route.points.map(([px,py])=>`${route.x+px-minX+20},${route.y+py-minY+20}`).join(' ')} fill="none" stroke={edgeStyle(edge).stroke} strokeWidth="2" markerEnd={edge.endArrowhead===null?undefined:`url(#layout-preview-arrow-${index})`}/>)}
    {routes.filter(({edge})=>edge.label).map(({edge,route})=><text key={`${edge.id}:label`} x={route.labelX-minX+20} y={route.labelY-minY+5} textAnchor="middle" fontSize={edge.fontFamily===3?16:14} fontFamily={edge.fontFamily===3?'monospace':'sans-serif'} fill={edgeStyle(edge).text}>{edge.label}</text>)}
    {nodes.map(node=>{const x=node.x-minX+20,y=node.y-minY+20,cx=x+node.width/2,cy=y+node.height/2,label=nodeLabelLayout(node),fill=nodeFill(node);return <g key={node.id}>
      {node.shape==='cylinder'?<g><rect x={x} y={y+cylinderCapHeight(node.height)/2} width={node.width} height={node.height-cylinderCapHeight(node.height)} fill={fill} stroke={node.color} strokeWidth="2"/><ellipse cx={cx} cy={y+node.height-cylinderCapHeight(node.height)/2} rx={node.width/2} ry={cylinderCapHeight(node.height)/2} fill={fill} stroke={node.color} strokeWidth="2"/><ellipse cx={cx} cy={y+cylinderCapHeight(node.height)/2} rx={node.width/2} ry={cylinderCapHeight(node.height)/2} fill={fill} stroke={node.color} strokeWidth="2"/></g>
        :node.shape==='ellipse'?<ellipse cx={cx} cy={cy} rx={node.width/2} ry={node.height/2} fill={fill} stroke={node.color} strokeWidth="2"/>
        :node.shape==='diamond'?<polygon points={`${cx},${y} ${x+node.width},${cy} ${cx},${y+node.height} ${x},${cy}`} fill={fill} stroke={node.color} strokeWidth="2"/>
        :<rect x={x} y={y} width={node.width} height={node.height} rx="9" fill={fill} stroke={node.color} strokeWidth="2"/>}
      <text x={cx} y={cy-(label.lines.length-1)*label.fontSize*.625} textAnchor="middle" dominantBaseline="middle" fontSize={label.fontSize} fontFamily={node.fontFamily===3?'monospace':'sans-serif'} fill={nodeTextColor(node.fillColor)}>{label.lines.map((line,index)=><tspan key={index} x={cx} dy={index?label.fontSize*1.25:0}>{line}</tspan>)}</text>
    </g>;})}
  </svg>;
}
