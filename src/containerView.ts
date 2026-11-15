import {containerBounds,descendantNodeIds,hiddenNodeIds,visibleContainers,type Container,type Edge,type Node,type Scene} from './scene';

export type Frame={container:Container;bounds:ReturnType<typeof containerBounds>};
export function containerView(scene:Pick<Scene,'nodes'|'edges'|'containers'>){
  const containers=visibleContainers(scene);
  const frames:Frame[]=containers.filter(container=>!container.implicit||container.collapsed).map(container=>({container,bounds:containerBounds(scene,container)}));
  const hidden=hiddenNodeIds(scene);
  const nodes=scene.nodes.filter(node=>!hidden.has(node.id));
  const proxy=frames.filter(({container})=>container.collapsed).map(({container,bounds}):Node=>({id:`container:${container.id}`,label:container.name,shape:'rectangle',...bounds,color:container.color||'#8aa6d2'}));
  const collapsed=frames.filter(({container})=>container.collapsed).map(({container})=>({container,members:new Set(descendantNodeIds(scene,container))}));
  const endpoint=(id:string)=>hidden.has(id)?`container:${collapsed.find(item=>item.members.has(id))?.container.id}`:id;
  const edges:Edge[]=scene.edges.map(edge=>({...edge,sourceId:endpoint(edge.sourceId),targetId:endpoint(edge.targetId)})).filter(edge=>edge.sourceId!==edge.targetId);
  return {frames,nodes,proxy,routeNodes:[...nodes,...proxy],edges,hidden};
}

export function routeNodesForEdge(scene:Pick<Scene,'nodes'|'edges'|'containers'>,view:ReturnType<typeof containerView>,edge:Edge):Node[]{
  const original=scene.edges.find(item=>item.id===edge.id);
  const blockers=view.frames.filter(({container})=>!container.collapsed&&original&&!descendantNodeIds(scene,container).some(id=>id===original.sourceId||id===original.targetId))
    .map(({container,bounds}):Node=>({id:`boundary:${container.id}`,label:container.name,shape:'rectangle',...bounds,color:container.color||'#8aa6d2'}));
  return [...view.routeNodes,...blockers];
}
