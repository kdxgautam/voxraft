import {describe,expect,it} from 'vitest';
import {bindSelection,clarifyActions,emptyScene,execute,syncCanvas,type CanvasElement} from './scene';
import {readProject,writeProject} from './project';
import {resolvePlannedActions} from './targetResolver';

describe('semantic foundation',()=>{
  it('keeps undecided edits neutral and applies intent defaults only to new nodes',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'PostgreSQL'}]);
    expect(scene.nodes[0]).toMatchObject({shape:'rectangle',label:'PostgreSQL'});
    expect(scene.nodes[0].role).toBeUndefined();
    scene=execute(scene,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},{type:'ADD_NODE',label:'Orders database'}]);
    expect(scene.nodes[0].shape).toBe('rectangle');
    expect(scene.nodes[1]).toMatchObject({shape:'cylinder',role:'database',roleSource:'intent',shapeSource:'intent'});
    const untrusted=resolvePlannedActions(emptyScene(),[{type:'ADD_NODE',label:'PostgreSQL',shape:'cylinder',role:'database'}],'Add PostgreSQL',null);
    const neutral=execute(emptyScene(),untrusted).nodes[0];
    expect(neutral.shape).toBe('rectangle');
    expect(neutral.role).toBeUndefined();
  });

  it('stores explicit roles and distinct relationship meanings through history and save',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Checkout',role:'note'},
      {type:'ADD_NODE',label:'Pay',role:'process'}]);
    scene=execute(scene,[{type:'ADD_EDGE',source:'Checkout',target:'Pay',relation:'sequence'}]);
    expect(scene.nodes.map(node=>[node.role,node.roleSource])).toEqual([['note','explicit'],['process','explicit']]);
    const renamed=execute(scene,[{type:'UPDATE_NODE',target:'Pay',role:'decision'}]);
    expect(renamed.nodes[1]).toMatchObject({role:'decision',roleSource:'explicit',shape:'rectangle'});
    expect(scene.edges[0]).toMatchObject({relation:'sequence',relationSource:'explicit',endArrowhead:'arrow',arrowheadSource:'intent'});
    const restored=readProject(writeProject(scene,[],'' )).scene;
    expect(restored.edges[0]).toEqual(scene.edges[0]);
    scene=execute(scene,[{type:'UNDO'}]);
    expect(scene.edges).toHaveLength(0);
    expect(execute(scene,[{type:'REDO'}]).edges[0].relation).toBe('sequence');
  });

  it('enforces ancestry for parent–child edges and preserves manual arrow choices',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},{type:'ADD_NODE',label:'C'},
      {type:'ADD_EDGE',source:'A',target:'B',relation:'parent_child'},
      {type:'ADD_EDGE',source:'B',target:'C',relation:'parent_child'}]);
    expect(scene.edges.every(edge=>edge.endArrowhead===null)).toBe(true);
    expect(()=>execute(scene,[{type:'ADD_EDGE',source:'C',target:'A',relation:'parent_child'}])).toThrow(/cycle/);
    expect(()=>execute(scene,[{type:'ADD_EDGE',source:'A',target:'C',relation:'parent_child'}])).toThrow(/one parent/);
    const elements:CanvasElement[]=[...scene.nodes.map(node=>({id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color})),
      ...scene.edges.map(edge=>({id:edge.id,type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',endArrowhead:null,startBinding:{elementId:edge.sourceId},endBinding:{elementId:edge.targetId}})),
      {id:'manual',type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',endArrowhead:'arrow',startBinding:{elementId:scene.nodes[0].id},endBinding:{elementId:scene.nodes[2].id}}];
    scene=syncCanvas(scene,elements);
    expect(scene.edges.find(edge=>edge.id==='manual')).toMatchObject({relation:'association',relationSource:'manual',endArrowhead:'arrow',arrowheadSource:'manual'});
    expect(readProject(writeProject(scene,[],'' )).scene.edges.find(edge=>edge.id==='manual')?.relationSource).toBe('manual');
  });

  it('changes an existing edge meaning only on an explicit request',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},
      {type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},{type:'ADD_EDGE',source:'A',target:'B'}]);
    const id=scene.edges[0].id;
    scene=execute(scene,[{type:'ADD_EDGE',source:'A',target:'B',relation:'sequence'}]);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({id,relation:'sequence',relationSource:'explicit',endArrowhead:'arrow'});
    scene=execute(scene,[{type:'ADD_EDGE',source:'A',target:'B',relation:'association'}]);
    expect(scene.edges[0]).toMatchObject({id,relation:'association',endArrowhead:null});
  });

  it('treats a manually retargeted sequence as an association',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},{type:'ADD_NODE',label:'C'},
      {type:'ADD_EDGE',source:'A',target:'B',relation:'sequence'}]);
    const elements:CanvasElement[]=[...scene.nodes.map(node=>({id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color})),
      {id:scene.edges[0].id,type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',endArrowhead:'arrow',startBinding:{elementId:scene.nodes[0].id},endBinding:{elementId:scene.nodes[2].id}}];
    expect(syncCanvas(scene,elements).edges[0]).toMatchObject({relation:'association',relationSource:'manual',endArrowhead:'arrow',arrowheadSource:'manual'});
  });

  it('migrates old projects without changing their rendered arrowheads',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},
      {type:'ADD_EDGE',source:'A',target:'B',relation:'connection',arrowhead:'none'}]);
    const old=JSON.parse(writeProject(scene,[],''));
    old.version=1;
    delete old.scene.context;
    delete old.scene.edges[0].relation;
    delete old.scene.edges[0].relationSource;
    delete old.scene.edges[0].arrowheadSource;
    const migrated=readProject(JSON.stringify(old)).scene;
    expect(migrated.context).toMatchObject({type:'architecture',source:'legacy'});
    expect(migrated.edges[0]).toMatchObject({relation:'connection',relationSource:'legacy',endArrowhead:null,arrowheadSource:'legacy'});
  });

  it('reparents hierarchy nodes without moving unrelated nodes and preserves history',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'hierarchy'},
      {type:'ADD_NODE',label:'Engineering'},{type:'ADD_NODE',label:'Platform'},
      {type:'ADD_NODE',label:'API Team'},{type:'ADD_NODE',label:'Design'},
      {type:'ADD_EDGE',source:'Engineering',target:'Platform'}]);
    expect(execute(scene,[{type:'ADD_NODE',label:'PostgreSQL'}]).nodes.at(-1)).toMatchObject({shape:'rectangle',label:'PostgreSQL'});
    const original=Object.fromEntries(scene.nodes.map(node=>[node.label,{x:node.x,y:node.y}]));
    expect(scene.edges[0]).toMatchObject({relation:'parent_child',relationSource:'intent',endArrowhead:null});
    scene=execute(scene,[{type:'REPARENT_BRANCH',target:'Platform',parent:'API Team'}]);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]).toMatchObject({relation:'parent_child',relationSource:'explicit'});
    expect(Object.fromEntries(scene.nodes.map(node=>[node.label,{x:node.x,y:node.y}]))).toEqual(original);
    expect(()=>execute(scene,[{type:'REPARENT_BRANCH',target:'API Team',parent:'Platform'}])).toThrow(/cycle/);
    expect(readProject(writeProject(scene,[],'' )).scene.context.type).toBe('hierarchy');
    expect(execute(scene,[{type:'UNDO'}]).edges[0].sourceId).toBe(scene.nodes[0].id);
  });

  it('resolves selected and clarified parents in hierarchy commands',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'hierarchy'},
      {type:'ADD_NODE',label:'Engineering'},{type:'ADD_NODE',label:'Platform'}]);
    expect(bindSelection([{type:'REPARENT_BRANCH',target:'Platform',parent:'this'}],scene.nodes[0].id)[0]).toMatchObject({parent:scene.nodes[0].id});
    expect(clarifyActions(scene,[{type:'REPARENT_BRANCH',target:'Platform',parent:'which team'}],
      'which team',[scene.nodes[0].id],'Engineering',null)[0]).toMatchObject({parent:scene.nodes[0].id});
  });
});
