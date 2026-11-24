import {useId, useState, type MouseEvent} from 'react';
import {ArrowRight, AudioLines, Check, ChevronDown, Download, GitBranch, Menu, Mic, MousePointer2, MoveUpRight, Pause, Play, Pencil, Plus, Share2, SquarePen, X} from 'lucide-react';
import './home.css';
import ProductDemo from './ProductDemo';
import DemoBackdrop from './DemoBackdrop';
import FinalDiagram from './FinalDiagram';
import HeroStory from './HeroStory';
import {useHomeMotion,useReducedMotion} from './homeMotion';

type Props={user:{id:string;email:string}|null;link:(next:string)=>(event:MouseEvent<HTMLAnchorElement>)=>void};
type Example='Flowchart'|'Mind map'|'Architecture';

function Mark(){return <>Voxraft</>;}
function Wave(){return <span className="bc-wave" aria-hidden="true">{[8,15,23,12,29,18,10,24,34,16,26,12,19,9,24,14,30,18,10].map((height,i)=><i key={i} style={{height}}/>)}</span>;}

function Diagram({kind,edited=false}:{kind:Example;edited?:boolean}){
  const markerId=useId();
  const box=(x:number,y:number,w:number,label:string,color:string,round=10)=><g><rect x={x} y={y} width={w} height="54" rx={round} fill={color} stroke="currentColor" strokeWidth="1.5"/><text x={x+w/2} y={y+32} textAnchor="middle">{label}</text></g>;
  return <svg className="bc-diagram" viewBox="0 0 720 300" role="img" aria-label={`${kind} example${edited?' with an additional step':''}`}>
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 L8 5 L1 9" fill="none" stroke="currentColor" strokeWidth="1.3"/></marker></defs>
    {kind==='Flowchart'?<>
      <g className="bc-connectors" markerEnd={`url(#${markerId})`}><path d="M167 140 H221"/><path d="M355 140 H405"/><path d="M515 140 H568"/><path d="M460 195 V245 H288 V167"/></g>
      {box(37,113,130,'Add to cart','#edf6ff')}{box(222,113,133,'Checkout','#f4efff')}
      <path d="M460 85 L515 140 L460 195 L405 140 Z" fill="#fff7d4" stroke="currentColor" strokeWidth="1.5"/><text x="460" y="136" textAnchor="middle"><tspan x="460">Payment</tspan><tspan x="460" dy="19">approved?</tspan></text>
      {box(570,113,125,edited?'Send receipt':'Confirmed','#e7f4e9',27)}<text className="bc-edge-label" x="536" y="126">Yes</text><text className="bc-edge-label" x="368" y="235">No · try again</text>
    </>:kind==='Mind map'?<>
      <g className="bc-connectors"><path d="M290 149 C230 149 240 70 193 70 M290 149 H190 M290 149 C230 149 240 235 193 235 M430 149 C490 149 480 70 527 70 M430 149 H527 M430 149 C490 149 480 235 527 235"/></g>
      {box(290,122,140,'A new app','#e8e2fc')}{box(53,43,140,'The big idea','#fff2d5')}{box(50,122,140,'Who it helps','#e8f4eb')}{box(53,208,140,'What it solves','#e9f4fc')}{box(527,43,140,'First features','#fce8e5')}{box(527,122,140,'The launch','#f4efff')}{box(527,208,140,edited?'Your next step':'What comes next','#fff2d5')}
    </>:<>
      <g className="bc-connectors" markerEnd={`url(#${markerId})`}><path d="M205 145 H287 M437 145 H520"/>{edited&&<path d="M362 118 V60 H520"/>}</g>
      {box(55,118,150,'Web app','#e9f4fc')}{box(287,118,150,'API server','#f4efff')}
      <g><path d="M522 125 C522 101 672 101 672 125 V176 C672 200 522 200 522 176 Z" fill="#e8f4eb" stroke="currentColor" strokeWidth="1.5"/><ellipse cx="597" cy="125" rx="75" ry="16" fill="#e8f4eb" stroke="currentColor" strokeWidth="1.5"/><text x="597" y="163" textAnchor="middle">PostgreSQL</text></g>
      <text className="bc-edge-label" x="230" y="132">HTTPS</text><text className="bc-edge-label" x="467" y="132">SQL</text>{edited&&box(520,33,150,'Redis cache','#fff2d5')}
    </>}
  </svg>;
}

export default function HomePage({user,link}:Props){
  const reduced=useReducedMotion();
  const [motionPaused,setMotionPaused]=useState(false);
  const motion=!reduced&&!motionPaused;
  const root=useHomeMotion(motion);
  const [menu,setMenu]=useState(false);
  const target=user?'/dashboard':'/sign-up';
  const cta=user?'Open workspace':'Start creating';
  return <div className="bc-home" ref={root} data-motion={motion}>
    <div className="bc-scroll-progress" aria-hidden="true"/>
    <a className="bc-skip" href="#home-main">Skip to content</a>
    <header className="bc-header bc-width">
      <a className="bc-brand" href="/" onClick={link('/')} aria-label="Voxraft home"><Mark/></a>
      <nav aria-label="Main navigation" className={menu?'bc-navigation is-open':'bc-navigation'}><a href="#how-it-works" onClick={()=>setMenu(false)}>How it works</a><a href="#possibilities" onClick={()=>setMenu(false)}>What you can make</a><a href="#questions" onClick={()=>setMenu(false)}>FAQs</a></nav>
      <div className="bc-nav-actions">{!user&&<a className="bc-signin" href="/sign-in" onClick={link('/sign-in')}>Sign in</a>}<a className="bc-button bc-button-small" href={target} onClick={link(target)}>{cta}</a><button className="bc-menu" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu?<X/>:<Menu/>}</button></div>
    </header>
    <main id="home-main">
      <section className="bc-hero">
        <span className="bc-pointer-glow" aria-hidden="true"/>
        <div className="bc-hero-copy"><h1>Speak your mind.<br/><em>See it take shape.</em></h1><p>Turn your words into editable diagrams.</p><a className="bc-button" href={target} onClick={link(target)}>{user?'Open your workspace':'Start creating'}</a><small>Right in your browser. Nothing to install.</small></div>
        <HeroStory motion={motion}/>
        <a className="bc-watch-link" href="#product-demo">See it in action <ChevronDown size={15}/></a>
      </section>
      <section className="bc-demo-section" id="product-demo" aria-labelledby="demo-heading"><div className="bc-demo-sticky"><DemoBackdrop/><div className="bc-demo-intro"><span>From words to a working diagram</span><h2 id="demo-heading">A little talking.<br/>A lot taking shape.</h2><p>Watch an idea become a system, one command at a time.</p></div><div className="bc-demo-entrance bc-width"><ProductDemo motion={motion}/></div></div></section>
      <section className="bc-formats bc-width" aria-label="Supported diagram types"><p>A little structure for every kind of thought.</p><div><span>Flowcharts</span><span>Mind maps</span><span>System architecture</span><span>Org charts</span><span>Brainstorms</span></div></section>
      <div className="bc-thought-ribbon" aria-hidden="true"><div><span>Say it.</span><AudioLines/><span>See it.</span><GitBranch/><span>Shape it.</span><Pencil/><span>Share it.</span><Share2/></div></div>
      <section id="how-it-works" className="bc-how bc-width"><div className="bc-section-heading"><h2>From a thought to<br/>“oh, now I see it.”</h2><p>You bring the idea. <br/>Voxraft helps you put it on the page.</p></div><div className="bc-feature-row"><div className="bc-speech-panel"><div className="bc-speech-note"><span><Mic size={17}/> It starts with your words</span><p>“Let’s map the checkout.<br/>Add a payment step.<br/>What if the payment fails?”</p><div className="bc-recording"><Wave/><span>An idea taking shape</span></div></div><span className="bc-hand-note">No perfect prompt required.</span></div><div className="bc-feature-copy"><span className="bc-step">1 / Say it</span><h3>Your thoughts don’t<br/>have to arrive tidy.</h3><p>Explain a process, explore an idea, or describe a system. Speak naturally or type a command, and give your thinking somewhere to go.</p><a href={target} onClick={link(target)}>Start with an idea <ArrowRight size={17}/></a></div></div>
      <div className="bc-feature-row bc-feature-reverse"><div className="bc-edit-panel"><div className="bc-edit-toolbar"><span><MousePointer2 size={16}/></span><Pencil size={16}/><SquarePen size={16}/><GitBranch size={16}/></div><div className="bc-selected-node">Your idea<i/><i/><i/><i/></div><div className="bc-edit-options"><span style={{background:'#e6def8'}}/><span style={{background:'#d5ebdd'}}/><span style={{background:'#ffe6b8'}}/><span style={{background:'#d8f1fc'}}/><span><Plus size={14}/></span></div><div className="bc-edit-command"><AudioLines size={17}/> “Make this green. Move it to the right.”</div></div><div className="bc-feature-copy"><span className="bc-step">2 / Make it yours</span><h3>A starting point.<br/>Never a final answer.</h3><p>Every shape and connection stays editable. Move things by hand, ask for a change, or undo a detour. Preview layout and design suggestions before applying them.</p><span className="bc-inline-note"><Check size={16}/> Your canvas. You have the last word.</span></div></div></section>
      <section id="possibilities" className="bc-possibilities"><div className="bc-width"><div className="bc-section-heading"><h2>Big picture.<br/>Small details. All here.</h2><p>For the things you’re building, <br/>learning, and figuring out.</p></div><div className="bc-use-grid">{([{kind:'Architecture',title:'Explain how it fits together.',copy:'Map services and dependencies so the whole system makes sense.'},{kind:'Mind map',title:'Give an idea room to grow.',copy:'Branch into possibilities, gather thoughts, and find the next step.'},{kind:'Flowchart',title:'Make the next step clear.',copy:'Turn a process into a path that anyone can follow.'}] as const).map(item=><article key={item.kind}><div className="bc-use-visual"><Diagram kind={item.kind}/></div><span>{item.kind}</span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></div></section>
      <section className="bc-share bc-width"><div><span className="bc-step">3 / Put it out there</span><h2>Good ideas are<br/>better understood.</h2><p>Download a visual for your next doc or presentation. Or share a read-only link that stays up to date as your diagram changes.</p><a href={target} onClick={link(target)}>Create something worth sharing <MoveUpRight size={17}/></a></div><div className="bc-export-art"><div className="bc-export-sheet"><span><GitBranch size={19}/> The big picture</span><Diagram kind="Mind map"/><div><Check size={14}/> Ready for its next chapter</div></div><div className="bc-export-chips"><span><Download size={15}/> PNG</span><span>SVG</span><span>PDF via print</span><span><Share2 size={15}/> Share link</span></div></div></section>
      <section id="questions" className="bc-faq bc-width"><h2>A few things<br/>you might wonder.</h2><div>{[
        ['Do I have to use my voice?','No. You can type commands, draw directly on the canvas, or switch between all three. Voice is there when talking is the easiest way to think.'],
        ['Can I change the diagram afterwards?','Yes. Every diagram is made of editable shapes and connections. You can move, rename, restyle, add, or remove elements, with undo and redo along the way.'],
        ['What can I make with Voxraft?','Create flowcharts, mind maps, system architecture diagrams, hierarchies, and brainstorms. Different diagram types can live in separate regions on the same canvas.'],
        ['How do saving and sharing work?','Your diagrams save to your account, with a browser recovery copy if a save fails. Sharing is optional: create a read-only link and revoke it whenever you want.'],
        ['Do I need to install anything?','Voxraft runs in your browser. To speak, allow microphone access and use localhost or a secure HTTPS connection. You can always use text commands instead.'],
      ].map(([question,answer])=><details key={question}><summary>{question}<ChevronDown size={18}/></summary><p>{answer}</p></details>)}</div></section>
      <section className="bc-final"><div className="bc-final-inner bc-width"><div className="bc-final-copy"><span className="bc-final-eyebrow">Your turn</span><h2>One sentence.<br/><em>A whole new view.</em></h2><p>Build a diagram you can edit, share, and make your own. All you need is the idea.</p><a className="bc-button bc-final-cta" href={target} onClick={link(target)}>{cta}<ArrowRight size={18}/></a><span className="bc-final-note">Works in your browser. No install needed.</span></div><FinalDiagram/></div></section>
    </main><footer className="bc-footer bc-width"><a className="bc-brand" href="/" onClick={link('/')}><Mark/></a><span>A little less drawing. A lot more thinking.</span><div className="bc-footer-actions">{!reduced&&<button onClick={()=>setMotionPaused(value=>!value)} aria-pressed={motionPaused}>{motionPaused?<Play size={13}/>:<Pause size={13}/>} {motionPaused?'Resume page motion':'Pause page motion'}</button>}<a href="#home-main">Back to top ↑</a></div></footer>
  </div>;
}
