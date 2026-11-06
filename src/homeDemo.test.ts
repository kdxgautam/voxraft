import {describe,expect,it} from 'vitest';
import {createDemoScenes,demoStep,DEMO_DURATION} from './homeDemo';

describe('homepage product walkthrough',()=>{
  it('uses valid edits to create, connect, move, and style a real scene',()=>{
    const scenes=createDemoScenes();
    expect(scenes.map(scene=>scene.nodes.length)).toEqual([0,3,3,4,4,4]);
    expect(scenes[2].edges).toHaveLength(2);
    expect(scenes[3].edges).toHaveLength(3);
    const cache=(index:number)=>scenes[index].nodes.find(node=>node.id==='demo-cache')!;
    expect(cache(4).id).toBe(cache(3).id);
    expect(cache(4).x).toBeGreaterThan(cache(3).x);
    expect(scenes[5].nodes.find(node=>node.id==='demo-db')?.color).toBe('#ccebd9');
    expect(scenes[4].nodes.find(node=>node.id==='demo-db')?.color).not.toBe('#ccebd9');
    for(const scene of scenes)for(const edge of scene.edges){expect(scene.nodes.some(node=>node.id===edge.sourceId)).toBe(true);expect(scene.nodes.some(node=>node.id===edge.targetId)).toBe(true);}
  });
  it('keeps seeking and the completed frame within the available scenes',()=>{
    expect(demoStep(-100)).toBe(0);expect(demoStep(3999)).toBe(0);expect(demoStep(4000)).toBe(1);expect(demoStep(DEMO_DURATION)).toBe(5);expect(demoStep(DEMO_DURATION+100)).toBe(5);
  });
});
