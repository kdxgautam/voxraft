import {describe,expect,it} from 'vitest';
import {createTemplate,templates} from './templates';

describe('starter templates',()=>{
  it.each(templates)('creates an editable $name scene',template=>{
    const scene=createTemplate(template.id);
    expect(scene.context.type).toBe(template.type);
    expect(scene.nodes.length).toBeGreaterThan(2);
    expect(scene.edges.length).toBeGreaterThan(0);
    expect(new Set(scene.nodes.map(node=>node.id)).size).toBe(scene.nodes.length);
    expect(scene.edges.every(edge=>scene.nodes.some(node=>node.id===edge.sourceId)&&scene.nodes.some(node=>node.id===edge.targetId))).toBe(true);
  });
});
