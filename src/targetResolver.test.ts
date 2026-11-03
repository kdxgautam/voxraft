import {describe,expect,it} from 'vitest';
import {clarifyActions,emptyScene,execute,SceneError} from './scene';
import {resolvePlannedActions} from './targetResolver';

function diagram(){
  let scene=execute(emptyScene(),[
    {type:'ADD_NODE',label:'Frontend'},
    {type:'ADD_NODE',label:'Authentication Services'},
    {type:'ADD_NODE',label:'Authentication Services'},
    {type:'ADD_NODE',label:'Redis'},
    {type:'ADD_NODE',label:'Main database'},
    {type:'ADD_NODE',label:'Backup database'},
  ]);
  const [frontend,connected,isolated,redis,main,backup]=scene.nodes;
  scene=execute(scene,[
    {type:'ADD_EDGE',source:frontend.id,target:connected.id},
    {type:'ADD_EDGE',source:connected.id,target:redis.id},
    {type:'ADD_EDGE',source:redis.id,target:main.id},
    {type:'ADD_EDGE',source:frontend.id,target:main.id},
  ]);
  return {scene,frontend,connected,isolated,redis,main,backup};
}

describe('planned target resolution',()=>{
  it('colors the second database after clarification and honors a selected block',()=>{
    const scene=execute(emptyScene(),[
      {type:'ADD_NODE',label:'Primary Database'},
      {type:'ADD_NODE',label:'Backup Database'},
    ]);
    let question:SceneError;
    try{resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:'database',color:'orange'}],'Make the database orange',null);throw new Error('Expected clarification');}
    catch(error){if(!(error instanceof SceneError))throw error;question=error;}
    expect(question.candidateIds).toEqual(scene.nodes.map(node=>node.id));
    const colored=execute(scene,clarifyActions(scene,question.actions!,question.reference!,question.candidateIds,'second one',null));
    expect(colored.nodes[0].color).not.toBe('#f59e0b');
    expect(colored.nodes[1].color).toBe('#f59e0b');
    const selected=resolvePlannedActions(colored,[{type:'UPDATE_NODE',target:scene.nodes[0].id,color:'green'}],'Make this green',scene.nodes[1].id);
    expect(execute(colored,selected).nodes[1].color).toBe('#10b981');
  });
  it('corrects a wrong model ID for an isolated or connected duplicate',()=>{
    const {scene,connected,isolated,redis}=diagram();
    const isolatedAction=resolvePlannedActions(scene,[{type:'DELETE_NODE',target:connected.id}],"Remove the Authentication Services which isn't connected to any other block",null);
    expect(isolatedAction).toEqual([{type:'DELETE_NODE',target:isolated.id}]);
    const connectedAction=resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:isolated.id,color:'orange'}],'Make the Authentication Services connected to Redis orange',null);
    expect(connectedAction).toEqual([{type:'UPDATE_NODE',target:connected.id,color:'orange'}]);
    expect(redis.id).toBeTruthy();
  });

  it('checks incoming and multiple graph relationships',()=>{
    const {scene,main,backup}=diagram();
    const incoming=resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:backup.id,color:'blue'}],'Make the database that receives data from Redis blue',null);
    expect(incoming[0]).toMatchObject({target:main.id});
    const both=resolvePlannedActions(scene,[{type:'DELETE_NODE',target:backup.id}],'Delete the database connected to both Frontend and Redis',null);
    expect(both[0]).toMatchObject({target:main.id});
    expect(()=>resolvePlannedActions(scene,[{type:'DELETE_NODE',target:main.id}],'Delete the database connected to both Frontend and Backup database',null)).toThrow(/No node matches/);
  });

  it('checks the spoken name even if the model returns another node ID',()=>{
    const {scene,frontend,redis}=diagram();
    const actions=resolvePlannedActions(scene,[{type:'DELETE_NODE',target:redis.id}],'Remove Frontend',null);
    expect(actions[0]).toMatchObject({target:frontend.id});
    expect(()=>resolvePlannedActions(scene,[{type:'DELETE_NODE',target:frontend.id}],'Remove Billing Service',null)).toThrow(/couldn't match/);
  });

  it('moves the front end block before the API gateway',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_NODE',label:'API Gateway'}]);
    const actions=resolvePlannedActions(scene,[{type:'MOVE_NODE',target:scene.nodes[0].id,direction:'left',relativeTo:scene.nodes[1].id}],'Put the front end block before the API gateway.',null);
    const moved=execute(scene,actions);
    expect(moved.nodes[0].x).toBe(moved.nodes[1].x-260);
    const fallbackActions=resolvePlannedActions(scene,[{type:'MOVE_NODE',target:'front end block',direction:'left',relativeTo:'API gateway'}],'Put the front end block before the API gateway.',null);
    expect(fallbackActions[0]).toMatchObject({target:scene.nodes[0].id,relativeTo:scene.nodes[1].id});
  });

  it('uses visual order for second, and asks when duplicate names remain',()=>{
    const {scene,connected,isolated}=diagram();
    scene.nodes.find(node=>node.id===connected.id)!.x=600;
    scene.nodes.find(node=>node.id===isolated.id)!.x=200;
    const second=resolvePlannedActions(scene,[{type:'DELETE_NODE',target:isolated.id}],'Delete the second Authentication Services',null);
    expect(second[0]).toMatchObject({target:connected.id});
    try{resolvePlannedActions(scene,[{type:'DELETE_NODE',target:connected.id}],'Delete Authentication Services',null);throw new Error('Expected clarification');}
    catch(error){expect(error).toBeInstanceOf(SceneError);expect((error as SceneError).candidateIds).toEqual([isolated.id,connected.id]);}
  });

  it('honors keep/remove negation and selection, but asks for conflicting pronouns',()=>{
    const {scene,connected,isolated}=diagram();
    const other=resolvePlannedActions(scene,[{type:'DELETE_NODE',target:connected.id}],'Keep the connected Authentication Services and remove the other one',null);
    expect(other[0]).toMatchObject({target:isolated.id});
    const selected=resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:connected.id,color:'green'}],'Make this green',isolated.id);
    expect(selected[0]).toMatchObject({target:isolated.id});
    expect(()=>resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:connected.id,color:'green'}],'Make that green',isolated.id)).toThrow(/selected node or the last edited/);
    try{resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:connected.id,color:'green'}],'Make that box green',isolated.id);}
    catch(error){
      const question=error as SceneError;
      const clarified=clarifyActions(scene,question.actions!,question.reference!,question.candidateIds,'this one',isolated.id);
      expect(execute(scene,clarified).nodes.find(node=>node.id===isolated.id)!.color).toBe('#10b981');
    }
  });

  it('checks edge endpoints while allowing references to nodes added earlier in a batch',()=>{
    const {scene,frontend,connected}=diagram();
    expect(()=>resolvePlannedActions(scene,[{type:'ADD_EDGE',source:connected.id,target:frontend.id}],'Connect Authentication Services to Frontend',null)).toThrow(/Which Authentication Services/);
    const actions=resolvePlannedActions(scene,[{type:'ADD_NODE',label:'Queue'},{type:'ADD_EDGE',source:'Queue',target:frontend.id}],'Add Queue and connect Queue to Frontend',null);
    expect(actions[1]).toMatchObject({source:(actions[0] as {id:string}).id,target:frontend.id});
    expect(()=>resolvePlannedActions(scene,[{type:'ADD_NODE',label:'Frontend'},{type:'ADD_EDGE',source:'Frontend',target:connected.id}],'Add Frontend and connect Frontend to Authentication Services',null)).toThrow(/newly added node and an existing node/);
  });
  it('resolves a newly created node in a later move and keeps the command atomic',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Frontend'}]);
    const actions=resolvePlannedActions(scene,[{type:'ADD_NODE',label:'Redis'},{type:'MOVE_NODE',target:'Redis',direction:'above',relativeTo:'Frontend'}],'Add Redis and move Redis above Frontend',null);
    const next=execute(scene,actions);
    expect(next.nodes[1].y).toBe(next.nodes[0].y-160);
    expect(next.past).toHaveLength(scene.past.length+1);
    expect(execute(next,[{type:'UNDO'}]).nodes).toHaveLength(1);
  });
  it('moves selected blocks as a unit and applies a color to all of them',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Gateway'},{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Orders'}]);
    const ids=scene.nodes.slice(1).map(node=>node.id);
    const oldGap=scene.nodes[2].x-scene.nodes[1].x;
    const moved=execute(scene,resolvePlannedActions(scene,[{type:'MOVE_NODE',target:'these',direction:'below',relativeTo:'Gateway'}],'Move these below the gateway',null,ids));
    expect(moved.nodes[1].y).toBeGreaterThan(moved.nodes[0].y+moved.nodes[0].height);
    expect(moved.nodes[2].x-moved.nodes[1].x).toBe(oldGap);
    const colored=execute(moved,resolvePlannedActions(moved,[{type:'UPDATE_NODE',target:'these services',color:'blue'}],'Make these services blue',null,ids));
    expect(colored.nodes.slice(1).map(node=>node.color)).toEqual(['#3b82f6','#3b82f6']);
    expect(colored.past).toHaveLength(moved.past.length+1);
    const wrongSingleId=execute(moved,resolvePlannedActions(moved,[{type:'UPDATE_NODE',target:ids[0],color:'blue'}],'Make these services blue',null,ids));
    expect(wrongSingleId.nodes.slice(1).map(node=>node.color)).toEqual(['#3b82f6','#3b82f6']);
  });
  it('edits a named group and the selected arrow without guessing other targets',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Gateway'},{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Orders'},{type:'CREATE_GROUP',name:'backend services',targets:['Auth','Orders']},{type:'ADD_EDGE',source:'Gateway',target:'Auth'}]);
    scene=execute(scene,resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:'backend services',color:'green'}],'Make backend services green',null));
    expect(scene.nodes.slice(1).map(node=>node.color)).toEqual(['#10b981','#10b981']);
    const wrongGroupId=execute(scene,resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:scene.nodes[1].id,color:'blue'}],'Make backend services blue',null));
    expect(wrongGroupId.nodes.slice(1).map(node=>node.color)).toEqual(['#3b82f6','#3b82f6']);
    const edge=scene.edges[0];
    const actions=resolvePlannedActions(scene,[{type:'UPDATE_EDGE',edge:'this connection',label:'HTTPS'}],'Label this connection HTTPS',null,[],edge.id);
    expect(execute(scene,actions).edges[0].label).toBe('HTTPS');
    expect(()=>resolvePlannedActions(scene,[{type:'UPDATE_EDGE',edge:'this connection',label:'HTTPS'}],'Label this connection HTTPS',null,[],null)).not.toThrow();
  });
  it('uses the spoken connection endpoints if the planner chose another arrow',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Database'},{type:'ADD_NODE',label:'Redis'},{type:'ADD_EDGE',source:'Auth',target:'Database'},{type:'ADD_EDGE',source:'Auth',target:'Redis'}]);
    const actions=resolvePlannedActions(scene,[{type:'DELETE_EDGE',edge:scene.edges[1].id}],'Disconnect Auth from Database',null);
    const next=execute(scene,actions);
    expect(next.edges.map(edge=>edge.id)).toEqual([scene.edges[1].id]);
    expect(()=>execute(scene,[{type:'REVERSE_EDGE',edge:scene.edges[1].id,source:'Auth',target:'Database'}])).toThrow(/does not connect/);
  });
  it('creates a named group from the selected blocks',()=>{
    const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Gateway'},{type:'ADD_NODE',label:'Auth'},{type:'ADD_NODE',label:'Orders'}]);
    const ids=scene.nodes.slice(1).map(node=>node.id);
    const next=execute(scene,resolvePlannedActions(scene,[{type:'CREATE_GROUP',name:'backend services',targets:['these']}],'Group these as backend services',null,ids));
    expect(next.groups?.[0].nodeIds).toEqual(ids);
  });
  it('verifies spatial descriptions from current geometry even when the model chose another ID',()=>{
    const {scene,main,backup}=diagram();
    const actions=resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:backup.id,color:'blue'}],'Make the rightmost database blue',null);
    const next=execute(scene,actions);
    expect(next.nodes.find(node=>node.id===main.id)!.color).toBe('#3b82f6');
    expect(next.nodes.filter(node=>node.id!==main.id)).toEqual(scene.nodes.filter(node=>node.id!==main.id));
    expect(next.edges).toEqual(scene.edges);
    const tied=scene.nodes.find(node=>node.id===main.id)!;tied.x=backup.x;tied.width=backup.width;
    expect(()=>resolvePlannedActions(scene,[{type:'DELETE_NODE',target:main.id}],'Delete the rightmost database',null)).toThrow(/Which/);
  });
  it('edits and connects only scoped members, including children of collapsed nested containers',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth Service'},{type:'ADD_NODE',label:'Order Service'},{type:'ADD_NODE',label:'Database'},{type:'ADD_NODE',label:'Outside Service'}]);
    scene=execute(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth Service','Order Service']},{type:'CREATE_CONTAINER',name:'Platform',targets:[],childContainers:['Backend']},{type:'SET_CONTAINER_COLLAPSED',container:'Backend',collapsed:true}]);
    const [auth,order,database,outside]=scene.nodes;
    const actions=resolvePlannedActions(scene,[{type:'ADD_EDGE',source:outside.id,target:database.id}],'Connect all services inside Platform to Database',null);
    const connected=execute(scene,actions);
    expect(connected.edges.map(edge=>[edge.sourceId,edge.targetId])).toEqual([[auth.id,database.id],[order.id,database.id]]);
    expect(connected.nodes).toEqual(scene.nodes);
    expect(connected.containers).toEqual(scene.containers);
    expect(execute(connected,[{type:'UNDO'}]).edges).toEqual(scene.edges);
    const styled=execute(scene,resolvePlannedActions(scene,[{type:'UPDATE_NODE',target:outside.id,color:'green'}],'Make all services inside Platform green',null));
    expect(styled.nodes.slice(0,2).map(node=>node.color)).toEqual(['#10b981','#10b981']);
    expect(styled.nodes.slice(2)).toEqual(scene.nodes.slice(2));
    const moved=execute(scene,resolvePlannedActions(scene,[{type:'MOVE_NODE',target:outside.id,direction:'below',relativeTo:database.id}],'Move all blocks inside Platform below Database',null));
    expect(moved.nodes[1].x-moved.nodes[0].x).toBe(order.x-auth.x);
    expect(moved.nodes[0].y).toBeGreaterThan(database.y+database.height);
    expect(moved.nodes.slice(2)).toEqual(scene.nodes.slice(2));
    const enumerated=execute(scene,resolvePlannedActions(scene,[{type:'MOVE_NODE',target:auth.id,direction:'below',relativeTo:database.id},{type:'MOVE_NODE',target:order.id,direction:'below',relativeTo:database.id}],'Move all blocks inside Platform below Database',null));
    expect(enumerated.nodes).toEqual(moved.nodes);
    expect(()=>resolvePlannedActions(scene,[{type:'ADD_EDGE',source:auth.id,target:database.id}],'Connect Auth Service to the database inside Backend',null)).toThrow(/No block matches/);
    expect(()=>resolvePlannedActions(scene,[{type:'ADD_EDGE',source:auth.id,target:database.id}],'Connect services inside Backend to services inside Platform',null)).toThrow(/Both sides contain/);
    expect(scene.edges).toHaveLength(0);
  });
  it('clarifies one ambiguous destination for a whole scoped connection command',()=>{
    let scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Auth Service'},{type:'ADD_NODE',label:'Order Service'},{type:'ADD_NODE',label:'Database'},{type:'ADD_NODE',label:'Database'}]);
    scene=execute(scene,[{type:'CREATE_CONTAINER',name:'Backend',targets:['Auth Service','Order Service']}]);
    try{
      resolvePlannedActions(scene,[{type:'ADD_EDGE',source:scene.nodes[0].id,target:scene.nodes[2].id}],'Connect services inside Backend to Database',null);
      throw new Error('Expected clarification');
    }catch(error){
      expect(error).toBeInstanceOf(SceneError);
      const question=error as SceneError;
      const confirmed=clarifyActions(scene,question.actions!,question.reference!,question.candidateIds,'this one',scene.nodes[3].id);
      const next=execute(scene,confirmed);
      expect(next.edges).toHaveLength(2);
      expect(next.edges.every(edge=>edge.targetId===scene.nodes[3].id)).toBe(true);
      expect(next.past.length).toBe(scene.past.length+1);
    }
  });
});
