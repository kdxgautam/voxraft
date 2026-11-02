import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {cylinderCanvasElements,cylinderPartId,cylinderParts} from './cylinder';
import {routeEdge} from './edgeRouting';
import {LayoutPreview} from './layoutCritique';
import {shapeBoundary} from './shapeGeometry';
import {readProject,writeProject} from './project';
import {emptyScene,execute,selectedNodeIds,syncCanvas,type CanvasElement} from './scene';

function rawCylinder(node:ReturnType<typeof execute>['nodes'][number]):CanvasElement[]{
  const parts=cylinderParts(node);
  return [
    {id:node.id,type:'rectangle',...parts.body,strokeColor:node.color},
    {id:cylinderPartId(node.id,'bottom'),type:'ellipse',...parts.bottom,strokeColor:node.color},
    {id:cylinderPartId(node.id,'top'),type:'ellipse',...parts.top,strokeColor:node.color},
    {id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:node.width,height:30,strokeColor:'#19243b',text:node.label,originalText:node.label},
  ];
}

describe('composite database cylinder',()=>{
  it('keeps one canonical node through drag, selection, connection, save, and undo',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'PostgreSQL database',shape:'cylinder'},
      {type:'ADD_EDGE',source:'API',target:'PostgreSQL database'},
      {type:'CREATE_CONTAINER',name:'Data tier',targets:['API','PostgreSQL database']}]);
    const db=scene.nodes[1],api=scene.nodes[0],edge=scene.edges[0];
    expect(cylinderCanvasElements(db).map(part=>part.id)).toEqual([db.id,cylinderPartId(db.id,'bottom'),cylinderPartId(db.id,'top')]);
    expect(new Set(cylinderCanvasElements(db).flatMap(part=>part.groupIds))).toEqual(new Set([`cylinder:${db.id}`]));
    expect(selectedNodeIds(scene,{[cylinderPartId(db.id,'top')]:true,[cylinderPartId(db.id,'bottom')]:true})).toEqual([db.id]);
    const elements:CanvasElement[]=[
      {id:api.id,type:'rectangle',x:api.x,y:api.y,width:api.width,height:api.height,strokeColor:api.color},
      ...rawCylinder(db).map(part=>part.id===`${db.id}:label`?part:{...part,x:part.x+55,y:part.y+35}),
      {id:edge.id,type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#444',startBinding:{elementId:api.id},endBinding:{elementId:cylinderPartId(db.id,'top')}},
    ];
    const changed=syncCanvas(scene,elements);
    expect(changed.nodes).toHaveLength(2);
    expect(changed.nodes[1]).toMatchObject({id:db.id,shape:'cylinder',x:db.x+55,y:db.y+35});
    expect(changed.edges).toEqual(scene.edges);
    expect(changed.containers).toEqual(scene.containers);
    expect(changed.extras).toEqual([]);
    expect(execute(changed,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
    const imported=readProject(writeProject(changed,[],'' )).scene;
    expect(imported.nodes[1]).toMatchObject({id:db.id,shape:'cylinder'});
    scene=imported;
    const collapsed=execute(scene,[{type:'SET_CONTAINER_COLLAPSED',container:scene.containers![0].id,collapsed:true}]);
    expect(collapsed.nodes[1].shape).toBe('cylinder');
    expect(execute(collapsed,[{type:'UNDO'}]).nodes[1].shape).toBe('cylinder');
  });

  it('uses the visible cylinder silhouette for arrows and previews',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'PostgreSQL',shape:'cylinder'},
      {type:'ADD_EDGE',source:'API',target:'PostgreSQL'}]);
    const db=scene.nodes[1],route=routeEdge(scene,scene.edges[0]);
    expect(route.tx).toBeCloseTo(db.x);
    const top=shapeBoundary(db,{x:db.x+db.width*.75,y:db.y-100});
    expect(top.y).toBeLessThan(db.y+cylinderParts(db).top.height/2);
    const cap=cylinderParts(db).top.height;
    expect(((top.x-(db.x+db.width/2))/(db.width/2))**2+((top.y-(db.y+cap/2))/(cap/2))**2).toBeCloseTo(1,4);
    const positions=Object.fromEntries(scene.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));
    const markup=renderToStaticMarkup(React.createElement(LayoutPreview,{scene,positions}));
    expect(markup.match(/<ellipse/g)).toHaveLength(2);
    expect(markup).toContain('PostgreSQL');
  });
  it('maps cap edits and a newly bound arrow back to the same node',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'},{type:'ADD_NODE',label:'PostgreSQL',shape:'cylinder'}]);
    const [api,db]=scene.nodes;
    const elements:CanvasElement[]=[
      {id:api.id,type:'rectangle',x:api.x,y:api.y,width:api.width,height:api.height,strokeColor:api.color},
      ...rawCylinder(db).map(part=>part.id===cylinderPartId(db.id,'top')?{...part,x:part.x+30,y:part.y+20,strokeColor:'#123456'}:part),
      {id:'manual-arrow',type:'arrow',x:0,y:0,width:10,height:10,strokeColor:'#333',startBinding:{elementId:api.id},endBinding:{elementId:cylinderPartId(db.id,'bottom')}},
    ];
    const edited=syncCanvas(scene,elements);
    expect(edited.nodes).toHaveLength(2);
    expect(edited.nodes[1]).toMatchObject({id:db.id,x:db.x+30,y:db.y+20,color:'#123456'});
    expect(edited.edges).toMatchObject([{id:'manual-arrow',sourceId:api.id,targetId:db.id}]);
    const withoutCap=syncCanvas(scene,elements.filter(part=>part.id!==cylinderPartId(db.id,'top')));
    expect(withoutCap.nodes[1].shape).toBe('cylinder');
    expect(withoutCap.extras).toEqual([]);
  });
  it('does not add undo history when the rendered parts are unchanged',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Long named PostgreSQL database replica',shape:'cylinder'}]);
    expect(syncCanvas(scene,rawCylinder(scene.nodes[0]))).toBe(scene);
  });
  it('maps a cap resize onto the canonical node dimensions',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'PostgreSQL',shape:'cylinder'}]);
    const raw=rawCylinder(scene.nodes[0]).map(part=>part.id===cylinderPartId(scene.nodes[0].id,'top')?{...part,width:part.width+40,height:part.height+12}:part);
    const resized=syncCanvas(scene,raw);
    expect(resized.nodes[0].width).toBe(scene.nodes[0].width+40);
    expect(resized.nodes[0].height).toBe(scene.nodes[0].height+12);
  });
  it('removes generated caps when the canonical body is deleted',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'PostgreSQL',shape:'cylinder'}]);
    const remaining=rawCylinder(scene.nodes[0]).filter(part=>part.id!==scene.nodes[0].id);
    const changed=syncCanvas(scene,remaining);
    expect(changed.nodes).toEqual([]);
    expect(changed.extras).toEqual([]);
    expect(execute(changed,[{type:'UNDO'}]).nodes).toEqual(scene.nodes);
  });
});
