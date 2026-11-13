import {describe,expect,it,vi} from 'vitest';
vi.mock('@excalidraw/excalidraw',()=>({convertToExcalidrawElements:(elements:unknown)=>elements}));
import {toElements} from './diagramElements';
import {cylinderPartId} from './cylinder';
import {nodeTextColor} from './nodeAppearance';
import {readProject,writeProject} from './project';
import {emptyScene,execute,syncCanvas,type CanvasElement} from './scene';

describe('spoken block colors',()=>{
  it('uses contrasting text for light and dark fills',()=>{
    expect(nodeTextColor('#f59e0b')).toBe('#19243b');
    expect(nodeTextColor('#8b5cf6')).toBe('#ffffff');
  });
  it('fills every shape and keeps labels readable through save and undo',()=>{
    let scene=execute(emptyScene(),[
      {type:'ADD_NODE',label:'Web app'},
      {type:'ADD_NODE',label:'Decision',shape:'diamond'},
      {type:'ADD_NODE',label:'Start',shape:'ellipse'},
      {type:'ADD_NODE',label:'Database',shape:'cylinder'},
    ]);
    const original=scene;
    scene=execute(scene,[
      {type:'UPDATE_NODE',target:'Web app',color:'red'},
      {type:'UPDATE_NODE',target:'Decision',color:'blue'},
      {type:'UPDATE_NODE',target:'Start',color:'green'},
      {type:'UPDATE_NODE',target:'Database',color:'orange'},
    ]);
    const elements=toElements(scene);
    for(const node of scene.nodes){
      expect(node.fillColor).toBe(node.color);
      expect(elements.find(element=>element.id===node.id)?.backgroundColor).toBe(node.fillColor);
      expect(elements.find(element=>element.id===`${node.id}:label`)?.strokeColor).toBe(nodeTextColor(node.fillColor));
    }
    const database=scene.nodes[3];
    expect(elements.find(element=>element.id===cylinderPartId(database.id,'top'))?.backgroundColor).toBe(database.fillColor);
    expect(elements.find(element=>element.id===cylinderPartId(database.id,'bottom'))?.backgroundColor).toBe(database.fillColor);
    expect(readProject(writeProject(scene,[],'' )).scene.nodes.map(node=>node.fillColor)).toEqual(scene.nodes.map(node=>node.fillColor));
    expect(execute(scene,[{type:'UNDO'}]).nodes).toEqual(original.nodes);
  });

  it('keeps a manually edited fill in the canonical scene',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'API'}]);
    const node=scene.nodes[0];
    const elements:CanvasElement[]=[
      {id:node.id,type:'rectangle',x:node.x,y:node.y,width:node.width,height:node.height,strokeColor:node.color,backgroundColor:'#ef4444'},
      {id:`${node.id}:label`,type:'text',x:node.x,y:node.y,width:node.width,height:20,strokeColor:'#19243b',text:node.label},
    ];
    const filled=syncCanvas(scene,elements);
    expect(filled.nodes[0].fillColor).toBe('#ef4444');
    expect(toElements(filled).find(element=>element.id===node.id)?.backgroundColor).toBe('#ef4444');
  });
});
