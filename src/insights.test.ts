import {describe,expect,it} from 'vitest';
import {emptyScene,execute} from './scene';
import {diagramInsight} from './insights';

describe('proactive diagram insight',()=>{
  it('identifies a database shared by three connected components',()=>{
    let scene=execute(emptyScene(),[
      {type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},
      {type:'ADD_NODE',label:'Auth'},
      {type:'ADD_NODE',label:'Orders'},
      {type:'ADD_NODE',label:'Billing'},
      {type:'ADD_NODE',label:'PostgreSQL database'},
    ]);
    scene=execute(scene,[
      {type:'ADD_EDGE',source:'Auth',target:'PostgreSQL database'},
      {type:'ADD_EDGE',source:'Orders',target:'PostgreSQL database'},
      {type:'ADD_EDGE',source:'Billing',target:'PostgreSQL database'},
    ]);
    const insight=diagramInsight(scene);
    expect(insight?.nodeId).toBe(scene.nodes[3].id);
    expect(insight?.edgeIds).toEqual(scene.edges.map(edge=>edge.id));
    expect(insight?.message).toContain('3 components');
    const reduced=execute(scene,[{type:'DELETE_EDGE',source:'Billing',target:'PostgreSQL database'}]);
    expect(diagramInsight(reduced)).toBeNull();
    const protectedScene=execute(scene,[{type:'ADD_NODE',label:'PostgreSQL database replica'},{type:'ADD_EDGE',source:scene.nodes[3].id,target:'PostgreSQL database replica'}]);
    expect(diagramInsight(protectedScene)).toBeNull();
    const associations=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},...scene.nodes.map(node=>({type:'ADD_NODE' as const,label:node.label}))]);
    const related=execute(associations,scene.nodes.slice(0,3).map(node=>({type:'ADD_EDGE' as const,source:node.label,target:'PostgreSQL database',relation:'association' as const})));
    expect(diagramInsight(related)).toBeNull();
  });
});
