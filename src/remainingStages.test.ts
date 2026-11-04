import {describe,expect,it} from 'vitest';
import {conversionQuestions,conversionRootChoices,convertScene} from './conversion';
import {effectiveDiagramType,emptyScene,execute,intentScope} from './scene';
import {readProject,writeProject} from './project';

describe('flowchart, conversion, and mixed scopes',()=>{
  it('keeps a mind map intact when its canvas becomes mixed',()=>{
    const original=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'},
      {type:'ADD_NODE',label:'Ideas'},{type:'ADD_NODE',label:'Features'},
      {type:'ADD_EDGE',source:'Ideas',target:'Features',relation:'branch'}]);
    let mixed=convertScene(original,'mixed');
    expect(mixed.context.type).toBe('mixed');
    expect(mixed.context.rootId).toBeUndefined();
    expect(mixed.containers?.[0]).toMatchObject({intentType:'mindmap',rootId:original.nodes[0].id});
    expect(mixed.edges[0].relation).toBe('branch');
    mixed=execute(mixed,[{type:'ADD_NODE',label:'Backend'}]);
    expect(mixed.nodes[2]).toMatchObject({shape:'rectangle'});
    expect(mixed.nodes[2].role).toBeUndefined();
    expect(effectiveDiagramType(mixed,mixed.nodes[2].id)).toBe('mixed');
    expect(readProject(writeProject(mixed,[],'' )).scene.context.type).toBe('mixed');
    expect(execute(convertScene(original,'mixed'),[{type:'UNDO'}]).context.type).toBe('mindmap');
  });
  it('creates flow roles and labeled sequence paths while allowing a loop',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'flowchart'},
      {type:'ADD_NODE',label:'Start'},{type:'ADD_NODE',label:'Payment approved?'},
      {type:'ADD_NODE',label:'Send receipt'},{type:'ADD_NODE',label:'Retry'},
      {type:'ADD_EDGE',source:'Start',target:'Payment approved?'},
      {type:'ADD_EDGE',source:'Payment approved?',target:'Send receipt',label:'Yes'},
      {type:'ADD_EDGE',source:'Payment approved?',target:'Retry',label:'No'},
      {type:'ADD_EDGE',source:'Retry',target:'Payment approved?'}]);
    expect(scene.nodes.map(node=>node.shape)).toEqual(['ellipse','diamond','rectangle','rectangle']);
    expect(scene.edges.map(edge=>edge.relation)).toEqual(['sequence','sequence','sequence','sequence']);
    expect(scene.edges.map(edge=>edge.label)).toEqual(['','Yes','No','']);
    expect(scene.edges.every(edge=>edge.endArrowhead==='arrow')).toBe(true);
    scene=readProject(writeProject(scene,[],'' )).scene;
    expect(scene.edges[3].targetId).toBe(scene.nodes[1].id);
  });

  it('converts a mind map to hierarchy as one undoable edit and keeps manual styling',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mindmap'},
      {type:'ADD_NODE',label:'Food delivery'},{type:'ADD_NODE',label:'Features'},
      {type:'ADD_EDGE',source:'Food delivery',target:'Features',relation:'branch'},
      {type:'UPDATE_NODE',target:'Features',shape:'diamond',color:'blue'}]);
    const before=scene,ids=scene.nodes.map(node=>node.id),edgeId=scene.edges[0].id;
    expect(conversionQuestions(scene,'hierarchy')).toHaveLength(0);
    scene=convertScene(scene,'hierarchy');
    expect(scene.nodes.map(node=>node.id)).toEqual(ids);
    expect(scene.nodes[1]).toMatchObject({shape:'diamond',shapeSource:'explicit',color:before.nodes[1].color});
    expect(scene.edges[0]).toMatchObject({id:edgeId,relation:'parent_child',endArrowhead:null});
    expect(execute(scene,[{type:'UNDO'}]).context.type).toBe('mindmap');
    expect(execute(execute(scene,[{type:'UNDO'}]),[{type:'REDO'}]).context.type).toBe('hierarchy');
    expect(readProject(writeProject(scene,[],'' )).scene.edges[0].relation).toBe('parent_child');
  });

  it('asks for ambiguous conversion meanings and rejects cyclic ancestry',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},
      {type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},
      {type:'ADD_EDGE',source:'A',target:'B'},
      {type:'ADD_EDGE',source:'B',target:'A'}]);
    expect(conversionQuestions(scene,'flowchart')).toHaveLength(2);
    expect(()=>convertScene(scene,'flowchart')).toThrow(/Choose a meaning/);
    const choices=Object.fromEntries(scene.edges.map(edge=>[edge.id,'sequence' as const]));
    expect(convertScene(scene,'flowchart',choices).edges.map(edge=>edge.relation)).toEqual(['sequence','sequence']);
    expect(conversionRootChoices(scene,'mindmap')).toHaveLength(2);
    expect(()=>convertScene(scene,'mindmap',Object.fromEntries(scene.edges.map(edge=>[edge.id,'branch'])),scene.nodes[0].id)).toThrow(/root|cycle/);
  });

  it('uses the nearest container intent and requires explicit cross type relationships',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},
      {type:'ADD_NODE',label:'Ideas root'},{type:'ADD_NODE',label:'System root'},
      {type:'CREATE_CONTAINER',name:'Ideas',targets:['Ideas root']},
      {type:'CREATE_CONTAINER',name:'System',targets:['System root']},
      {type:'SET_CONTAINER_INTENT',container:'Ideas',diagramType:'mindmap'},
      {type:'SET_CONTAINER_INTENT',container:'System',diagramType:'architecture'}]);
    scene=execute(scene,[{type:'ADD_NODE',label:'PostgreSQL',container:'Ideas'},
      {type:'ADD_NODE',label:'PostgreSQL database',container:'System'},
      {type:'ADD_EDGE',source:'Ideas root',target:'PostgreSQL',relation:'branch'}]);
    expect(scene.nodes[2]).toMatchObject({shape:'rectangle',role:'topic'});
    expect(scene.nodes[3]).toMatchObject({shape:'cylinder',role:'database'});
    expect(scene.edges[0]).toMatchObject({relation:'branch',endArrowhead:null});
    expect(effectiveDiagramType(scene,scene.nodes[2].id)).toBe('mindmap');
    expect(intentScope(scene,scene.nodes[2].id)?.name).toBe('Ideas');
    expect(()=>execute(scene,[{type:'ADD_EDGE',source:'PostgreSQL',target:'System root'}])).toThrow(/different diagram types/);
    const linked=execute(scene,[{type:'ADD_EDGE',source:'PostgreSQL',target:'System root',relation:'association',relationSource:'explicit'}]);
    expect(linked.edges[1].relation).toBe('association');
    expect(readProject(writeProject(linked,[],'' )).scene.containers?.map(container=>container.intentType)).toEqual(['mindmap','architecture']);
    expect(execute(linked,[{type:'UNDO'}]).edges).toHaveLength(1);
  });

  it('reparents only within its mind map container',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Ideas'},{type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'},
      {type:'ADD_NODE',label:'Outside'},
      {type:'CREATE_CONTAINER',name:'Topics',targets:['Ideas','A','B']},
      {type:'SET_CONTAINER_INTENT',container:'Topics',diagramType:'mindmap'},
      {type:'SET_CONTAINER_ROOT',container:'Topics',target:'Ideas'},
      {type:'ADD_EDGE',source:'Ideas',target:'A',relation:'branch'}]);
    scene=execute(scene,[{type:'REPARENT_BRANCH',target:'A',parent:'B'}]);
    expect(scene.edges[0].sourceId).toBe(scene.nodes[2].id);
    expect(()=>execute(scene,[{type:'REPARENT_BRANCH',target:'B',parent:'A'}])).toThrow(/cycle/);
    expect(()=>execute(scene,[{type:'REPARENT_BRANCH',target:'A',parent:'Outside'}])).toThrow(/same diagram scope/);
  });
});
