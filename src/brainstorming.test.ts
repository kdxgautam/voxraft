import {describe,expect,it} from 'vitest';
import {emptyScene,execute} from './scene';
import {readProject,writeProject} from './project';
import {resolvePlannedActions} from './targetResolver';

describe('brainstorming notes',()=>{
  it('keeps names neutral, positions stable, and connections optional',()=>{
    let scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'brainstorming',purpose:'Explore checkout ideas'},
      {type:'ADD_NODE',label:'PostgreSQL'}]);
    expect(scene.nodes[0]).toMatchObject({shape:'rectangle',role:'note',roleSource:'intent'});
    const first={x:scene.nodes[0].x,y:scene.nodes[0].y};
    scene=execute(scene,[{type:'ADD_NODE',label:'Demo video'}]);
    expect(scene.nodes[0]).toMatchObject(first);
    expect(scene.edges).toHaveLength(0);
    scene=execute(scene,[{type:'CREATE_GROUP',name:'Submission ideas',targets:['PostgreSQL','Demo video']}]);
    expect(scene.groups?.[0]).toMatchObject({name:'Submission ideas',nodeIds:scene.nodes.map(node=>node.id)});
    scene=execute(scene,[{type:'ADD_EDGE',source:'PostgreSQL',target:'Demo video'}]);
    expect(scene.edges[0]).toMatchObject({relation:'association',relationSource:'intent',endArrowhead:null});
    expect(readProject(writeProject(scene,[],'' )).scene).toMatchObject({context:{type:'brainstorming'},groups:scene.groups});
    expect(execute(scene,[{type:'UNDO'}]).edges).toHaveLength(0);
  });

  it('rejects a planner-invented connection when the user only asks for notes',()=>{
    const scene=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'brainstorming'},
      {type:'ADD_NODE',label:'A'},{type:'ADD_NODE',label:'B'}]);
    expect(()=>resolvePlannedActions(scene,[{type:'ADD_EDGE',source:'A',target:'B'}],'Add another idea',null)).toThrow(/only when you ask/);
    const requested=resolvePlannedActions(scene,[{type:'ADD_EDGE',source:'A',target:'B'}],'Relate A to B',null);
    expect(execute(scene,requested).edges[0]).toMatchObject({relation:'association',endArrowhead:null});
  });
});
