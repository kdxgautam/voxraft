import { actionSchema, descendantNodeIds, effectiveDiagramType, execute, newId, resolveContainer, SceneError, type Action, type Node, type Scene } from './scene';
import { z } from 'zod';

const normalize=(value:string)=>value.toLowerCase().replace(/\bfront[\s-]?end\b/g,'frontend').replace(/^(?:the|a|an)\s+/,'').replace(/\s+(?:block|component)$/,'').replace(/[.,!?]+$/,'').trim();
const ordinal:Record<string,number>={first:0,second:1,third:2};
const selectedWord=(value:string)=>/^(?:the )?(?:this|selected)(?: (?:one|node|box|block|component))?$/i.test(value.trim());
const vagueWord=(value:string)=>/^(?:the )?(?:that(?: (?:one|node|box|block|component))?|it)$/i.test(value.trim());

function describedTargets(scene:Scene,ref:string):Node[]|null{
  let phrase=normalize(ref).replace(/^all\s+(?:the\s+)?/,'');
  let candidates=scene.nodes;
  const scope=phrase.match(/^(.+?)\s+(?:inside|in|within)\s+(.+)$/);
  if(scope){
    const container=resolveContainer(scene,scope[2]);
    const members=new Set(descendantNodeIds(scene,container));
    candidates=candidates.filter(node=>members.has(node.id));phrase=scope[1];
  }
  const spatial=phrase.match(/^(leftmost|rightmost|topmost|bottommost)(?:\s+(.+))?$/);
  if(!scope&&!spatial)return null;
  if(spatial)phrase=spatial[2]||'node';
  phrase=phrase.replace(/^(?:the|a|an)\s+/,'').replace(/\b(services|databases)\b/g,word=>word.slice(0,-1));
  if(!/^(?:blocks?|boxes|box|nodes?|components?)$/.test(phrase))
    candidates=candidates.filter(node=>normalize(node.label).includes(phrase));
  if(spatial&&candidates.length){
    const coordinate=(node:Node)=>spatial[1]==='leftmost'?node.x:spatial[1]==='rightmost'?-(node.x+node.width):spatial[1]==='topmost'?node.y:-(node.y+node.height);
    const extreme=Math.min(...candidates.map(coordinate));
    candidates=candidates.filter(node=>Math.abs(coordinate(node)-extreme)<1);
  }
  return candidates;
}

function matches(scene:Scene,ref:string):Node[]{
  const byId=scene.nodes.find(node=>node.id===ref);
  if(byId)return scene.nodes.filter(node=>normalize(node.label)===normalize(byId.label));
  const value=normalize(ref);
  const exact=scene.nodes.filter(node=>normalize(node.label)===value);
  return exact.length?exact:describedTargets(scene,ref)??scene.nodes.filter(node=>normalize(node.label).includes(value)||value.includes(normalize(node.label)));
}

function namedTarget(command:string,scene:Scene):Node[]|null{
  const relationMentions=[...command.matchAll(/\b(?:remove|delete|rename|move|make|color|colour)\s+(?:the\s+)?(.+?)\s+(?:(?:which|that)\s+)?(?:is\s+|are\s+)?(?:connected|unconnected|disconnected|isolated|receives?|receiving|fed\s+by|sends?|sending|feeds?)\b/gi)];
  const simpleMentions=[
    ...command.matchAll(/\b(?:remove|delete)\s+(?:the\s+)?(.+?)(?:[.!?,]|$)/gi),
    ...command.matchAll(/\b(?:make|color|colour)\s+(?:the\s+)?(.+?)\s+(?:red|blue|green|orange|purple|pink|yellow|gray|grey)(?:[.!?,]|$)/gi),
    ...command.matchAll(/\b(?:make|turn|change)\s+(?:the\s+)?(.+?)\s+(?:(?:into\s+)?(?:a|an)\s+)?(?:rectangle|ellipse|oval|diamond|cylinder)(?:[.!?,]|$)/gi),
    ...command.matchAll(/\b(?:rename|call)\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+/gi),
    ...command.matchAll(/\b(?:move|place|put)\s+(?:the\s+)?(.+?)\s+(?:above|below|left|right|before|after|to the)\b/gi),
  ];
  const raw=relationMentions.at(-1)?.[1]||simpleMentions.sort((a,b)=>(b.index??0)-(a.index??0))[0]?.[1];
  if(!raw)return null;
  const name=normalize(raw.replace(/\s+(?:which|that)\b.*$/i,'').replace(/^(?:isolated|unconnected|disconnected)\s+/i,''));
  if(!name||/^(?:other one|this|that|it|selected)(?: node| one)?$/.test(name))return null;
  const found=matches(scene,name);
  if(!found.length)throw new SceneError(`I couldn't match “${name}” to a node. Nothing was changed.`);
  return found;
}

function relation(command:string):{kind:'isolated'|'connected'|'incoming'|'outgoing';peer?:string;negative?:boolean}[] {
  const rules:ReturnType<typeof relation>=[];
  if(/\b(?:isolated|unconnected|disconnected)\b|\b(?:not|isn.t|isnt|no)\s+(?:connected|linked|attached)\s+to\s+(?:any|another|other)\b/i.test(command)
    || /\bkeep\b.+\bconnected\b.+\b(?:remove|delete)\s+(?:the\s+)?other\b/i.test(command)){
    rules.push({kind:'isolated'});return rules;
  }
  const both=command.match(/\bconnected\s+to\s+both\s+(.+?)\s+and\s+(.+?)(?:[.!?,]|$)/i);
  if(both){rules.push({kind:'connected',peer:both[1]},{kind:'connected',peer:both[2]});return rules;}
  const incoming=command.match(/\b(?:receives?|receiving)(?:\s+data)?\s+from\s+(.+?)(?:[.!?,]|$)/i)
    || command.match(/\bfed\s+by\s+(.+?)(?:[.!?,]|$)/i);
  if(incoming)rules.push({kind:'incoming',peer:incoming[1]});
  const outgoing=command.match(/\b(?:sends?|sending)(?:\s+data)?\s+to\s+(.+?)(?:[.!?,]|$)/i)
    || command.match(/\bfeeds?\s+(.+?)(?:[.!?,]|$)/i);
  if(outgoing)rules.push({kind:'outgoing',peer:outgoing[1]});
  const connected=command.match(/\b(?:(not|isn.t|isnt)\s+)?connected\s+to\s+(.+?)(?:[.!?,]|$)/i);
  if(connected)rules.push({kind:'connected',peer:connected[2],negative:!!connected[1]});
  return rules;
}

function resolve(scene:Scene,original:Scene,ref:string,command:string,selectedId:string|null,constrain:boolean,created:string[]):string{
  if(constrain&&/\b(?:remove|delete|rename|move|make|color|colour)\s+(?:the\s+)?(?:this|selected)(?:\s+(?:one|node))?\b/i.test(command)){
    if(selectedId)return selectedId;
    throw new SceneError('Select a node, or tell me which node you mean.',true,ref);
  }
  if(constrain&&/\b(?:remove|delete|rename|move|make|color|colour)\s+(?:the\s+)?(?:that|it)(?:\s+one)?\b/i.test(command)){
    try{return resolve(scene,original,'that',command,selectedId,false,created);}
    catch(error){if(error instanceof SceneError&&error.clarification)error.reference=ref;throw error;}
  }
  if(selectedWord(ref)){
    if(selectedId)return selectedId;
    throw new SceneError('Select a node, or tell me which node you mean.',true,ref);
  }
  if(vagueWord(ref)){
    const recent=scene.nodes.find(node=>node.id===scene.recentIds[0]);
    if(selectedId&&recent&&selectedId!==recent.id)throw new SceneError('Do you mean the selected node or the last edited node?',true,ref,[selectedId,recent.id]);
    if(selectedId||recent)return selectedId||recent!.id;
    throw new SceneError('Which node do you mean?',true,ref);
  }
  if(created.includes(normalize(ref))&&matches(original,ref).length){
    throw new SceneError(`A newly added node and an existing node are both named “${ref}”. Please use a distinct name.`);
  }
  let candidates=constrain?namedTarget(command,scene)||matches(scene,ref):matches(scene,ref);
  if(!candidates.length){
    if(describedTargets(scene,ref)!==null)throw new SceneError(`No block matches “${ref}”. Nothing was changed.`);
    return ref;
  }
  if(constrain){
    const rules=relation(command);
    for(const rule of rules){
      if(rule.kind==='isolated'){
        candidates=candidates.filter(node=>!scene.edges.some(edge=>edge.sourceId===node.id||edge.targetId===node.id));
        continue;
      }
      const peers=matches(scene,rule.peer!.trim().replace(/^(?:the|a|an)\s+/i,''));
      if(peers.length!==1)throw new SceneError(`Which node does “${rule.peer?.trim()}” refer to?`);
      const peer=peers[0];
      candidates=candidates.filter(node=>{
        const connected=scene.edges.some(edge=>rule.kind==='incoming'?edge.sourceId===peer.id&&edge.targetId===node.id
          :rule.kind==='outgoing'?edge.sourceId===node.id&&edge.targetId===peer.id
          :(edge.sourceId===node.id&&edge.targetId===peer.id)||(edge.targetId===node.id&&edge.sourceId===peer.id));
        return rule.negative?!connected:connected;
      });
    }
    const order=command.match(/\b(first|second|third)\b/i);
    if(order&&candidates.length>1){
      const sorted=[...candidates].sort((a,b)=>a.x-b.x||a.y-b.y);
      candidates=sorted[ordinal[order[1].toLowerCase()]]?[sorted[ordinal[order[1].toLowerCase()]]]:[];
    }
  }
  if(candidates.length===1)return candidates[0].id;
  if(!candidates.length)throw new SceneError('No node matches the description in that command. Nothing was changed.');
  const sorted=[...candidates].sort((a,b)=>a.x-b.x||a.y-b.y);
  throw new SceneError(`Which ${sorted[0].label} do you mean? Select it and say “this one”, or say its position from left to right.`,true,ref,sorted.map(node=>node.id));
}

const pluralReference=(value:string)=>/^(?:these|those|selected)(?:\s+(?:ones|nodes|blocks|services|components))?$/i.test(value.trim());
const edgeReference=(value:string)=>/^(?:this|that|it|last)(?:\s+(?:arrow|connection|edge))?$/i.test(value.trim());
function groupTargets(scene:Scene,target:string,selectedIds:string[]):string[]|null{
  if(pluralReference(target)){
    if(selectedIds.length<2)throw new SceneError('Select at least two blocks before referring to “these”.');
    return selectedIds;
  }
  if(/^(?:all\s+)?(?:the\s+)?(?:blocks|boxes|nodes|components|services|databases)\s+(?:inside|in|within)\s+/i.test(target.trim())){
    const nodes=describedTargets(scene,target)||[];
    if(!nodes.length)throw new SceneError(`No blocks match “${target}”. Nothing was changed.`);
    return nodes.map(node=>node.id);
  }
  const group=scene.groups?.find(item=>normalize(item.name)===normalize(target));
  if(!group)return null;
  if(scene.nodes.some(node=>normalize(node.label)===normalize(target)))throw new SceneError(`“${target}” names both a block and a group. Please select the blocks.`);
  return group.nodeIds.filter(id=>scene.nodes.some(node=>node.id===id));
}
function commandGroup(scene:Scene,command:string):string[]|null{
  const scoped=command.trim().replace(/[.!?]+$/,'').match(/^(?:make|color|colour)\s+(.+?)\s+(?:blue|green|red|orange|purple|pink|yellow|gray|grey)$/i)
    ||command.trim().replace(/[.!?]+$/,'').match(/^(?:move|put|place)\s+(.+?)\s+(?:above|below|left|right|before|after)(?:\s+.*)?$/i)
    ||command.trim().replace(/[.!?]+$/,'').match(/^(?:delete|remove)\s+(.+)$/i);
  if(scoped&&/^(?:all\s+)?(?:the\s+)?(?:blocks|boxes|nodes|components|services|databases)\s+(?:inside|in|within)\s+/i.test(scoped[1]))return groupTargets(scene,scoped[1],[]);
  const verb=command.match(/^\s*(?:make|color|colour|move|put|place|delete|remove)\s+(?:the\s+)?/i);
  if(!verb)return null;
  const phrase=command.slice(verb[0].length).trim().replace(/[.!?]$/,'');
  const group=scene.groups?.find(item=>{
    const name=item.name.toLowerCase();
    if(phrase.toLowerCase()===name)return true;
    if(!phrase.toLowerCase().startsWith(`${name} `))return false;
    return /^(?:blue|green|red|orange|purple|pink|yellow|gray|grey|above|below|left|right|before|after|to\b)/i.test(phrase.slice(name.length).trim());
  });
  return group?.nodeIds||null;
}
function moveGroup(scene:Scene,ids:string[],action:Extract<Action,{type:'MOVE_NODE'}>,relativeTo?:string):Action[]{
  const nodes=ids.map(id=>scene.nodes.find(node=>node.id===id)!);
  const left=Math.min(...nodes.map(node=>node.x)),top=Math.min(...nodes.map(node=>node.y));
  const right=Math.max(...nodes.map(node=>node.x+node.width)),bottom=Math.max(...nodes.map(node=>node.y+node.height));
  let dx=0,dy=0;
  if(relativeTo){
    const other=scene.nodes.find(node=>node.id===relativeTo)!;
    if(ids.includes(other.id))throw new SceneError('The reference block is part of the group being moved.');
    const direction=action.direction||'right';
    if(direction==='above')dy=other.y-40-bottom;
    if(direction==='below')dy=other.y+other.height+40-top;
    if(direction==='left')dx=other.x-40-right;
    if(direction==='right')dx=other.x+other.width+40-left;
  }else if(action.x!==undefined&&action.y!==undefined){dx=action.x-left;dy=action.y-top;}
  else if(action.direction){dx=action.direction==='right'?260:action.direction==='left'?-260:0;dy=action.direction==='below'?160:action.direction==='above'?-160:0;}
  else throw new SceneError('Move needs a direction or coordinates.');
  return nodes.map(node=>({type:'MOVE_NODE',target:node.id,x:node.x+dx,y:node.y+dy}));
}

export function resolvePlannedActions(scene:Scene,input:unknown,command:string,selectedId:string|null,selectedIds:string[]=selectedId?[selectedId]:[],selectedEdgeId:string|null=null):Action[]{
  let actions=z.array(actionSchema).min(1).parse(input);
  if(scene.context.type==='brainstorming'&&actions.some(action=>action.type==='ADD_EDGE'||action.type==='INSERT_BETWEEN')
    &&!/(?:\b(?:connect|link|relate|related|associate|join|tie|dependency|relationship|parent|child|branch|sequence|between|arrow|line)\b)/i.test(command))
    throw new SceneError('Connections in Brainstorming are added only when you ask for them.');
  const explicitlyNamedShape=/\b(?:rectangle|ellipse|oval|diamond|cylinder|decision|condition)\b/i.test(command);
  const explicitlyNamedRole=/^(?:add|create|make)\s+an?\s+(?:note|process|decision|start|end|topic|component|database)(?:\s+(?:node|block))?\s+(?:called|named)\b/i.test(command);
  const explicitlyNamedRelation=/\b(?:parent|child|branch|sequence|dependency|association|related)\b/i.test(command);
  const requestedArrowhead=/\b(?:with|as|using)\s+(?:an?\s+)?(?:plain\s+|straight\s+)?line\b|\b(?:without|no)\s+(?:an?\s+)?arrow(?:head)?\b/i.test(command)?'none' as const
    :/\b(?:with|as|using)\s+(?:an?\s+)?arrow(?:head)?\b/i.test(command)?'arrow' as const:undefined;
  // A single group instruction is one translation/style change even if the
  // planner enumerated members; translating each member independently stacks them.
  if(actions.length>1&&['MOVE_NODE','UPDATE_NODE','DELETE_NODE'].includes(actions[0].type)
    &&actions.every(action=>action.type===actions[0].type)&&!/[;,]|\b(?:and|then)\b/i.test(command)
    &&(commandGroup(scene,command)||/^(?:move|make|color|colour|delete|remove)\s+(?:these|those)\b/i.test(command)))actions=[actions[0]];
  const verifiedIds=new Set<string>();
  const connection=command.trim().replace(/[.!?]+$/,'').match(/^(?:please\s+)?(?:connect|link)\s+(.+?)\s+(?:to|with)\s+(.+)$/i);
  if(connection&&actions.every(action=>action.type==='ADD_EDGE')&&!/\b(?:and|then)\s+(?:connect|link|add|create|move)\b/i.test(command)){
    const sources=groupTargets(scene,connection[1],selectedIds),targets=groupTargets(scene,connection[2],selectedIds);
    if((sources?.length||0)>1&&(targets?.length||0)>1)throw new SceneError('Both sides contain several blocks. Name one source or destination, or specify the individual pairs.');
    if(sources||targets||describedTargets(scene,connection[1])||describedTargets(scene,connection[2])){
      for(const id of [...sources||[],...targets||[]])verifiedIds.add(id);
      const label=actions[0].type==='ADD_EDGE'?actions[0].label:undefined;
      const edgeRelation=actions[0].type==='ADD_EDGE'?actions[0].relation:undefined;
      const relationSource=actions[0].type==='ADD_EDGE'?actions[0].relationSource:undefined;
      const arrowhead=actions[0].type==='ADD_EDGE'?actions[0].arrowhead:undefined;
      actions=(sources||[connection[1]]).flatMap(source=>(targets||[connection[2]]).map(target=>({type:'ADD_EDGE' as const,source,target,label,relation:edgeRelation,relationSource,arrowhead})));
    }
  }
  const created:string[]=[];
  const singleTargetEdit=actions.filter(action=>action.type==='MOVE_NODE'||action.type==='UPDATE_NODE'||action.type==='DELETE_NODE').length===1;
  const explicitPlural=actions.length===1&&/\b(?:these|those)\s+(?:ones|nodes|blocks|services|components)\b|\b(?:move|make|color|colour|delete|remove)\s+(?:these|those)\b/i.test(command);
  let draft=scene;
  const result:Action[]=[];
  try{for(const action of actions){
    let resolved:Action[]=[action];
    if(action.type==='ADD_NODE'){
      created.push(normalize(action.label));
      const keepRole=!!action.role&&(explicitlyNamedRole||action.roleSource==='explicit');
      resolved=[{...action,id:action.id||newId(),role:keepRole?action.role:undefined,roleSource:keepRole?action.roleSource|| (explicitlyNamedRole?'explicit':'intent'):undefined,...(action.shape?{shapeSource:explicitlyNamedShape?'explicit' as const:'default' as const}:{})}];
    }
    if(action.type==='ADD_EDGE'||action.type==='INSERT_BETWEEN'){
      const source=action.type==='ADD_EDGE'&&/\b(?:connect|link)\s+(?:the\s+)?this\b/i.test(command)?'this':action.source;
      const target=action.type==='ADD_EDGE'&&/\bto\s+(?:the\s+)?this\b/i.test(command)?'this':action.target;
      resolved=[{...action,...(action.type==='ADD_EDGE'&&action.relation?{relationSource:action.relationSource|| (explicitlyNamedRelation?'explicit' as const:'intent' as const)}:{}),...(action.type==='ADD_EDGE'?{arrowhead:requestedArrowhead}:{}),...(action.type==='INSERT_BETWEEN'?{id:action.id||newId(),...(action.shape?{shapeSource:explicitlyNamedShape?'explicit' as const:'default' as const}:{})}:{}),source:verifiedIds.has(source)?source:resolve(draft,scene,source,command,selectedId,false,created),target:verifiedIds.has(target)?target:resolve(draft,scene,target,command,selectedId,false,created)}];
    }
    if(action.type==='DELETE_EDGE'||action.type==='REVERSE_EDGE'||action.type==='UPDATE_EDGE'){
      const mentioned=/\b(?:this|that|it|last)\s+(?:arrow|connection|edge)\b/i.test(command);
      const named=action.type==='DELETE_EDGE'?command.match(/\b(?:disconnect|unlink)\s+(.+?)\s+from\s+(.+?)(?:[.!?]|$)/i):null;
      const edge=named?undefined:mentioned&&selectedEdgeId?selectedEdgeId:action.edge&&edgeReference(action.edge)?selectedEdgeId||draft.recentEdgeId||action.edge:action.edge;
      const source=named?.[1]||action.source,target=named?.[2]||action.target;
      resolved=[{...action,edge,source:source?resolve(draft,scene,source,command,selectedId,false,created):undefined,target:target?resolve(draft,scene,target,command,selectedId,false,created):undefined}];
    }
    if(action.type==='CREATE_GROUP'||action.type==='CREATE_CONTAINER'||action.type==='ADD_TO_CONTAINER'||action.type==='REMOVE_FROM_CONTAINER'){
      const childTargets:string[]=[];
      const containerRef=(value:string)=>draft.containers?.find(item=>item.id===value||normalize(item.name)===normalize(value.replace(/\s+container$/i,'')));
      const targets=action.targets.flatMap(target=>{
        if(action.type==='CREATE_CONTAINER'){
          const child=containerRef(target);
          if(child){childTargets.push(child.id);return [];}
        }
        if(!pluralReference(target))return [resolve(draft,scene,target,command,selectedId,false,created)];
        if(selectedIds.length<(action.type==='CREATE_GROUP'||action.type==='CREATE_CONTAINER'?2:1))throw new SceneError('Select the blocks before referring to “these”.');
        return selectedIds;
      });
      const unique=[...new Set(targets)];
      const existing=action.type==='CREATE_CONTAINER'?draft.containers?.find(item=>normalize(item.name)===normalize(action.name)):undefined;
      if(action.type==='CREATE_CONTAINER'){
        const children=[...new Set([...childTargets,...(action.childContainers||[]).map(name=>containerRef(name)?.id||name)])];
        resolved=existing?[...(unique.length?[{type:'ADD_TO_CONTAINER',container:existing.id,targets:unique} as Action]:[]),...children.map(container=>({type:'NEST_CONTAINER',container,parent:existing.id} as Action))]:[{...action,targets:unique,childContainers:children}];
      }else resolved=[{...action,targets:unique}];
    }
    if(action.type==='MOVE_NODE'){
      const container=draft.containers?.find(item=>normalize(item.name)===normalize(action.target.replace(/\s+container$/i,'')));
      if(container&&!action.relativeTo){resolved=[{type:'MOVE_CONTAINER',container:container.id,direction:action.direction,x:action.x,y:action.y}];}
      else{
      const ids=explicitPlural&&selectedIds.length>1?selectedIds:groupTargets(draft,action.target,selectedIds)||(actions.length===1?commandGroup(draft,command):null);
      const relativeTo=action.relativeTo?resolve(draft,scene,action.relativeTo,command,selectedId,false,created):undefined;
      resolved=ids?moveGroup(draft,ids,action,relativeTo):[{...action,target:resolve(draft,scene,action.target,command,selectedId,singleTargetEdit,created),relativeTo}];
      }
    }
    if(action.type==='UPDATE_NODE'||action.type==='DELETE_NODE'){
      const ids=explicitPlural&&selectedIds.length>1?selectedIds:groupTargets(draft,action.target,selectedIds)||(actions.length===1?commandGroup(draft,command):null);
      resolved=ids?ids.map(target=>({...action,target} as Action)):[{...action,target:resolve(draft,scene,action.target,command,selectedId,singleTargetEdit,created)}];
    }
    for(const next of resolved){
      if(next.type==='ADD_EDGE'&&!/\b(?:connect|link|relate|related|associate|join|tie|dependency|relationship|parent|child|branch|sequence|between|arrow|line)\b/i.test(command)
        &&effectiveDiagramType(draft,next.source)==='brainstorming')throw new SceneError('Connections in Brainstorming are added only when you ask for them.');
      if(!['UNDO','REDO','CLEAR','ARRANGE','NEW_DIAGRAM'].includes(next.type))draft=execute(draft,[next]);
      result.push(next);
    }
  }}catch(error){if(error instanceof SceneError&&error.clarification)error.actions=actions;throw error;}
  return result;
}
