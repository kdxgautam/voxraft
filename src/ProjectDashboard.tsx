import {useEffect,useRef,useState} from 'react';
import {ArrowRight,AudioLines,MoreHorizontal,Plus} from 'lucide-react';
import type {Scene} from './scene';

export type ProjectSummary={
  id:string;name:string;created_at:number;updated_at:number;type:Scene['context']['type'];purpose:string;
  node_count:number;edge_count:number;preview:Pick<Scene,'nodes'|'edges'|'containers'|'extras'>;
};
const typeName:Record<NonNullable<ProjectSummary['type']>,string>={architecture:'Architecture',mindmap:'Mind map',hierarchy:'Hierarchy',brainstorming:'Brainstorming',flowchart:'Flowchart',mixed:'Mixed'};

function DashboardSketch({compact=false}:{compact?:boolean}){
  return <div className={`dashboard-sketch${compact?' dashboard-sketch-compact':''}`} aria-hidden="true">
    <div className="dashboard-sketch-top"><span><i/> Your idea, connected</span><span>Editable canvas</span></div>
    {compact?<div className="dashboard-sketch-blank"><span className="dashboard-sketch-blank-icon"><Plus size={22}/></span><strong>Start with your idea</strong><small>Your canvas is ready for the first command.</small></div>:<svg viewBox="0 0 480 184" fill="none" role="presentation">
      <path d="M144 91h32m-8-7 8 7-8 7M302 91h33m-8-7 8 7-8 7" stroke="#829aaa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="12" y="53" width="132" height="76" rx="11" fill="#e4eefb" stroke="#91aac3" strokeWidth="1.5"/>
      <rect x="176" y="53" width="126" height="76" rx="11" fill="#efe9f8" stroke="#ab9ec3" strokeWidth="1.5"/>
      <path d="M351 64c0-9 25-16 56-16s56 7 56 16v63c0 9-25 16-56 16s-56-7-56-16V64Z" fill="#e3f2ea" stroke="#91b9aa" strokeWidth="1.5"/>
      <ellipse cx="407" cy="64" rx="56" ry="16" fill="#f3faf6" stroke="#91b9aa" strokeWidth="1.5"/>
      <text x="78" y="96" textAnchor="middle">Web app</text><text x="239" y="96" textAnchor="middle">API</text><text x="407" y="106" textAnchor="middle">Database</text>
    </svg>}
    <div className="dashboard-sketch-command"><AudioLines size={16}/><span>“Create an app, an API, and a database.”</span><span className="dashboard-sketch-command-dot"/></div>
  </div>;
}

function DiagramPreview({project}:{project:ProjectSummary}){
  const host=useRef<HTMLDivElement>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!project.node_count&&!project.preview.extras?.length)return;
    const element=host.current;if(!element)return;
    let active=true;
    const observer=new IntersectionObserver(entries=>{
      if(!entries[0]?.isIntersecting)return;
      observer.disconnect();
      void Promise.all([import('@excalidraw/excalidraw'),import('./diagramElements')]).then(async([{exportToSvg},{toElements}])=>{
        const svg=await exportToSvg({elements:toElements(project.preview),appState:{viewBackgroundColor:'#ffffff',exportBackground:true,exportWithDarkMode:false},files:null,exportPadding:20});
        if(active){svg.setAttribute('aria-hidden','true');element.replaceChildren(svg);}
      }).catch(()=>{if(active)setFailed(true);});
    },{rootMargin:'150px'});
    observer.observe(element);
    return()=>{active=false;observer.disconnect();};
  },[project.id,project.updated_at,project.node_count,project.preview]);
  return <div className="dashboard-preview" ref={host} role="img" aria-label={`Preview of ${project.name}`}>{(!project.node_count&&!project.preview.extras?.length||failed)&&<span>{failed?'Preview unavailable':'Blank canvas'}</span>}</div>;
}

export function ProjectDashboard({user,projects,ready,hasMore,error,onCreate,onDownload,onOpen,onRename,onDelete,onLoadMore,onAccount,onHome}:{
  user:{email:string};projects:ProjectSummary[];ready:boolean;hasMore:boolean;error:string;
  onCreate:()=>Promise<void>;onDownload:(id:string,name:string)=>Promise<void>;onOpen:(id:string)=>void;onRename:(id:string,name:string)=>Promise<void>;
  onDelete:(id:string,name:string)=>Promise<void>;onLoadMore:()=>Promise<void>;onAccount:()=>void;onHome:()=>void;
}){
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setActionError('');try{await action();}catch(cause){setActionError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}};
  const savedProjects=projects;
  return <div className="site-page dashboard-page">
    <header className="site-header"><div className="site-container site-nav"><button className="dashboard-brand" onClick={onHome}><strong>Voxraft</strong></button><div className="site-nav-actions"><span className="dashboard-email">{user.email}</span><button className="site-signin" onClick={onAccount}>Account</button></div></div></header>
    <main className="site-container dashboard-main"><div className="dashboard-heading"><div className="dashboard-heading-copy"><p className="site-eyebrow">YOUR WORKSPACE <span>· READY WHEN YOU ARE</span></p><h1 id="dashboard-main-title">Start with a thought.<br/><em>Make it visible.</em></h1><p>Speak an idea, shape a diagram, and pick up where you left off.</p><button className="dashboard-instant" onClick={()=>void run(onCreate)} disabled={busy}><span className="starter-icon"><Plus size={19}/></span><span><strong>New canvas</strong><small>Start from a blank page</small></span><ArrowRight size={19}/></button></div><div className="dashboard-heading-visual"><DashboardSketch/></div></div>
      {(error||actionError)&&<div className="site-form-error" role="alert">{actionError||error}</div>}
      <section className="dashboard-projects" aria-labelledby="dashboard-projects-title"><div className="dashboard-section-heading"><div><span>YOUR WORK</span><h2 id="dashboard-projects-title">Saved diagrams</h2></div>{ready&&savedProjects.length>0&&<p>{savedProjects.length} shown</p>}</div>
      {!ready?<p className="dashboard-state" role="status">Loading diagrams…</p>:savedProjects.length===0?<div className="dashboard-no-projects"><DashboardSketch compact/><div><span className="dashboard-empty-kicker">A PLACE FOR EVERY IDEA</span><h3>{hasMore?'No diagrams in this batch':'Your canvas is waiting.'}</h3><p>{hasMore?'Load more to see your older diagrams.':'Your first diagram starts with a few words. Make one now, then keep shaping it here.'}</p><button onClick={()=>void run(hasMore?onLoadMore:onCreate)} disabled={busy}>{hasMore?'Load more diagrams':'Create your first canvas'} <ArrowRight size={17}/></button></div></div>:<div className="dashboard-grid">{savedProjects.map(project=><article className="dashboard-card" key={project.id}><button className="dashboard-open" onClick={()=>onOpen(project.id)} aria-label={`Open ${project.name}`}><DiagramPreview project={project}/><div className="dashboard-card-copy"><span className="dashboard-type">{project.type?typeName[project.type]:'Undecided'}</span><h2>{project.name}</h2><p>{project.purpose||`${project.node_count} blocks · ${project.edge_count} connections`}</p><small>Edited {new Date(project.updated_at*1000).toLocaleString()}</small></div></button><div className="dashboard-card-actions"><span>{project.node_count} blocks · {project.edge_count} links</span><details className="dashboard-project-menu"><summary aria-label={`More options for ${project.name}`}><MoreHorizontal size={18}/></summary><div><button onClick={()=>{const name=window.prompt('Rename diagram:',project.name)?.trim();if(name&&name!==project.name)void run(()=>onRename(project.id,name));}} disabled={busy}>Rename</button><button onClick={()=>void run(()=>onDownload(project.id,project.name))} disabled={busy}>Download JSON</button><button className="dashboard-delete" onClick={()=>void run(()=>onDelete(project.id,project.name))} disabled={busy}>Delete diagram</button></div></details></div></article>)}</div>}
      {hasMore&&<button className="dashboard-more" onClick={()=>void run(onLoadMore)} disabled={busy}>Load more diagrams</button>}
      </section>
    </main>
  </div>;
}
