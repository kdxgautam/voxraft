import {describe,expect,it} from 'vitest';
import {emptyScene,execute,syncCanvas,type CanvasElement} from './scene';
import {readProject,writeProject} from './project';

describe('diagram intent and mind-map ancestry',()=>{
  it('commits type, central topic, and branches as one undoable command',()=>{
    const blank=emptyScene();
    let scene=execute(blank,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap',purpose:'Food delivery',source:'explicit'},
      {type:'ADD_NODE',label:'Food delivery'}]);
    const root=scene.nodes[0];
    expect(scene.context).toMatchObject({type:'mindmap',purpose:'Food delivery',rootId:root.id});
    expect(root).toMatchObject({shape:'ellipse',shapeSource:'intent'});
    expect(execute(scene,[{type:'UNDO'}]).context.type).toBeNull();
    scene=execute(scene,[{type:'ADD_NODE',label:'Features'},{type:'ADD_EDGE',source:root.id,target:'Features',relation:'branch'}]);
    const features=scene.nodes[1];
    const rootBefore={x:root.x,y:root.y};
    scene=execute(scene,[{type:'ADD_NODE',label:'PostgreSQL'},{type:'ADD_EDGE',source:features.id,target:'PostgreSQL',relation:'branch'}]);
    expect(scene.nodes[2].shape).toBe('rectangle');
    expect(scene.nodes[0]).toMatchObject(rootBefore);
    expect(scene.edges.every(edge=>edge.relation==='branch'&&edge.endArrowhead===null)).toBe(true);
    expect(scene.edges[1].sourceId).toBe(features.id);
    expect(readProject(writeProject(scene,[],'' )).scene).toMatchObject({context:scene.context,edges:scene.edges});
  });
  it('reparents atomically, rejects a cycle, and leaves children unattached on deletion',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'}, {type:'ADD_NODE',label:'Root'},
      {type:'ADD_NODE',label:'A'},{type:'ADD_EDGE',source:'Root',target:'A',relation:'branch'},
      {type:'ADD_NODE',label:'B'},{type:'ADD_EDGE',source:'A',target:'B',relation:'branch'},
      {type:'ADD_NODE',label:'C'},{type:'ADD_EDGE',source:'Root',target:'C',relation:'branch'}]);
    const before=scene;
    expect(()=>execute(scene,[{type:'REPARENT_BRANCH',target:'A',parent:'B'}])).toThrow(/cycle/);
    expect(scene).toBe(before);
    scene=execute(scene,[{type:'REPARENT_BRANCH',target:'B',parent:'C'}]);
    expect(scene.edges.find(edge=>edge.targetId===scene.nodes[2].id)?.sourceId).toBe(scene.nodes[3].id);
    scene=execute(scene,[{type:'DELETE_NODE',target:'C'}]);
    expect(scene.nodes.some(node=>node.label==='B')).toBe(true);
    expect(scene.edges.some(edge=>edge.targetId===scene.nodes.find(node=>node.label==='B')?.id)).toBe(false);
  });
  it('moves a reparented mind-map topic and its subtopics beside the new parent',()=>{
    let scene=execute(emptyScene(),[
      {type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'},
      {type:'ADD_NODE',label:'Launch'},
      {type:'ADD_NODE',label:'Research'},
      {type:'ADD_NODE',label:'Release'},
      {type:'ADD_NODE',label:'Pricing'},
      {type:'ADD_NODE',label:'Plans'},
      {type:'ADD_EDGE',source:'Launch',target:'Research',relation:'branch'},
      {type:'ADD_EDGE',source:'Launch',target:'Release',relation:'branch'},
      {type:'ADD_EDGE',source:'Research',target:'Pricing',relation:'branch'},
      {type:'ADD_EDGE',source:'Pricing',target:'Plans',relation:'branch'},
    ]);
    const pricing=scene.nodes.find(node=>node.label==='Pricing')!;
    const plans=scene.nodes.find(node=>node.label==='Plans')!;
    const before={x:plans.x-pricing.x,y:plans.y-pricing.y};
    scene=execute(scene,[{type:'REPARENT_BRANCH',target:'Pricing',parent:'Release'}]);
    const moved=scene.nodes.find(node=>node.label==='Pricing')!;
    const child=scene.nodes.find(node=>node.label==='Plans')!;
    const release=scene.nodes.find(node=>node.label==='Release')!;
    const root=scene.nodes.find(node=>node.label==='Launch')!;
    expect(Math.sign(moved.x-release.x)).toBe(Math.sign(release.x-root.x));
    expect({x:child.x-moved.x,y:child.y-moved.y}).toEqual(before);
    expect(scene.edges.find(edge=>edge.targetId===moved.id)?.sourceId).toBe(release.id);
  });
  it('keeps type on Clear but permits a new type on the empty canvas',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture',purpose:'Checkout'}, {type:'ADD_NODE',label:'PostgreSQL database'}]);
    expect(scene.nodes[0]).toMatchObject({shape:'cylinder',shapeSource:'intent'});
    const cleared=execute(scene,[{type:'CLEAR'}]);
    expect(cleared.context).toMatchObject({type:'architecture',purpose:'Checkout'});
    const changed=execute(cleared,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap',purpose:'Ideas'},{type:'ADD_NODE',label:'Main idea'}]);
    expect(changed.context).toMatchObject({type:'mindmap',purpose:'Ideas'});
    expect(changed.nodes[0].label).toBe('Main idea');
    expect(execute(changed,[{type:'UNDO'}]).context.type).toBe('architecture');
    const fresh=execute(scene,[{type:'NEW_DIAGRAM'}]);
    expect(fresh.context.type).toBeNull();
    expect(execute(fresh,[{type:'UNDO'}]).context).toEqual(scene.context);
  });
  it('maps manual arrows to associations and preserves their arrowheads',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'}, {type:'ADD_NODE',label:'Root'}, {type:'ADD_NODE',label:'Idea'}]);
    const elements:CanvasElement[]=[...scene.nodes.map(node=>({id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color})),
      {id:'manual',type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',endArrowhead:null,startBinding:{elementId:scene.nodes[0].id},endBinding:{elementId:scene.nodes[1].id}}];
    const synced=syncCanvas(scene,elements);
    expect(synced.edges[0]).toMatchObject({relation:'association',endArrowhead:null});
  });
  it('keeps ancestry valid when editing or inserting into a branch',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'}, {type:'ADD_NODE',label:'Root'},
      {type:'ADD_NODE',label:'Features'}, {type:'ADD_EDGE',source:'Root',target:'Features',relation:'branch'},
      {type:'ADD_NODE',label:'Payments'}]);
    expect(()=>execute(scene,[{type:'REVERSE_EDGE',source:'Root',target:'Features'}])).toThrow(/reparent|Move topic/i);
    const inserted=execute(scene,[{type:'INSERT_BETWEEN',label:'Ideas',source:'Root',target:'Features'}]);
    expect(inserted.edges.map(edge=>edge.relation)).toEqual(['branch','branch']);
    expect(inserted.edges.map(edge=>edge.endArrowhead)).toEqual([null,null]);
    const elements:CanvasElement[]=[...scene.nodes.map(node=>({id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color})),
      {id:scene.edges[0].id,type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',endArrowhead:null,
        startBinding:{elementId:scene.nodes[2].id},endBinding:{elementId:scene.nodes[1].id}}];
    expect(syncCanvas(scene,elements).edges[0].relation).toBe('association');
  });
  it('turns an existing association into a branch when parenthood is requested',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'}, {type:'ADD_NODE',label:'Root'},
      {type:'ADD_NODE',label:'Idea'}, {type:'ADD_EDGE',source:'Root',target:'Idea'}]);
    expect(scene.edges[0].relation).toBe('association');
    const edgeId=scene.edges[0].id;
    scene=execute(scene,[{type:'REPARENT_BRANCH',target:'Idea',parent:'Root'}]);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({id:edgeId,relation:'branch',endArrowhead:null});
  });
});
