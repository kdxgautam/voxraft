import {describe,expect,it} from 'vitest';
import {containerBounds,emptyScene,execute,moveFromCanvas,syncCanvas,type CanvasElement} from './scene';
import {readProject,writeProject} from './project';
import {resolvePlannedActions} from './targetResolver';
import {appendGeneratedDiagram} from './generatedDiagram';
import {containerView,routeNodesForEdge} from './containerView';
import {routeEdge} from './edgeRouting';

function diagram(){return execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Orders'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Database'}]);}

describe('visible containers',()=>{
  it('creates a real boundary, moves children as one edit, and follows a dragged child',()=>{
    const initial=diagram();
    const scene=execute(initial,[{type:'CREATE_CONTAINER',name:'Backend cluster',targets:['Auth','Orders']}]);
    const container=scene.containers![0],before=containerBounds(scene,container);
    expect(container.nodeIds).toEqual(initial.nodes.slice(0,2).map(node=>node.id));
    expect(before.x).toBe(Math.min(...initial.nodes.slice(0,2).map(node=>node.x))-40);
    const moved=execute(scene,[{type:'MOVE_CONTAINER',container:'Backend cluster',direction:'below'}]);
    expect(moved.nodes[0].y).toBe(scene.nodes[0].y+160);
    expect(moved.nodes[1].y).toBe(scene.nodes[1].y+160);
    expect(moved.nodes[2].y).toBe(scene.nodes[2].y);
    expect(moved.edges).toEqual(scene.edges);
    expect(execute(moved,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
    const dragged=moveFromCanvas(scene,{[scene.nodes[0].id]:{x:scene.nodes[0].x+100,y:scene.nodes[0].y}});
    expect(containerBounds(dragged,dragged.containers![0]).width).toBeLessThan(before.width);
  });
  it('adds, removes, renames, and dissolves without deleting blocks or arrows',()=>{
    let scene=execute(diagram(),[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth']}]);
    scene=execute(scene,[{type:'ADD_TO_CONTAINER',container:'Backend',targets:['Orders']}]);
    expect(scene.containers![0].nodeIds).toHaveLength(2);
    const unrelated=execute(scene,[{type:'CREATE_CONTAINER',name:'Other',targets:['Database']}]);
    expect(()=>execute(unrelated,[{type:'ADD_TO_CONTAINER',container:'Other',targets:['Auth']}])).toThrow(/one container/);
    scene=execute(scene,[{type:'RENAME_CONTAINER',container:'Backend',name:'App tier'}]);
    scene=execute(scene,[{type:'REMOVE_FROM_CONTAINER',container:'App tier',targets:['Orders']}]);
    expect(scene.containers![0].nodeIds).toHaveLength(1);
    const dissolved=execute(scene,[{type:'DELETE_CONTAINER',container:'App tier'}]);
    expect(dissolved.containers).toHaveLength(0);
    expect(dissolved.nodes).toEqual(scene.nodes);
    expect(dissolved.edges).toEqual(scene.edges);
    expect(execute(dissolved,[{type:'UNDO'}]).containers![0].name).toBe('App tier');
  });
  it('accepts selected blocks and reuses an existing container for put inside',()=>{
    const scene=diagram(),ids=scene.nodes.slice(0,2).map(node=>node.id);
    const actions=resolvePlannedActions(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['these']}],'Put these inside Backend',null,ids);
    const created=execute(scene,actions);
    expect(created.containers![0].nodeIds).toEqual(ids);
    const more=resolvePlannedActions(created,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Database']}],'Put Database inside Backend',null,[]);
    expect(more[0].type).toBe('ADD_TO_CONTAINER');
    expect(execute(created,more).containers![0].nodeIds).toHaveLength(3);
    const parent=resolvePlannedActions(created,[{type:'CREATE_CONTAINER',name:'Platform',targets:[created.containers![0].id],childContainers:[]}],'Create platform container containing backend container',null,[]);
    const nested=execute(created,parent);
    expect(nested.containers![0].parentId).toBe(nested.containers![1].id);
  });
  it('creates a nested container from generated region blocks and can add more parent blocks',()=>{
    let scene=appendGeneratedDiagram(emptyScene(),[
      {type:'ADD_NODE',label:'Auth'},
      {type:'ADD_NODE',label:'Orders'},
      {type:'ADD_NODE',label:'Database'},
      {type:'ADD_EDGE',source:'Auth',target:'Database'},
    ],'architecture','Online store');
    const original=scene;
    const actions=resolvePlannedActions(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth','Orders']}],'Put Auth and Orders inside Backend',null,[]);
    scene=execute(scene,actions);
    const region=scene.containers!.find(item=>item.name==='System architecture 1')!;
    const backend=scene.containers!.find(item=>item.name==='Backend')!;
    expect(backend.parentId).toBe(region.id);
    expect(region.nodeIds).toEqual([scene.nodes[2].id]);
    expect(backend.nodeIds).toEqual(scene.nodes.slice(0,2).map(node=>node.id));
    expect(readProject(writeProject(scene,[],'')).scene.containers).toEqual(scene.containers);
    expect(execute(scene,[{type:'UNDO'}]).containers).toEqual(original.containers);
    scene=execute(scene,[{type:'ADD_TO_CONTAINER',container:'Backend',targets:['Database']}]);
    expect(scene.containers!.find(item=>item.name==='Backend')!.nodeIds).toHaveLength(3);
    expect(scene.containers!.find(item=>item.name==='System architecture 1')).toBeDefined();
  });
  it('round trips membership and ignores the rendered frame during canvas sync',()=>{
    const scene=execute(diagram(),[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth','Orders']}]);
    const restored=readProject(writeProject(scene,[],'')).scene;
    expect(restored.containers).toEqual(scene.containers);
    const invalid=JSON.parse(writeProject(scene,[],''));
    invalid.scene.containers.push({id:'other',name:'Other',nodeIds:[scene.nodes[0].id]});
    expect(()=>readProject(JSON.stringify(invalid))).toThrow(/invalid containers/);
    const frame:CanvasElement={id:`container:${scene.containers![0].id}`,type:'rectangle',x:0,y:0,width:800,height:500,strokeColor:'#abc'};
    const elements:CanvasElement[]=[frame,...scene.nodes.flatMap(node=>[
      {id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color},
      {id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:100,height:20,strokeColor:'#000',text:node.label},
    ]),{id:scene.edges[0].id,type:'arrow',x:0,y:0,width:100,height:0,strokeColor:'#000'}];
    const synced=syncCanvas(scene,elements);
    expect(synced.nodes).toHaveLength(3);
    expect((synced.extras||[]).some(item=>item.id===frame.id)).toBe(false);
    expect(synced.containers).toEqual(scene.containers);
  });
  it('nests, collapses, routes external edges through the visible boundary, and preserves hidden edits',()=>{
    let scene=execute(diagram(),[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth','Orders']}]);
    scene=execute(scene,[{type:'CREATE_CONTAINER',name:'Platform',targets:[],childContainers:['Backend']}]);
    const backend=scene.containers![0],platform=scene.containers![1];
    expect(backend.parentId).toBe(platform.id);
    expect(()=>execute(scene,[{type:'NEST_CONTAINER',container:'Platform',parent:'Backend'}])).toThrow(/cycle/);
    expect(readProject(writeProject(scene,[],'')).scene.containers).toEqual(scene.containers);
    const collapsed=execute(scene,[{type:'SET_CONTAINER_COLLAPSED',container:'Backend',collapsed:true}]);
    const view=containerView(collapsed);
    expect(view.nodes.map(node=>node.label)).toEqual(['Database']);
    expect(view.frames).toHaveLength(2);
    expect(view.edges[0].sourceId).toBe(`container:${backend.id}`);
    const bounds=containerBounds(collapsed,backend);
    const raw:CanvasElement[]=[{id:`container:${platform.id}`,type:'rectangle',...containerBounds(collapsed,platform),strokeColor:'#aaa'},
      {id:`container:${backend.id}`,type:'rectangle',...bounds,x:bounds.x+120,strokeColor:'#aaa'},
      {id:scene.nodes[2].id,type:'rectangle',x:scene.nodes[2].x,y:scene.nodes[2].y,width:scene.nodes[2].width,height:scene.nodes[2].height,strokeColor:scene.nodes[2].color},
      {id:`${scene.nodes[2].id}:label`,type:'text',x:0,y:0,width:40,height:20,strokeColor:'#000',text:'Database'},
      {id:scene.edges[0].id,type:'arrow',x:0,y:0,width:100,height:0,strokeColor:'#000',startBinding:{elementId:`container:${backend.id}`}}];
    const synced=syncCanvas(collapsed,raw);
    expect(synced.nodes[0].x).toBe(scene.nodes[0].x+120);
    expect(synced.nodes[1].x).toBe(scene.nodes[1].x+120);
    expect(synced.edges).toEqual(scene.edges);
    expect(execute(synced,[{type:'UNDO'}]).nodes).toEqual(collapsed.nodes);
    expect(execute(collapsed,[{type:'SET_CONTAINER_COLLAPSED',container:'Platform',collapsed:true}]).containers).toHaveLength(2);
    const invalid=JSON.parse(writeProject(scene,[],''));
    invalid.scene.containers[1].parentId=backend.id;
    expect(()=>readProject(JSON.stringify(invalid))).toThrow(/cycle/);
  });
  it('uses unrelated expanded boundaries as routing obstacles',()=>{
    let scene=execute(diagram(),[{type:'CREATE_CONTAINER',name:'Orders tier',targets:['Orders']}]);
    scene=moveFromCanvas(scene,{[scene.nodes[0].id]:{x:80,y:100},[scene.nodes[1].id]:{x:390,y:175},[scene.nodes[2].id]:{x:700,y:100}});
    const view=containerView(scene),edge=view.edges[0];
    const route=routeEdge({nodes:routeNodesForEdge(scene,view,edge),edges:view.edges},edge);
    expect(route.points.length).toBeGreaterThan(2);
  });
});
