import {describe,expect,it} from 'vitest';
import {routeEdge} from './edgeRouting';
import type {Edge,Node} from './scene';

const node=(id:string,x:number,y:number):Node=>({id,label:id,shape:'rectangle',x,y,width:180,height:80,color:'#6366f1'});
const edge=(sourceId:string,targetId:string):Edge=>({id:'edge',sourceId,targetId,label:''});
const crosses=(route:ReturnType<typeof routeEdge>,block:Node)=>route.points.slice(1).some((point,index)=>{
  const [x1,y1]=route.points[index].map((value,axis)=>value+(axis?route.y:route.x));
  const [x2,y2]=point.map((value,axis)=>value+(axis?route.y:route.x));
  return Math.min(x1,x2)<block.x+block.width&&Math.max(x1,x2)>block.x
    &&Math.min(y1,y2)<block.y+block.height&&Math.max(y1,y2)>block.y;
});

describe('connection routing',()=>{
  it('routes a long horizontal connection around intervening blocks',()=>{
    const nodes=['Auth','Orders','Billing','Redis','Database'].map((id,index)=>node(id,100+index*220,100));
    const direct=routeEdge({nodes},edge('Auth','Orders'));
    expect(direct.points).toHaveLength(2);
    const long=routeEdge({nodes},edge('Auth','Database'));
    expect(long.points).toHaveLength(5);
    for(const block of nodes.slice(1,-1))expect(crosses(long,block)).toBe(false);
    expect(long.y+long.points.at(-1)![1]).toBe(nodes[4].y);
    expect(long.labelY).toBeLessThan(nodes[0].y);
  });
  it('keeps several connections to one database visually separate',()=>{
    const nodes=['Auth','Orders','Billing','Database'].map((id,index)=>node(id,100+index*220,100));
    const edges=[edge('Auth','Database'),edge('Orders','Database'),edge('Billing','Database')].map((item,index)=>({...item,id:`e${index}`}));
    const routes=edges.map(item=>routeEdge({nodes,edges},item));
    const [auth,orders,billing]=routes;
    expect(auth.labelY).toBeLessThan(orders.labelY);
    expect(auth.tx).toBeGreaterThan(orders.tx);
    expect(auth.tx).toBeGreaterThan(nodes[3].x);
    expect(orders.tx).toBeGreaterThan(nodes[3].x);
    expect(auth.ty).toBe(nodes[3].y);
    expect(orders.ty).toBe(nodes[3].y+nodes[3].height);
    expect(billing.tx).toBe(nodes[3].x);
    expect(billing.ty).toBeGreaterThan(nodes[3].y+nodes[3].height/2);
    for(const block of nodes.slice(1,-1))expect(crosses(auth,block)).toBe(false);
  });
  it('fans direct incoming arrows across the target side',()=>{
    const nodes=[node('Auth',100,100),node('Orders',100,280),node('Billing',100,460),node('Database',460,280)];
    const edges=['Auth','Orders','Billing'].map((sourceId,index)=>({...edge(sourceId,'Database'),id:`e${index}`}));
    const routes=edges.map(item=>routeEdge({nodes,edges},item));
    expect(routes.map(route=>route.tx)).toEqual([460,460,460]);
    expect(routes[0].ty).toBeLessThan(routes[1].ty);
    expect(routes[1].ty).toBeLessThan(routes[2].ty);
  });
  it('puts labels from parallel long routes in separate lanes below the blocks',()=>{
    const nodes=['Auth','Orders','Billing','Database'].map((id,index)=>node(id,100+index*220,100));
    const edges=[{...edge('Auth','Database'),id:'auth',label:'auth request'},
      {...edge('Orders','Database'),id:'orders',label:'orders API'}];
    const auth=routeEdge({nodes,edges},edges[0]);
    const orders=routeEdge({nodes,edges},edges[1]);
    expect(auth.labelY).toBeGreaterThan(nodes[0].y+nodes[0].height+30);
    expect(orders.labelY).toBeGreaterThan(nodes[0].y+nodes[0].height+30);
    expect(auth.labelY-orders.labelY).toBeGreaterThanOrEqual(44);
    expect(auth.ty).toBe(nodes[3].y+nodes[3].height);
    expect(orders.ty).toBe(nodes[3].y+nodes[3].height);
  });
  it('routes a long vertical connection around intervening blocks',()=>{
    const nodes=['API','Auth','Billing','Database'].map((id,index)=>node(id,100,100+index*160));
    const long=routeEdge({nodes},edge('API','Database'));
    expect(long.points).toHaveLength(6);
    for(const block of nodes.slice(1,-1))expect(crosses(long,block)).toBe(false);
    expect(long.y+long.points.at(-1)![1]).toBe(nodes[3].y);
  });
});
