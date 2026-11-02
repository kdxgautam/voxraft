import { describe,expect,it,vi } from 'vitest';
import { bindSelection, clarifyActions, emptyScene,execute,replaceLastEdit,SceneError, selectedEdgeId, selectedNodeId, selectedNodeIds, syncCanvas, type CanvasElement } from './scene';
import {readProject,writeProject} from './project';
describe('scene editing',()=>{
  it('keeps explicit diagram decisions with undo, clear, and new diagram',()=>{
    const start=emptyScene();
    const noted=execute(start,[{type:'REMEMBER_NOTE',note:'PostgreSQL database already has failover outside this diagram'}]);
    expect(noted.context.notes).toEqual(['PostgreSQL database already has failover outside this diagram']);
    expect(readProject(writeProject(noted,[],'' )).scene.context.notes).toEqual(noted.context.notes);
    expect(execute(noted,[{type:'UNDO'}]).context.notes).toBeUndefined();
    expect(execute(noted,[{type:'CLEAR'}]).context.notes).toEqual(noted.context.notes);
    expect(execute(noted,[{type:'NEW_DIAGRAM'}]).context.notes).toBeUndefined();
    expect(execute(noted,[{type:'FORGET_NOTE',note:'postgresql database already has failover outside this diagram'}]).context.notes).toEqual([]);
  });
  it('creates IDs when randomUUID is unavailable',()=>{
    let value=0;
    vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(++value);return bytes;}});
    try {
      const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'Backend'},{type:'ADD_EDGE',source:'Frontend',target:'Backend'}]);
      expect(new Set([...scene.nodes.map(n=>n.id),...scene.edges.map(e=>e.id)]).size).toBe(3);
    } finally {vi.unstubAllGlobals();}
  });
  it('keeps a six-step edit session and undoes insertion',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'FastAPI backend'},{type:'ADD_NODE',label:'PostgreSQL database'}]);
    const ids=scene.nodes.map(n=>n.id);
    scene=execute(scene,[{type:'ADD_EDGE',source:'frontend',target:'backend'},{type:'ADD_EDGE',source:'backend',target:'database'}]);
    scene=execute(scene,[{type:'INSERT_BETWEEN',label:'Redis',source:'backend',target:'database'}]);
    expect(scene.edges).toHaveLength(3);
    scene=execute(scene,[{type:'MOVE_NODE',target:'Redis',direction:'above',relativeTo:'database'}]);
    scene=execute(scene,[{type:'UPDATE_NODE',target:'backend',label:'Authentication Service'}]);
    scene=execute(scene,[{type:'UNDO'}]);
    expect(scene.nodes.map(n=>n.id).slice(0,3)).toEqual(ids);
    expect(scene.nodes[1].label).toBe('FastAPI backend');
    scene=execute(scene,[{type:'REDO'}]);
    expect(scene.nodes[1].label).toBe('Authentication Service');
  });
  it('rejects unknown references without mutating the scene',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'}]);
    expect(()=>execute(scene,[{type:'ADD_NODE',label:'Redis'},{type:'ADD_EDGE',source:'Redis',target:'Missing'}])).toThrow(SceneError);
    expect(scene.nodes).toHaveLength(1);
  });
  it('asks to clarify ambiguous labels',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Main database'},{type:'ADD_NODE',label:'Backup database'}]);
    expect(()=>execute(scene,[{type:'DELETE_NODE',target:'database'}])).toThrow(/Which database/);
    const deleted=execute(scene,[{type:'DELETE_NODE',target:'second database'}]);
    expect(deleted.nodes).toHaveLength(1);
    expect(execute(deleted,[{type:'UNDO'}]).nodes).toHaveLength(2);
  });
  it('binds “this” to the selected node, including its text label',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'Backend'}]);
    const frontend=scene.nodes[0];
    const selected=selectedNodeId(scene,{[`${frontend.id}:label`]:true});
    const actions=bindSelection([{type:'UPDATE_NODE',target:'this',color:'orange'}],selected);
    const updated=execute(scene,actions);
    expect(updated.nodes[0].color).toBe('#f59e0b');
    expect(updated.nodes[1].color).not.toBe('#f59e0b');
    expect(selectedNodeId(scene,{[scene.nodes[0].id]:true,[scene.nodes[1].id]:true})).toBeNull();
    expect(()=>execute(scene,bindSelection([{type:'DELETE_NODE',target:'this'}],null))).toThrow(/Select a node/);
  });
  it('finishes an ambiguous edit from the next answer without replanning',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Main database'},{type:'ADD_NODE',label:'Backup database'}]);
    const actions=bindSelection([{type:'UPDATE_NODE',target:'database',color:'orange'}],null);
    let question:SceneError;
    try{execute(scene,actions);throw new Error('Expected clarification');}
    catch(error){if(!(error instanceof SceneError))throw error;question=error;}
    expect(question.clarification).toBe(true);
    expect(question.candidateIds).toHaveLength(2);
    expect(()=>clarifyActions(scene,actions,question.reference!,question.candidateIds,'Frontend',null)).toThrow();
    const resolved=clarifyActions(scene,actions,question.reference!,question.candidateIds,'second one',null);
    const updated=execute(scene,resolved);
    expect(updated.nodes[0].color).not.toBe('#f59e0b');
    expect(updated.nodes[1].color).toBe('#f59e0b');
    expect(updated.past).toHaveLength(scene.past.length+1);
  });
  it('clears the whole scene from a command and can undo it',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'Backend'},{type:'ADD_EDGE',source:'Frontend',target:'Backend'}]);
    const cleared=execute(scene,[{type:'CLEAR'}]);
    expect(cleared.nodes).toHaveLength(0);
    expect(cleared.edges).toHaveLength(0);
    expect(execute(cleared,[{type:'UNDO'}]).nodes).toHaveLength(2);
    expect(()=>execute(scene,[{type:'CLEAR'},{type:'ADD_NODE',label:'Redis'}])).toThrow(/command on its own/);
  });
  it('undoes and redoes two spoken history steps in order',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'}]);
    scene=execute(scene,[{type:'ADD_NODE',label:'Backend'}]);
    scene=execute(scene,[{type:'ADD_EDGE',source:'Frontend',target:'Backend'}]);
    const undone=execute(scene,[{type:'UNDO',steps:2}]);
    expect(undone.nodes.map(node=>node.label)).toEqual(['Frontend']);
    expect(undone.edges).toHaveLength(0);
    expect(execute(undone,[{type:'REDO',steps:2}]).edges).toHaveLength(1);
    expect(()=>execute(undone,[{type:'UNDO',steps:2}])).toThrow(/Not enough edits/);
  });
  it('arranges a connected graph in layers and preserves undo',()=>{
    const scene=execute(emptyScene(),[
      {type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'API Gateway'},
      {type:'ADD_NODE',label:'Auth Service'},{type:'ADD_NODE',label:'Order Service'},
      {type:'ADD_EDGE',source:'Frontend',target:'API Gateway'},
      {type:'ADD_EDGE',source:'API Gateway',target:'Auth Service'},
      {type:'ADD_EDGE',source:'API Gateway',target:'Order Service'}
    ]);
    const arranged=execute(scene,[{type:'ARRANGE'}]);
    const node=(label:string)=>arranged.nodes.find(item=>item.label===label)!;
    expect(node('Frontend').x).toBeLessThan(node('API Gateway').x);
    expect(node('API Gateway').x).toBeLessThan(node('Auth Service').x);
    expect(node('Auth Service').x).toBe(node('Order Service').x);
    expect(node('Auth Service').y).not.toBe(node('Order Service').y);
    expect(execute(arranged,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
  });
  it('commits a completed drag as one undo step and saves direct canvas edits',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'API'}]);
    const [frontend,api]=scene.nodes;
    const shape=(node:typeof frontend):CanvasElement=>({id:node.id,type:node.shape,x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color});
    const label=(node:typeof frontend):CanvasElement=>({id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:100,height:20,strokeColor:'#000',text:node.label});
    const changed=syncCanvas(scene,[{...shape(frontend),x:500,width:300,strokeColor:'#ff0000'}, {...label(frontend),text:'Web app'},shape(api),label(api),{id:'drawing',type:'freedraw',x:10,y:10,width:20,height:20,strokeColor:'#333',points:[[0,0],[20,20]]}]);
    expect(changed.nodes[0]).toMatchObject({x:500,width:300,color:'#ff0000',label:'Web app'});
    expect(changed.extras?.[0].id).toBe('drawing');
    expect(changed.past).toHaveLength(scene.past.length+1);
    expect(execute(changed,[{type:'UNDO'}]).nodes[0]).toEqual(frontend);
    expect(syncCanvas(changed,[{...shape(changed.nodes[0])}, {...label(changed.nodes[0])},shape(api),label(api),changed.extras![0] as CanvasElement])).toBe(changed);
  });
  it('syncs manual node and connection deletion, plus newly drawn shapes',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'API'},{type:'ADD_EDGE',source:'Frontend',target:'API'}]);
    const api=scene.nodes[1];
    const next=syncCanvas(scene,[{id:api.id,type:'rectangle',x:api.x,y:api.y,width:api.width,height:api.height,strokeColor:api.color},{id:`${api.id}:label`,type:'text',x:0,y:0,width:100,height:20,strokeColor:'#000',text:'API'},{id:'new-shape',type:'diamond',x:800,y:100,width:120,height:80,strokeColor:'#123'}]);
    expect(next.nodes.map(node=>node.id)).toEqual([api.id,'new-shape']);
    expect(next.edges).toHaveLength(0);
    expect(execute(next,[{type:'UNDO'}]).edges).toHaveLength(1);
  });
  it('labels, reverses and disconnects one connection with undo',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Database'}]);
    const original=scene.edges[0];
    scene=execute(scene,[{type:'UPDATE_EDGE',edge:'that arrow',label:'HTTPS'}]);
    expect(scene.edges[0]).toMatchObject({id:original.id,label:'HTTPS'});
    const reversed=execute(scene,[{type:'REVERSE_EDGE',edge:'that arrow'}]);
    expect(reversed.edges[0]).toMatchObject({sourceId:original.targetId,targetId:original.sourceId,label:'HTTPS'});
    expect(execute(reversed,[{type:'UNDO'}]).edges[0].sourceId).toBe(original.sourceId);
    const disconnected=execute(reversed,[{type:'DELETE_EDGE',source:'Auth',target:'Database'}]);
    expect(disconnected.edges).toHaveLength(0);
    expect(execute(disconnected,[{type:'UNDO'}]).edges).toHaveLength(1);
  });
  it('keeps named groups valid when a member is deleted',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Orders'},{type:'CREATE_GROUP',name:'backend services',targets:['Auth','Orders']}]);
    expect(scene.groups?.[0].nodeIds).toEqual(scene.nodes.map(node=>node.id));
    scene=execute(scene,[{type:'DELETE_NODE',target:'Orders'}]);
    expect(scene.groups?.[0].nodeIds).toEqual([scene.nodes[0].id]);
  });
  it('maps selected block labels and arrow labels to their canonical IDs',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Database'}]);
    const ids=selectedNodeIds(scene,{[`${scene.nodes[0].id}:label`]:true,[scene.nodes[1].id]:true});
    expect(ids).toEqual(scene.nodes.map(node=>node.id));
    expect(selectedEdgeId(scene,{[`${scene.edges[0].id}:label`]:true})).toBe(scene.edges[0].id);
  });
  it('keeps a manually edited connection label in the canonical scene',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Database',label:'HTTP'}]);
    const elements:CanvasElement[]=scene.nodes.flatMap(node=>[
      {id:node.id,type:'rectangle',x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color},
      {id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:100,height:20,strokeColor:'#000',text:node.label}
    ]);
    elements.push({id:scene.edges[0].id,type:'arrow',x:0,y:0,width:100,height:0,strokeColor:'#000'});
    elements.push({id:`${scene.edges[0].id}:label`,type:'text',x:0,y:0,width:80,height:20,strokeColor:'#000',text:'HTTPS'});
    const edited=syncCanvas(scene,elements);
    expect(edited.edges[0].label).toBe('HTTPS');
    expect(edited.extras).toEqual([]);
  });
  it('keeps labels attached to newly drawn arrows',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'}]);
    const elements:CanvasElement[]=scene.nodes.flatMap(node=>[
      {id:node.id,type:'rectangle',x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color},
      {id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:100,height:20,strokeColor:'#000',text:node.label}
    ]);
    elements.push({id:'manual-arrow',type:'arrow',x:0,y:0,width:100,height:0,strokeColor:'#000',startBinding:{elementId:scene.nodes[0].id},endBinding:{elementId:scene.nodes[1].id}});
    elements.push({id:'manual-label',type:'text',x:0,y:0,width:80,height:20,strokeColor:'#000',containerId:'manual-arrow',text:'HTTPS'});
    const edited=syncCanvas(scene,elements);
    expect(edited.edges[0]).toMatchObject({id:'manual-arrow',label:'HTTPS'});
    expect(edited.extras).toEqual([]);
  });
  it('replaces a mistaken last command as one undoable edit',()=>{
    const before=execute(emptyScene(),[{type:'ADD_NODE',label:'Database'}]);
    const wrong=execute(before,[{type:'ADD_NODE',label:'Kafka'}]);
    const corrected=replaceLastEdit(wrong,before,wrong,[{type:'ADD_NODE',label:'Redis'}]);
    expect(corrected.nodes.map(node=>node.label)).toEqual(['Database','Redis']);
    expect(corrected.past).toHaveLength(wrong.past.length);
    expect(execute(corrected,[{type:'UNDO'}]).nodes.map(node=>node.label)).toEqual(['Database']);
    expect(()=>replaceLastEdit(corrected,before,wrong,[{type:'ADD_NODE',label:'Redis'}])).toThrow(/changed after/);
  });
  it('can correct the destination of the last connection',()=>{
    const before=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'Main database'},{type:'ADD_NODE',label:'Backup database'}]);
    const wrong=execute(before,[{type:'ADD_EDGE',source:'Frontend',target:'Main database'}]);
    const corrected=replaceLastEdit(wrong,before,wrong,[{type:'ADD_EDGE',source:'Frontend',target:'Backup database'}]);
    expect(corrected.edges).toHaveLength(1);
    expect(corrected.edges[0].targetId).toBe(before.nodes[2].id);
    expect(execute(corrected,[{type:'UNDO'}]).edges).toHaveLength(0);
  });
});
