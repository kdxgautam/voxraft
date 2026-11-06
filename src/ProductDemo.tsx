import {useEffect,useId,useState} from 'react';
import {AudioLines,ChevronDown,History,Mic,MoreHorizontal,RotateCcw,RotateCw,Settings2,Sparkles} from 'lucide-react';
import {routeEdge} from './edgeRouting';
import {createDemoScenes,demoCaptions,demoStep,DEMO_DURATION,DEMO_STEP_MS} from './homeDemo';
import './productDemo.css';

export default function ProductDemo({motion}:{motion:boolean}){
  const [scenes]=useState(createDemoScenes);
  const [elapsed,setElapsed]=useState(()=>motion?0:DEMO_DURATION);
  const marker=useId();
  const step=demoStep(elapsed),scene=scenes[step];
  const running=motion&&elapsed>0&&elapsed<DEMO_DURATION;
  useEffect(()=>{
    if(!motion){setElapsed(DEMO_DURATION);return;}
    const section=document.getElementById('product-demo');
    if(!section)return;
    let frame=0;
    const update=()=>{
      frame=0;
      const rect=section.getBoundingClientRect();
      const distance=Math.max(1,rect.height-window.innerHeight);
      const progress=Math.max(0,Math.min(1,-rect.top/distance));
      setElapsed(progress*DEMO_DURATION);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
  },[motion]);
  const words=demoCaptions[step].split(' ');
  const wordsVisible=motion&&running&&step<5?Math.min(words.length,Math.floor((elapsed%DEMO_STEP_MS)/170)+1):words.length;
  const cursor=step<2?{x:210,y:260}:step<4?{x:455,y:115}:{x:710,y:275};
  return <div className={`pd-player pd-current${running?' pd-running':''}`} data-motion={motion} data-step={step} id="try-it" role="region" aria-label="Voxraft editor walkthrough">
    <div className="pd-app">
      <div className="pd-main"><div className="pd-appbar"><span className="pd-current-brand">Voxraft</span><span className="pd-current-divider"/><span className="pd-current-title"><strong>My first system</strong><small>Autosave on</small></span><span className="pd-current-actions"><RotateCcw size={16}/><RotateCw size={16}/><span className="pd-add-voice"><Mic size={14}/> Add by voice</span><span><Sparkles size={15}/> Assist <ChevronDown size={12}/></span><span><Settings2 size={15}/> Details</span><MoreHorizontal size={17}/></span></div><div className="pd-canvas"><div className="pd-current-tools" aria-hidden="true"><span>▢</span><span>◇</span><span>→</span><span>✎</span><span>⊞</span></div>
        <svg viewBox="0 0 830 365" className="pd-scene" role="img" aria-label={['Empty canvas, ready for an idea','Web app, API server, and PostgreSQL created','Components connected with HTTPS and SQL','Redis cache added and connected','Redis moved above PostgreSQL','Completed system with a green PostgreSQL database'][step]}>
          <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L8 5 L1 9" fill="none" stroke="#7d8da6" strokeWidth="1.4"/></marker></defs>
          {scene.edges.map(edge=>{const route=routeEdge(scene,edge);return <g key={`${edge.id}-${step===4?'moved':''}`} className="pd-edge"><path d={route.points.map(([x,y],i)=>`${i?'L':'M'}${route.x+x} ${route.y+y}`).join(' ')} fill="none" stroke="#7d8da6" strokeWidth="1.5" markerEnd={`url(#${marker})`}/>{edge.label&&<text x={route.labelX} y={route.labelY-10} textAnchor="middle">{edge.label}</text>}</g>;})}
          {scene.nodes.map(node=><g key={node.id} style={{transform:`translate(${node.x}px,${node.y}px)`}} className="pd-node-position"><g className="pd-node">
            {node.shape==='cylinder'?<><path d={`M0 12 C0 -4 ${node.width} -4 ${node.width} 12 V${node.height-12} C${node.width} ${node.height+4} 0 ${node.height+4} 0 ${node.height-12} Z`} fill={node.color} stroke="#7c8da5" strokeWidth="1.5"/><ellipse cx={node.width/2} cy="12" rx={node.width/2} ry="12" fill={node.color} stroke="#7c8da5" strokeWidth="1.5"/></>:<rect width={node.width} height={node.height} rx="8" fill={node.color} stroke="#7c8da5" strokeWidth="1.5"/>}
            <text x={node.width/2} y={node.height/2+(node.shape==='cylinder'?11:5)} textAnchor="middle">{node.label}</text>
            {step===5&&node.id==='demo-db'&&<rect className="pd-selection" x="-6" y="-6" width={node.width+12} height={node.height+12} rx="10" fill="none" stroke="#62ad88" strokeDasharray="4 4"/>}
          </g></g>)}
          {step===0&&<g className="pd-empty"><text x="415" y="174" textAnchor="middle">A blank canvas. A big idea.</text><text x="415" y="204" textAnchor="middle">Start speaking and watch it take shape.</text></g>}
          {step>0&&<g className="pd-cursor" style={{transform:`translate(${cursor.x}px,${cursor.y}px)`}} aria-hidden="true"><path d="M0 0 L0 24 L7 17 L13 28 L18 25 L12 15 L22 14 Z" fill="#5275b0" stroke="white" strokeWidth="2"/><rect x="23" y="19" width="53" height="23" rx="4" fill="#5275b0"/><text x="49" y="35" textAnchor="middle" fill="white">You</text></g>}
        </svg></div>
        <div className="pd-current-dock"><span className="pd-current-mic"><Mic size={15}/> {running?'Listening':'Start speaking'}</span><div className="pd-current-input"><span>{step===5?'Voice session active · speak naturally':'Or type a command'}</span><p aria-hidden="true">{words.slice(0,wordsVisible).join(' ')}<span className="pd-text-caret"/></p><span className="pd-sr-only">{demoCaptions[step]}</span></div><History size={17}/></div>
      </div>
    </div>
    <p className="pd-current-caption"><AudioLines size={14}/> An example of Voxraft turning commands into an editable diagram</p>
  </div>;
}
