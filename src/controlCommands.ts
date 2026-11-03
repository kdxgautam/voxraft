import type {Action} from './scene';

const normalize=(text:string)=>text.toLowerCase().replace(/[,.!?]/g,' ').replace(/\s+/g,' ').trim().replace(/^please\s+/,'').replace(/\s+please$/,'');

export function historyCommand(text:string):Extract<Action,{type:'UNDO'|'REDO'}>|null{
  const value=normalize(text);
  const words=value.split(' ');
  if(words.length<=5&&words.every(word=>word===words[0])&&(words[0]==='undo'||words[0]==='redo'))
    return {type:words[0].toUpperCase() as 'UNDO'|'REDO',steps:words.length};
  if(/^(undo (?:that|it|the last (?:change|action|edit|operation))|revert (?:that|it|the last (?:change|action|edit|operation))|take (?:that|it) back|go back(?: one step)?|reverse the last (?:change|action|edit|operation))$/.test(value))return {type:'UNDO'};
  if(/^(redo (?:that|it|the last (?:change|action|edit|operation))|do (?:that|it) again|reapply (?:that|it|the last (?:change|action|edit|operation))|restore the last (?:change|action|edit|operation)|go forward(?: one step)?)$/.test(value))return {type:'REDO'};
  return null;
}

export function proposalCommand(text:string):{verb:'apply'|'discard';target:'design'|'layout'|'review'|'current'}|null{
  const value=normalize(text);
  const match=value.match(/^(apply|accept|use|discard|reject)\s+(?:(?:the|this|that)\s+)?(visual design|design|shapes|shape suggestions|layout|layout proposal|review suggestion|review|suggestion|proposal|it)$/);
  if(!match)return null;
  const target=/design|shape/.test(match[2])?'design':/layout/.test(match[2])?'layout':/review/.test(match[2])?'review':'current';
  return {verb:/^(discard|reject)$/.test(match[1])?'discard':'apply',target};
}
