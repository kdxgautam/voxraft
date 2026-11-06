import {emptyScene,execute,type Action,type Scene} from './scene';

export const DEMO_DURATION=24000;
export const DEMO_STEP_MS=4000;
export const demoCaptions=[
  'Create a web app, an API, and a PostgreSQL database.',
  'Connect the web app to the API, then to PostgreSQL.',
  'Add a Redis cache and connect it to the API.',
  'Move Redis above PostgreSQL.',
  'Make PostgreSQL green.',
  'An idea you can see. A diagram you can keep changing.',
];
export const demoChapters=['Describe','Connect','Add','Move','Style','Done'];

export function createDemoScenes():Scene[]{
  const start=execute(emptyScene(),[{type:'SET_DIAGRAM_CONTEXT',diagramType:'architecture'}]);
  const batches:Action[][]=[
    [
      {type:'ADD_NODE',id:'demo-web',label:'Web app',color:'#dbeafe'},
      {type:'ADD_NODE',id:'demo-api',label:'API server',color:'#ede5fa'},
      {type:'ADD_NODE',id:'demo-db',label:'PostgreSQL',shape:'cylinder',color:'#f1f4f8'},
      {type:'MOVE_NODE',target:'demo-web',x:65,y:205},
      {type:'MOVE_NODE',target:'demo-api',x:325,y:205},
      {type:'MOVE_NODE',target:'demo-db',x:585,y:205},
    ],
    [{type:'ADD_EDGE',source:'demo-web',target:'demo-api',label:'HTTPS'}, {type:'ADD_EDGE',source:'demo-api',target:'demo-db',label:'SQL'}],
    [{type:'ADD_NODE',id:'demo-cache',label:'Redis cache',color:'#fff0cd'}, {type:'ADD_EDGE',source:'demo-api',target:'demo-cache'}, {type:'MOVE_NODE',target:'demo-cache',x:325,y:55}],
    [{type:'MOVE_NODE',target:'demo-cache',x:585,y:55}],
    [{type:'UPDATE_NODE',target:'demo-db',color:'#ccebd9'}],
  ];
  return batches.reduce<Scene[]>((scenes,actions)=>[...scenes,execute(scenes.at(-1)!,actions)],[start]);
}
export const demoStep=(elapsed:number)=>Math.min(5,Math.max(0,Math.floor(elapsed/DEMO_STEP_MS)));
