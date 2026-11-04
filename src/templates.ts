import {arrangeScene,emptyScene,execute,type Action,type Scene} from './scene';

export const templates=[
  {id:'flowchart',name:'Flowchart',description:'A decision with two outcomes',type:'flowchart',actions:[
    {type:'ADD_NODE',label:'Start',role:'start'},
    {type:'ADD_NODE',label:'Review request',role:'process'},
    {type:'ADD_NODE',label:'Approved?',role:'decision'},
    {type:'ADD_NODE',label:'Complete',role:'end'},
    {type:'ADD_NODE',label:'Revise request',role:'process'},
    {type:'ADD_EDGE',source:'Start',target:'Review request',relation:'sequence'},
    {type:'ADD_EDGE',source:'Review request',target:'Approved?',relation:'sequence'},
    {type:'ADD_EDGE',source:'Approved?',target:'Complete',label:'Yes',relation:'sequence'},
    {type:'ADD_EDGE',source:'Approved?',target:'Revise request',label:'No',relation:'sequence'},
    {type:'ADD_EDGE',source:'Revise request',target:'Review request',relation:'sequence'}
  ]},
  {id:'mindmap',name:'Mind map',description:'A central topic with branches',type:'mindmap',actions:[
    {type:'ADD_NODE',label:'Main idea',role:'topic'},
    {type:'ADD_NODE',label:'Audience',role:'topic'},
    {type:'ADD_NODE',label:'Goals',role:'topic'},
    {type:'ADD_NODE',label:'Next steps',role:'topic'},
    {type:'ADD_EDGE',source:'Main idea',target:'Audience',relation:'branch'},
    {type:'ADD_EDGE',source:'Main idea',target:'Goals',relation:'branch'},
    {type:'ADD_EDGE',source:'Main idea',target:'Next steps',relation:'branch'}
  ]},
  {id:'hierarchy',name:'Org chart',description:'Teams and reporting lines',type:'hierarchy',actions:[
    {type:'ADD_NODE',label:'Organization'},
    {type:'ADD_NODE',label:'Product'},
    {type:'ADD_NODE',label:'Engineering'},
    {type:'ADD_NODE',label:'Design'},
    {type:'ADD_EDGE',source:'Organization',target:'Product',relation:'parent_child'},
    {type:'ADD_EDGE',source:'Organization',target:'Engineering',relation:'parent_child'},
    {type:'ADD_EDGE',source:'Product',target:'Design',relation:'parent_child'}
  ]},
  {id:'architecture',name:'System architecture',description:'A simple application stack',type:'architecture',actions:[
    {type:'ADD_NODE',label:'Web app',role:'component'},
    {type:'ADD_NODE',label:'API',role:'component'},
    {type:'ADD_NODE',label:'Database',role:'database'},
    {type:'ADD_EDGE',source:'Web app',target:'API',relation:'connection'},
    {type:'ADD_EDGE',source:'API',target:'Database',relation:'connection'}
  ]}
] as const;

export function createTemplate(id:string):Scene{
  const template=templates.find(item=>item.id===id);
  if(!template)throw new Error('Unknown diagram template.');
  const built=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:template.type,source:'explicit'},...template.actions] as Action[]);
  const laidOut=arrangeScene(built);
  return laidOut===built?built:{...laidOut,past:built.past};
}
