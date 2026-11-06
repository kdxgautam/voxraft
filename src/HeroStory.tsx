import {useEffect,useRef,useState} from 'react';
import {ArrowRight,AudioLines,GitBranch,Pause,Play} from 'lucide-react';
import './heroStory.css';

const commands=[
  'Create an app.',
  'Connect it to an API.',
  'Then add a database.',
  'Call the API Payments.',
  'Make the database green.',
  'Label this link “stores”.',
];

export default function HeroStory({motion}:{motion:boolean}){
  const root=useRef<HTMLDivElement>(null);
  const [paused,setPaused]=useState(false);
  const [visible,setVisible]=useState(false);
  const [tabVisible,setTabVisible]=useState(!document.hidden);
  const [step,setStep]=useState(motion?0:commands.length-1);
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{threshold:.25});
    if(root.current)observer.observe(root.current);
    const update=()=>setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange',update);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};
  },[]);
  useEffect(()=>{if(!motion)setStep(commands.length-1);},[motion]);
  useEffect(()=>{
    if(!motion||paused||!visible||!tabVisible)return;
    const timer=window.setInterval(()=>setStep(current=>(current+1)%commands.length),3000);
    return()=>window.clearInterval(timer);
  },[motion,paused,visible,tabVisible]);
  return <div ref={root} className="bc-hero-story bc-story-loop" data-running={motion&&!paused&&visible&&tabVisible} data-animated={motion} data-step={step} role="group" aria-label="Spoken commands create an app, connect an API and database, then rename, style, and label the diagram.">
    <div className="bc-hero-utterances" aria-hidden="true">{commands.map((line,index)=>{
      const distance=step-index;
      const position=distance===0?'is-current':distance===1?'is-previous':distance===2?'is-older':'';
      return <p key={line} className={`bc-story-line ${position}`}><span className="bc-story-speaker"><AudioLines size={14}/> You</span><span className="bc-story-said">“{line}”</span></p>;
    })}</div>
    <ArrowRight className="bc-hero-story-arrow" size={28} aria-hidden="true"/>
    <div className="bc-hero-paper" aria-hidden="true"><span className="bc-paper-label"><GitBranch size={13}/> Your idea, connected</span><svg viewBox="0 0 380 100">
      <g className={`bc-story-link ${step>=1?'is-built':''}`} fill="none" stroke="#646e63" strokeWidth="1.5"><path d="M104 50 H142 M137 46 L142 50 L137 54"/></g>
      <g className={`bc-story-link ${step>=2?'is-built':''}`} fill="none" stroke="#646e63" strokeWidth="1.5"><path d="M240 50 H276 M271 46 L276 50 L271 54"/></g>
      <g className={`bc-hero-block ${step>=0?'is-built':''}`}><rect x="8" y="26" width="96" height="48" rx="7" fill="#e8e5f3"/><text x="56" y="55">App</text></g>
      <g className={`bc-hero-block ${step>=1?'is-built':''}`}><rect x="144" y="26" width="96" height="48" rx="7" fill="#f6eed1"/><text x="192" y="55">{step>=3?'Payments':'API'}</text></g>
      <g className={`bc-hero-block bc-story-db ${step>=2?'is-built':''}`}><path d="M278 30 C278 17 372 17 372 30 V70 C372 83 278 83 278 70 Z" fill={step>=4?'#a9e1b3':'#dce9da'}/><ellipse cx="325" cy="30" rx="47" ry="9" fill={step>=4?'#a9e1b3':'#dce9da'}/><text x="325" y="58">Database</text></g>
      <text className={`bc-story-edge-label ${step>=5?'is-built':''}`} x="258" y="38">stores</text>
    </svg></div>
    {motion&&<button className="bc-story-pause" aria-label={paused?'Play hero animation':'Pause hero animation'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>}
  </div>;
}
