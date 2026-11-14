import { describe, expect, it } from 'vitest';
import { execute, emptyScene, moveFromCanvas } from './scene';
import { verifiedPositions, type LayoutResult } from './layoutCritique';

describe('layout critique acceptance',()=>{
  const result=(positions:LayoutResult['positions']):LayoutResult=>({mode:'rules',tools_used:['compare_layouts'],selected:'layered',summary:'',scores:{},positions});
  it('validates every node position and applies as one undoable edit',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'DB'}]);
    const positions=Object.fromEntries(scene.nodes.map((node,index)=>[node.id,{x:100+index*250,y:100}]));
    const verified=verifiedPositions(scene,result(positions));
    expect(verified).toEqual(positions);
    const moved=moveFromCanvas(scene,verified!);
    expect(moved.past).toHaveLength(scene.past.length+1);
    expect(execute(moved,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
  });
  it('rejects incomplete, foreign, or nonfinite positions',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'DB'}]);
    const id=scene.nodes[0].id;
    expect(()=>verifiedPositions(scene,result({[id]:{x:10,y:10}}))).toThrow(/missing/);
    expect(()=>verifiedPositions(scene,result({[id]:{x:10,y:10},other:{x:10,y:10}}))).toThrow(/unknown/);
    const positions=Object.fromEntries(scene.nodes.map(node=>[node.id,{x:10,y:10}]));
    positions[id]={x:Number.NaN,y:10};
    expect(()=>verifiedPositions(scene,result(positions))).toThrow(/invalid/);
  });
});
