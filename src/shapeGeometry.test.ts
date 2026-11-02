import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {routeEdge} from './edgeRouting';
import {LayoutPreview} from './layoutCritique';
import {nodeLabelLayout,shapeBoundary} from './shapeGeometry';
import {emptyScene,execute,syncCanvas,type CanvasElement} from './scene';
import {readProject,writeProject} from './project';
import {resolvePlannedActions} from './targetResolver';

describe('native diagram shapes',()=>{
  it('places diagonal arrow endpoints on ellipse and diamond outlines',()=>{
    const source={id:'ellipse',label:'Start',shape:'ellipse' as const,x:0,y:0,width:200,height:100,color:'#6366f1'};
    const target={...source,id:'diamond',label:'Decision',shape:'diamond' as const,x:320,y:140};
    const edge={id:'edge',sourceId:source.id,targetId:target.id,label:''};
    const route=routeEdge({nodes:[source,target]},edge);
    const sourceCenter={x:source.x+source.width/2,y:source.y+source.height/2};
    const targetCenter={x:target.x+target.width/2,y:target.y+target.height/2};
    expect(route.x).toBeCloseTo(shapeBoundary(source,targetCenter).x);
    expect(route.y).toBeCloseTo(shapeBoundary(source,targetCenter).y);
    expect(Math.hypot((route.x-sourceCenter.x)/100,(route.y-sourceCenter.y)/50)).toBeCloseTo(1);
    expect(Math.abs((route.tx-targetCenter.x)/100)+Math.abs((route.ty-targetCenter.y)/50)).toBeCloseTo(1);
  });
  it('keeps a long routed arrow attached to the diamond outline',()=>{
    const nodes=['Auth','Orders','Billing','Decision'].map((label,index)=>({id:label,label,shape:index===3?'diamond' as const:'rectangle' as const,x:100+index*240,y:100,width:200,height:100,color:'#6366f1'}));
    const target=nodes[3],route=routeEdge({nodes},{id:'long',sourceId:'Auth',targetId:'Decision',label:''});
    const center={x:target.x+target.width/2,y:target.y+target.height/2};
    expect(route.points.length).toBeGreaterThan(2);
    expect(Math.abs((route.tx-center.x)/(target.width/2))+Math.abs((route.ty-center.y)/(target.height/2))).toBeCloseTo(1);
  });
  it('fits long labels and preserves the original text through canvas synchronization',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Is the payment authorized by the gateway?',shape:'diamond'}]);
    const node=scene.nodes[0],layout=nodeLabelLayout(node);
    expect(node.height).toBeGreaterThan(82);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.length*layout.fontSize*1.25).toBeLessThanOrEqual(layout.height);
    const raw:CanvasElement[]=[{id:node.id,type:'diamond',x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color},
      {id:`${node.id}:label`,type:'text',x:layout.x,y:layout.y,width:layout.width,height:layout.height,strokeColor:'#000',text:layout.text,originalText:node.label}];
    scene=syncCanvas(scene,raw);
    expect(scene.nodes[0].label).toBe(node.label);
    expect(readProject(writeProject(scene,[],'' )).scene.nodes[0].shape).toBe('diamond');
  });
  it('changes shape without changing IDs, connections, or membership and undoes the resize',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Start'},{type:'ADD_NODE',label:'Payment approved?'},{type:'ADD_EDGE',source:'Start',target:'Payment approved?'},{type:'CREATE_CONTAINER',name:'Checkout',targets:['Start','Payment approved?']}]);
    const before=scene;
    scene=execute(scene,[{type:'UPDATE_NODE',target:'Payment approved?',shape:'diamond'}]);
    expect(scene.nodes[1].shape).toBe('diamond');
    expect(scene.nodes[1].height).toBeGreaterThan(before.nodes[1].height);
    expect(scene.nodes.map(node=>node.id)).toEqual(before.nodes.map(node=>node.id));
    expect(scene.edges).toEqual(before.edges);
    expect(scene.containers).toEqual(before.containers);
    expect(execute(scene,[{type:'UNDO'}]).nodes).toEqual(before.nodes);
    const corrected=resolvePlannedActions(before,[{type:'UPDATE_NODE',target:before.nodes[0].id,shape:'diamond'}],'Make Payment approved? a diamond',null);
    expect(corrected).toMatchObject([{target:before.nodes[1].id,shape:'diamond'}]);
  });
  it('renders native shapes and wrapped labels in the preview',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Start',shape:'ellipse'},{type:'ADD_NODE',label:'Is the payment approved by the user?',shape:'diamond'}]);
    const positions=Object.fromEntries(scene.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));
    const markup=renderToStaticMarkup(React.createElement(LayoutPreview,{scene,positions}));
    expect(markup).toContain('<ellipse');
    expect(markup).toContain('<polygon');
    expect(markup).toContain('<tspan');
    expect(markup).toContain('Is the payment');
    expect(markup).toContain('approved by the');
  });
  it('records explicit shape choices but keeps planner defaults eligible for suggestions',()=>{
    const blank=emptyScene();
    const defaulted=execute(blank,resolvePlannedActions(blank,[{type:'ADD_NODE',label:'Start',shape:'rectangle'}],'Add Start',null));
    expect(defaulted.nodes[0].shapeSource).toBeUndefined();
    const chosen=execute(blank,resolvePlannedActions(blank,[{type:'ADD_NODE',label:'Start',shape:'rectangle'}],'Create a rectangle called Start',null));
    expect(chosen.nodes[0].shapeSource).toBe('explicit');
    const manuallyChanged=syncCanvas(defaulted,[{id:defaulted.nodes[0].id,type:'ellipse',x:80,y:100,width:200,height:90,strokeColor:'#6366f1'}]);
    expect(manuallyChanged.nodes[0].shapeSource).toBe('explicit');
  });
});
