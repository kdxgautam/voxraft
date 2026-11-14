import {describe,expect,it} from 'vitest';
import {emptyScene,execute} from './scene';
import {applyReplicaProposal,type ReviewFinding} from './reviewProposal';

describe('review proposal acceptance',()=>{
  it('adds only the proposed replica as one undoable edit',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'}]);
    const db=scene.nodes[1];
    const finding:ReviewFinding={title:'Shared database dependency',message:'',node_ids:[db.id],edge_ids:[],actions:[
      {type:'ADD_NODE',label:'Database replica'},
      {type:'ADD_EDGE',source:db.id,target:'Database replica',label:'replication'},
    ]};
    const next=applyReplicaProposal(scene,finding);
    expect(next.nodes.map(node=>node.label)).toEqual(['Auth','Database','Database replica']);
    expect(next.edges).toHaveLength(1);
    expect(execute(next,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
    expect(()=>applyReplicaProposal(scene,{...finding,actions:[{type:'DELETE_NODE',target:db.id}]})).toThrow(/additive replica/);
    expect(scene.nodes).toHaveLength(2);
  });
});
