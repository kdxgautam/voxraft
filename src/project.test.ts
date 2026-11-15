import { describe,expect,it } from 'vitest';
import { clearScene,emptyScene,execute } from './scene';
import { readProject,readSavedScene,writeProject } from './project';
import { appendGeneratedDiagram } from './generatedDiagram';
import { containerView } from './containerView';

describe('project recovery',()=>{
  it('hides the generated frame in an older saved project',()=>{
    const scene=appendGeneratedDiagram(emptyScene(),[{type:'ADD_NODE',label:'Web App'},{type:'ADD_NODE',label:'API Gateway'}],'architecture','Online store');
    const legacy=JSON.parse(writeProject(scene,[],''));
    delete legacy.scene.containers[0].implicit;
    const restored=readProject(JSON.stringify(legacy)).scene;
    expect(restored.containers?.[0].implicit).toBe(true);
    expect(containerView(restored).frames).toHaveLength(0);
    const typed=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},{type:'ADD_NODE',label:'API'}]);
    const section=execute(typed,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mixed'}]);
    const oldSection=JSON.parse(writeProject(section,[],''));
    delete oldSection.scene.containers[0].implicit;
    expect(readProject(JSON.stringify(oldSection)).scene.containers?.[0].implicit).toBe(true);
  });
  it('preserves embedded canvas images with the project',()=>{
    const files={image1:{id:'image1',mimeType:'image/png',dataURL:'data:image/png;base64,iVBORw0KGgo=',created:1}};
    expect(readProject(writeProject(emptyScene(),[],'',files)).files).toEqual(files);
  });
  it('restores nodes, connections, history and command activity',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'Backend'},{type:'ADD_EDGE',source:'Frontend',target:'Backend'}]);
    scene=clearScene(scene);
    expect(scene.nodes).toHaveLength(0);
    const restored=readProject(writeProject(scene,[{text:'Create frontend and backend',kind:'command',time:'12:00'}],'Create frontend and backend'));
    expect(restored.logs).toHaveLength(1);
    expect(restored.latest).toBe('Create frontend and backend');
    const undone=execute(restored.scene,[{type:'UNDO'}]);
    expect(undone.nodes).toHaveLength(2);
    expect(undone.edges).toHaveLength(1);
  });
  it('rejects connections to missing nodes',()=>{
    const json=writeProject(emptyScene(),[],'');
    const file=JSON.parse(json);
    file.scene.edges=[{id:'e1',sourceId:'missing',targetId:'also-missing',label:''}];
    expect(()=>readProject(JSON.stringify(file))).toThrow(/invalid connections/);
  });
  it('validates a saved browser scene before restoring it',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Database'}]);
    expect(readSavedScene(JSON.stringify(scene)).nodes[0].label).toBe('Database');
    const incomplete={nodes:[],edges:[],past:[]};
    expect(()=>readSavedScene(JSON.stringify(incomplete))).toThrow();
  });
  it('round trips a long edit history and repairs old recent-ID overflow',()=>{
    let scene=execute(emptyScene(),Array.from({length:6},(_,index)=>({type:'ADD_NODE',label:`Service ${index}`})));
    scene=execute(scene,[{type:'MOVE_NODE',target:scene.nodes[0].id,direction:'right'}]);
    expect(scene.recentIds).toHaveLength(5);
    const restored=readProject(writeProject(scene,[],'')).scene;
    expect(restored.nodes).toHaveLength(6);
    const old=JSON.parse(writeProject(scene,[],''));
    old.scene.recentIds=[...scene.nodes.map(node=>node.id)];
    old.scene.past[0].recentIds=[...scene.nodes.map(node=>node.id)];
    expect(readProject(JSON.stringify(old)).scene.recentIds).toHaveLength(5);
  });
  it('round trips connection labels and named groups',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Database',label:'HTTPS'},{type:'CREATE_GROUP',name:'backend services',targets:['Auth','Database']}]);
    const restored=readProject(writeProject(scene,[],'')).scene;
    expect(restored.edges[0].label).toBe('HTTPS');
    expect(restored.groups?.[0].nodeIds).toEqual(scene.groups?.[0].nodeIds);
  });
});
