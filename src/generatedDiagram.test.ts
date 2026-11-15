import {describe,expect,it} from 'vitest';
import {appendGeneratedDiagram} from './generatedDiagram';
import {containerView} from './containerView';
import {emptyScene,execute,effectiveDiagramType} from './scene';

describe('generated diagram regions',()=>{
  it('keeps automatic type scopes invisible while showing requested containers',()=>{
    const scene=appendGeneratedDiagram(emptyScene(),[
      {type:'ADD_NODE',label:'Web App'},{type:'ADD_NODE',label:'API Gateway'},
      {type:'ADD_EDGE',source:'Web App',target:'API Gateway',relation:'connection'}
    ],'architecture','Online store');
    expect(scene.containers?.[0].implicit).toBe(true);
    expect(containerView(scene).frames).toHaveLength(0);
    expect(effectiveDiagramType(scene,scene.nodes[0].id)).toBe('architecture');
    const grouped=execute(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Web App','API Gateway']}]);
    expect(containerView(grouped).frames.map(frame=>frame.container.name)).toEqual(['Backend']);
    const typed=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'},{type:'ADD_NODE',label:'API'}]);
    const mixed=execute(typed,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mixed'}]);
    expect(mixed.containers?.[0].implicit).toBe(true);
    expect(containerView(mixed).frames).toHaveLength(0);
  });
  it('spreads a four-branch mind map around its center',()=>{
    const topics:Record<string,string[]>={
      Research:['Customer interviews','Competitor analysis'],
      Design:['User flows','Visual prototype'],
      Build:['Core features','Quality testing'],
      Release:['Launch campaign','Success metrics'],
    };
    const scene=appendGeneratedDiagram(emptyScene(),[
      {type:'ADD_NODE',label:'Launch'},
      ...Object.keys(topics).map(label=>({type:'ADD_NODE' as const,label})),
      ...Object.values(topics).flat().map(label=>({type:'ADD_NODE' as const,label})),
      ...Object.keys(topics).map(target=>({type:'ADD_EDGE' as const,source:'Launch',target,relation:'branch' as const})),
      ...Object.entries(topics).flatMap(([source,children])=>children.map(target=>({type:'ADD_EDGE' as const,source,target,relation:'branch' as const}))),
    ],'mindmap','Product launch');
    const node=(label:string)=>scene.nodes.find(item=>item.label===label)!;
    expect(scene.containers?.[0].rootId).toBe(node('Launch').id);
    expect(node('Research').x).toBeLessThan(node('Launch').x);
    expect(node('Design').x).toBeGreaterThan(node('Launch').x);
    expect(node('Build').y).toBeGreaterThan(node('Research').y);
    expect(node('Release').y).toBeGreaterThan(node('Design').y);
    expect(node('Customer interviews').x).toBeLessThan(node('Research').x);
    expect(node('Launch campaign').x).toBeGreaterThan(node('Release').x);
    expect(scene.nodes).toHaveLength(13);
    expect(scene.edges).toHaveLength(12);
  });
  it('keeps a retry loop behind the decision without stacking the main path',()=>{
    const scene=appendGeneratedDiagram(emptyScene(),[
      {type:'ADD_NODE',label:'Add to cart'},
      {type:'ADD_NODE',label:'Checkout'},
      {type:'ADD_NODE',label:'Payment approved?',shape:'diamond'},
      {type:'ADD_NODE',label:'Confirm the order'},
      {type:'ADD_NODE',label:'Send a receipt'},
      {type:'ADD_NODE',label:'Retry payment'},
      {type:'ADD_EDGE',source:'Add to cart',target:'Checkout',relation:'sequence'},
      {type:'ADD_EDGE',source:'Checkout',target:'Payment approved?',relation:'sequence'},
      {type:'ADD_EDGE',source:'Payment approved?',target:'Confirm the order',label:'Yes',relation:'sequence'},
      {type:'ADD_EDGE',source:'Confirm the order',target:'Send a receipt',relation:'sequence'},
      {type:'ADD_EDGE',source:'Payment approved?',target:'Retry payment',label:'No',relation:'sequence'},
      {type:'ADD_EDGE',source:'Retry payment',target:'Checkout',relation:'sequence'},
    ],'flowchart','Online checkout');
    const node=(label:string)=>scene.nodes.find(item=>item.label===label)!;
    expect(node('Add to cart').x).toBeLessThan(node('Checkout').x);
    expect(node('Checkout').x).toBeLessThan(node('Payment approved?').x);
    expect(node('Payment approved?').x).toBeLessThan(node('Confirm the order').x);
    expect(node('Payment approved?').x).toBeLessThan(node('Retry payment').x);
    expect(node('Confirm the order').x).toBeLessThan(node('Send a receipt').x);
    expect(node('Payment approved?').shape).toBe('diamond');
    expect(scene.edges).toHaveLength(6);
  });
  it('places different diagram types in separate scopes on one canvas',()=>{
    const flow=appendGeneratedDiagram(emptyScene(),[
      {type:'ADD_NODE',label:'Start'},{type:'ADD_NODE',label:'Finish'},
      {type:'ADD_EDGE',source:'Start',target:'Finish',relation:'sequence'}
    ],'flowchart','Complete an order');
    const mixed=appendGeneratedDiagram(flow,[
      {type:'ADD_NODE',label:'Main idea'},{type:'ADD_NODE',label:'Audience'},
      {type:'ADD_EDGE',source:'Main idea',target:'Audience',relation:'branch'}
    ],'mindmap','Explore an audience');
    expect(mixed.context.type).toBe('mixed');
    expect(mixed.containers?.map(item=>item.intentType)).toEqual(['flowchart','mindmap']);
    expect(mixed.nodes).toHaveLength(4);
    expect(mixed.edges).toHaveLength(2);
    expect(effectiveDiagramType(mixed,mixed.nodes[0].id)).toBe('flowchart');
    expect(effectiveDiagramType(mixed,mixed.nodes[2].id)).toBe('mindmap');
    expect(mixed.containers?.[1].rootId).toBe(mixed.nodes[2].id);
    expect(Math.min(...mixed.nodes.slice(2).map(node=>node.x))).toBeGreaterThan(Math.max(...mixed.nodes.slice(0,2).map(node=>node.x+node.width)));
    const extended=execute(mixed,[{type:'ADD_NODE',label:'Research',container:'Mind map 1'}]);
    const research=extended.nodes.find(node=>node.label==='Research')!;
    expect(extended.containers?.[1].nodeIds).toContain(research.id);
    expect(research.x).toBeGreaterThanOrEqual(Math.min(...mixed.nodes.slice(2).map(node=>node.x)));
    expect(research.y).toBeGreaterThan(Math.max(...mixed.nodes.slice(2).map(node=>node.y)));
    expect(execute(mixed,[{type:'UNDO'}]).nodes).toHaveLength(2);
  });
});
