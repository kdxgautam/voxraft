import {describe,expect,it} from 'vitest';
import {emptyScene,execute} from './scene';
import {readProject,writeProject} from './project';
import {applyVisualProposal,type VisualResult} from './visualProposal';

const result=(scene:ReturnType<typeof emptyScene>):VisualResult=>({mode:'rules',tools_used:['inspect_roles'],summary:'',roles:[],
  node_styles:Object.fromEntries(scene.nodes.map(node=>[node.id,{color:'#187d70',fontFamily:3}])),
  edge_styles:Object.fromEntries(scene.edges.map(edge=>[edge.id,{color:'#187d70',fontFamily:3}]))});

describe('visual design acceptance',()=>{
  it('changes styles only after acceptance and undoes them together',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'Database'},{type:'ADD_EDGE',source:'API',target:'Database'}]);
    const proposal=result(scene);
    expect(scene.edges[0].color).toBeUndefined();
    const styled=applyVisualProposal(scene,proposal);
    expect(styled.nodes[0].fontFamily).toBe(3);
    expect(styled.edges[0].color).toBe('#187d70');
    expect(styled.past).toHaveLength(scene.past.length+1);
    expect(execute(styled,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
    expect(execute(styled,[{type:'UNDO'}]).edges).toEqual(scene.edges);
    const restored=readProject(writeProject(styled,[],'')).scene;
    expect(restored.nodes[0].fontFamily).toBe(3);
    expect(restored.edges[0].color).toBe('#187d70');
    expect(execute(restored,[{type:'UNDO'}]).edges).toEqual(scene.edges);
  });
  it('rejects unknown IDs and invalid colors',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'}]);
    const proposal=result(scene);
    proposal.node_styles.unknown={color:'#187d70',fontFamily:3};
    expect(()=>applyVisualProposal(scene,proposal)).toThrow(/does not match/);
    delete proposal.node_styles.unknown;
    proposal.node_styles[scene.nodes[0].id].color='red';
    expect(()=>applyVisualProposal(scene,proposal)).toThrow(/invalid style/);
  });
  it('styles a container boundary in the same undoable edit',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'}]);
    scene=execute(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth']}]);
    const proposal=result(scene);
    proposal.container_styles={[scene.containers![0].id]:{color:'#6259a6'}};
    const styled=applyVisualProposal(scene,proposal);
    expect(styled.containers![0].color).toBe('#6259a6');
    expect(execute(styled,[{type:'UNDO'}]).containers).toEqual(scene.containers);
  });
  it('applies grounded shapes with styles in one edit and persists their provenance',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Start'},{type:'ADD_NODE',label:'Payment approved?'},{type:'ADD_NODE',label:'Auth Service',shape:'diamond'},{type:'ADD_EDGE',source:'Start',target:'Payment approved?'}]);
    const proposal=result(scene);
    proposal.shape_suggestions={
      [scene.nodes[0].id]:{shape:'ellipse',reason:'Start of the workflow'},
      [scene.nodes[1].id]:{shape:'diamond',reason:'Explicit condition'},
    };
    const styled=applyVisualProposal(scene,proposal);
    expect(styled.nodes.map(node=>node.shape)).toEqual(['ellipse','diamond','diamond']);
    expect(styled.nodes.slice(0,2).map(node=>node.shapeSource)).toEqual(['suggested','suggested']);
    expect(styled.edges[0].sourceId).toBe(scene.edges[0].sourceId);
    expect(styled.past).toHaveLength(scene.past.length+1);
    expect(execute(styled,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
    const imported=readProject(writeProject(styled,[],'')).scene;
    expect(imported.nodes[0].shapeSource).toBe('suggested');
    expect(execute(imported,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
  });
  it('rejects attempts to replace explicit choices and invalid suggestions',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Start',shape:'rectangle'}]);
    const proposal=result(scene);
    proposal.shape_suggestions={[scene.nodes[0].id]:{shape:'ellipse',reason:'Start of flow'}};
    expect(()=>applyVisualProposal(scene,proposal)).toThrow(/user-chosen shape/);
    expect(applyVisualProposal(scene,proposal,true).nodes[0].shape).toBe('ellipse');
    proposal.shape_suggestions={[scene.nodes[0].id]:{shape:'hexagon' as 'ellipse',reason:'Invalid'}};
    expect(()=>applyVisualProposal(scene,proposal)).toThrow(/invalid shape/);
  });
  it('keeps existing colors and fonts on a shape-only request',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Start'}]);
    const proposal=result(scene);
    proposal.shape_suggestions={[scene.nodes[0].id]:{shape:'ellipse',reason:'Start of workflow'}};
    const changed=applyVisualProposal(scene,proposal,false,false);
    expect(changed.nodes[0].shape).toBe('ellipse');
    expect(changed.nodes[0].color).toBe(scene.nodes[0].color);
    expect(changed.nodes[0].fontFamily).toBeUndefined();
  });
  it('accepts a database cylinder proposal without changing the connection or container',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'PostgreSQL database'},
      {type:'ADD_EDGE',source:'API',target:'PostgreSQL database'},
      {type:'CREATE_CONTAINER',name:'Data tier',targets:['API','PostgreSQL database']}]);
    const proposal=result(scene);
    proposal.shape_suggestions={[scene.nodes[1].id]:{shape:'cylinder',reason:'Explicit database identity'}};
    const changed=applyVisualProposal(scene,proposal,false,false);
    expect(changed.nodes[1]).toMatchObject({id:scene.nodes[1].id,shape:'cylinder',shapeSource:'suggested'});
    expect(changed.edges).toEqual(scene.edges);
    expect(changed.containers).toEqual(scene.containers);
    scene=execute(changed,[{type:'UNDO'}]);
    expect(scene.nodes[1].shape).toBe('rectangle');
  });
});
