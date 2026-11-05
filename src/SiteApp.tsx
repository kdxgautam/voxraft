import {lazy,Suspense,useCallback,useEffect,useRef,useState,type FormEvent,type MouseEvent} from 'react';
import {ArrowRight,AudioLines,Check,LockKeyhole} from 'lucide-react';
import {readProject,readSavedScene,writeProject,type Log,type ProjectFiles} from './project';
import {emptyScene,type Scene} from './scene';
import {ProjectDashboard,type ProjectSummary} from './ProjectDashboard';
import './site.css';
import './dashboard.css';
import HomePage from './HomePage';

const Editor=lazy(()=>import('./App'));
const SharedDiagram=lazy(()=>import('./SharedDiagram'));
type User={id:string;email:string};
type Project={scene:Scene;logs:Log[];latest:string;files?:ProjectFiles};
const pendingKey=(accountId:string,projectId:string)=>`bolcanvas.pending.${accountId}.${projectId}`;
const storageId=(accountId:string,projectId:string)=>`${accountId}.${projectId}`;
const hasCanvasContent=(scene:Scene)=>Boolean(scene.nodes.length||scene.edges.length||scene.extras?.length||scene.groups?.length||scene.containers?.length);

async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(path,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.detail||'Request failed. Please try again.');
  return data as T;
}

export default function SiteApp(){
  const [path,setPath]=useState(window.location.pathname);
  const [user,setUser]=useState<User|null>(null);
  const [project,setProject]=useState<Project|null>(null);
  const [projectName,setProjectName]=useState('Untitled diagram');
  const [loadedId,setLoadedId]=useState<string|null>(null);
  const [projects,setProjects]=useState<ProjectSummary[]>([]);
  const [listReady,setListReady]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [saveError,setSaveError]=useState('');
  const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const navigate=useCallback((next:string)=>{window.history.pushState(null,'',next);setPath(next);window.scrollTo(0,0);setError('');},[]);
  useEffect(()=>{const onPop=()=>{setPath(window.location.pathname);setError('');};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop);},[]);
  const link=(next:string)=>(event:MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();void saveQueue.current.finally(()=>navigate(next));};

  useEffect(()=>{let active=true;(async()=>{
    try{const response=await request<{user:User}>('/api/auth/me');if(active)setUser(response.user);}
    catch(cause){if(active&&!(cause instanceof Error&&cause.message==='Sign in to continue.'))setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(active)setLoading(false);}
  })();return()=>{active=false;};},[]);
  useEffect(()=>{if(user&&(path==='/app'||path==='/sign-in'||path==='/sign-up'))navigate('/dashboard');},[user,path,navigate]);

  const loadList=useCallback(async(offset=0)=>{
    const response=await request<{projects:ProjectSummary[];has_more:boolean}>(`/api/projects?offset=${offset}`);
    setProjects(current=>offset?[...current,...response.projects]:response.projects);
    setHasMore(response.has_more);setListReady(true);
  },[]);
  useEffect(()=>{if(!user||path!=='/dashboard')return;let active=true;setListReady(false);
    void request<{projects:ProjectSummary[];has_more:boolean}>('/api/projects?offset=0').then(response=>{if(active){setProjects(response.projects);setHasMore(response.has_more);setListReady(true);}}).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:String(cause));setListReady(true);}});
    return()=>{active=false;};
  },[user,path]);
  const editorId=path.startsWith('/app/')?path.slice(5):null;
  useEffect(()=>{if(!user||!editorId)return;let active=true;setLoadedId(null);setSaveError('');
    void request<{project:unknown;name:string}>(`/api/projects/${encodeURIComponent(editorId)}`).then(response=>{
      if(!active)return;
      const pending=localStorage.getItem(pendingKey(user.id,editorId));
      let recovered:Project|null=null;
      if(pending)try{recovered=readProject(pending);}catch{setSaveError('A browser recovery copy could not be read. The account copy was opened.');}
      setProject(recovered||readProject(JSON.stringify(response.project)));
      setProjectName(response.name);setLoadedId(editorId);
    }).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:String(cause));setLoadedId('error');}});
    return()=>{active=false;};
  },[user,editorId]);

  const persist=useCallback((projectId:string,serialized:string):Promise<void>=>{
    if(!user)return Promise.resolve();
    const key=pendingKey(user.id,projectId);
    try{localStorage.setItem(key,serialized);}catch{setSaveError('Local backup is unavailable.');}
    saveQueue.current=saveQueue.current.catch(()=>{}).then(async()=>{
      try{await request(`/api/projects/${encodeURIComponent(projectId)}`,'PUT',{project:JSON.parse(serialized)});
        try{if(localStorage.getItem(key)===serialized)localStorage.removeItem(key);}catch{/* Server save succeeded. */}
        setSaveError('');
      }catch(cause){setSaveError(cause instanceof Error?cause.message:'Diagram could not be saved.');}
    });
    return saveQueue.current;
  },[user]);
  const persistCurrent=useCallback((serialized:string)=>editorId?persist(editorId,serialized):Promise.resolve(),[persist,editorId]);
  const afterAuth=async(nextUser:User)=>{setUser(nextUser);navigate('/dashboard');};
  const createDiagram=async(value:Project={scene:emptyScene(),logs:[],latest:''},name='Untitled diagram')=>{
    await saveQueue.current;
    const created=await request<{id:string;name:string}>('/api/projects','POST',{name,project:JSON.parse(writeProject(value.scene,value.logs,value.latest,value.files))});
    navigate(`/app/${created.id}`);
  };
  const downloadDiagram=async(id:string,name:string)=>{
    const response=await request<{project:unknown}>(`/api/projects/${encodeURIComponent(id)}`);
    const url=URL.createObjectURL(new Blob([JSON.stringify(response.project,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`${name.replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)||'diagram'}.json`;anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const renameDiagram=async(id:string,name:string)=>{
    const response=await request<{name:string;updated_at:number}>(`/api/projects/${encodeURIComponent(id)}`,'PATCH',{name});
    setProjects(current=>current.map(item=>item.id===id?{...item,name:response.name,updated_at:response.updated_at}:item));
    if(editorId===id)setProjectName(response.name);
  };
  const deleteDiagram=async(id:string,name:string)=>{
    if(!window.confirm(`Delete “${name}”? This cannot be undone.`))return;
    await request(`/api/projects/${encodeURIComponent(id)}`,'DELETE');
    if(user){localStorage.removeItem(pendingKey(user.id,id));for(const prefix of ['bolcanvas.scene.v1','bolcanvas.logs.v1','bolcanvas.latest.v1'])localStorage.removeItem(`${prefix}.${storageId(user.id,id)}`);}
    await loadList(0);
  };
  const signOut=async()=>{await saveQueue.current.catch(()=>{});
    try{await request('/api/auth/sign-out','POST');setUser(null);setProject(null);setLoadedId(null);navigate('/');}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not sign out.');}
  };
  const importLocalDraft=async()=>{
    const raw=localStorage.getItem('bolcanvas.scene.v1');if(!raw||!user)return;
    try{await createDiagram({scene:readSavedScene(raw),logs:[],latest:localStorage.getItem('bolcanvas.latest.v1')||''},'Imported local draft');localStorage.removeItem('bolcanvas.scene.v1');}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not import the local draft.');}
  };

  if(path.startsWith('/share/'))return <Suspense fallback={<div className="site-loading" role="status">Opening shared diagram…</div>}><SharedDiagram token={path.slice(7)}/></Suspense>;
  if(loading)return <div className="site-loading" role="status"><span>Opening Voxraft…</span></div>;
  if(editorId)return user?loadedId===editorId&&project?<Suspense fallback={<div className="site-loading" role="status">Opening your diagram…</div>}><Editor key={`${user.id}.${editorId}`} projectId={editorId} storageId={storageId(user.id,editorId)} projectName={projectName} initialProject={project} onPersist={persistCurrent} onDashboard={async serialized=>{await saveQueue.current;if(!hasCanvasContent(readProject(serialized).scene)){try{await request(`/api/projects/${encodeURIComponent(editorId)}`,'DELETE');}catch{/* The dashboard list also removes empty canvases. */}localStorage.removeItem(pendingKey(user.id,editorId));for(const prefix of ['bolcanvas.scene.v1','bolcanvas.logs.v1','bolcanvas.latest.v1'])localStorage.removeItem(`${prefix}.${storageId(user.id,editorId)}`);}navigate('/dashboard');}} onCreate={()=>createDiagram()} onAutoName={name=>renameDiagram(editorId,name)} saveError={saveError}/></Suspense>:loadedId==='error'?<div className="site-loading" role="alert">{error||'Could not open this diagram.'} <button onClick={()=>navigate('/dashboard')}>Back to dashboard</button></div>:<div className="site-loading" role="status">Opening your diagram…</div>:<AuthPage key="sign-in" mode="sign-in" error={error} onSubmit={afterAuth} link={link}/>;
  if(path==='/dashboard'||path==='/app')return user?<ProjectDashboard user={user} projects={projects} ready={listReady} hasMore={hasMore} error={error} onCreate={()=>createDiagram()} onDownload={downloadDiagram} onOpen={id=>navigate(`/app/${id}`)} onRename={renameDiagram} onDelete={deleteDiagram} onLoadMore={()=>loadList(projects.length)} onAccount={()=>navigate('/account')} onHome={()=>navigate('/')}/>:<AuthPage key="sign-in" mode="sign-in" error={error} onSubmit={afterAuth} link={link}/>;
  if(path==='/sign-in'||path==='/sign-up')return user?<div className="site-loading" role="status">Opening dashboard…</div>:<AuthPage key={path} mode={path==='/sign-up'?'sign-up':'sign-in'} error={error} onSubmit={afterAuth} link={link}/>;
  if(path==='/account')return user?<AccountPage user={user} error={error} onSignOut={signOut} onImport={importLocalDraft} hasLocalDraft={!!localStorage.getItem('bolcanvas.scene.v1')} link={link}/>:<AuthPage key="sign-in" mode="sign-in" error={error} onSubmit={afterAuth} link={link}/>;
  return <HomePage user={user} link={link}/>;
}

function Brand({link}:{link:(next:string)=>(event:MouseEvent<HTMLAnchorElement>)=>void}){
  return <a className="site-brand" href="/" onClick={link('/')} aria-label="Voxraft home"><span>Voxraft</span></a>;
}

function DiagramShowcase(){
  return <div className="site-showcase" aria-label="Example canvas with connected checkout components">
    <div className="site-showcase-top"><span className="showcase-dots"><i/><i/><i/></span><span>Untitled diagram</span><span className="showcase-saved"><Check size={13}/> Autosaved</span></div>
    <div className="site-showcase-canvas">
      <div className="site-showcase-label">LIVE CANVAS <span>01 / 03</span></div>
      <svg viewBox="0 0 640 360" role="img" aria-label="Customer connects to Checkout API, which connects to Orders and Payments">
        <defs><marker id="showcase-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="#7e9a8b" strokeWidth="1.5"/></marker></defs>
        <path className="showcase-line" d="M183 153 H248" markerEnd="url(#showcase-arrow)"/><path className="showcase-line" d="M404 153 H455 V105 H476" markerEnd="url(#showcase-arrow)"/><path className="showcase-line" d="M404 153 H455 V246 H476" markerEnd="url(#showcase-arrow)"/>
        <g className="showcase-node showcase-node-customer"><rect x="28" y="121" width="155" height="64" rx="13"/><circle cx="53" cy="153" r="8"/><text x="75" y="159">Customer</text></g>
        <g className="showcase-node showcase-node-api"><rect x="248" y="113" width="156" height="80" rx="13"/><text className="showcase-node-kicker" x="268" y="141">SERVICE</text><text x="268" y="167">Checkout API</text></g>
        <g className="showcase-node showcase-node-orders"><rect x="476" y="74" width="142" height="64" rx="13"/><text x="495" y="113">Orders</text></g>
        <g className="showcase-node showcase-node-payments"><rect x="476" y="214" width="142" height="64" rx="13"/><text x="495" y="253">Payments</text></g>
        <g className="showcase-cursor"><path d="M398 183 L398 210 L405 203 L413 217 L420 214 L412 200 L422 199 Z"/><text x="430" y="226">you</text></g>
      </svg>
      <div className="site-showcase-command"><span><AudioLines size={17}/></span><p>Connect checkout to payments</p><kbd>↵</kbd></div>
    </div>
  </div>;
}

function AuthPage({mode,error,onSubmit,link}:{mode:'sign-in'|'sign-up';error:string;onSubmit:(user:User)=>Promise<void>;link:(next:string)=>(event:MouseEvent<HTMLAnchorElement>)=>void}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[formError,setFormError]=useState(''),[busy,setBusy]=useState(false);
  const signup=mode==='sign-up';
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setFormError('');
    if(signup&&password!==confirm){setFormError('Passwords do not match.');return;}
    setBusy(true);
    try{const result=await request<{user:User}>(signup?'/api/auth/sign-up':'/api/auth/sign-in','POST',{email,password});await onSubmit(result.user);}
    catch(cause){setFormError(cause instanceof Error?cause.message:'Please try again.');}
    finally{setBusy(false);}
  };
  return <div className="site-auth"><div className="site-auth-panel"><Brand link={link}/><div className="site-auth-story"><span className="site-eyebrow">YOUR WORKSPACE</span><h2>From a spoken thought to a diagram you can change.</h2><p>Save your work to your account, then come back to continue where you left off.</p><DiagramShowcase/></div></div><main className="site-auth-main"><a className="site-auth-home" href="/" onClick={link('/')}>← Back to home</a><div className="site-auth-form"><span className="site-auth-mark"><LockKeyhole size={22}/></span><h1>{signup?'Create your account':'Welcome back'}</h1><p>{signup?'Start a private workspace for your diagrams.':'Sign in to keep building your diagram.'}</p><form onSubmit={submit}><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} required maxLength={254} placeholder="you@example.com"/><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={signup?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} required minLength={signup?12:1} maxLength={128} placeholder={signup?'At least 12 characters':'Enter your password'}/>{signup&&<><label htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)} required minLength={12} maxLength={128} placeholder="Repeat your password"/></>}{(formError||error)&&<div className="site-form-error" role="alert">{formError||error}</div>}<button className="site-button site-button-dark site-submit" disabled={busy}>{busy?'Please wait…':signup?'Create account':'Sign in'} <ArrowRight size={18}/></button></form><p className="site-auth-switch">{signup?'Already have an account?':'New to Voxraft?'} <a href={signup?'/sign-in':'/sign-up'} onClick={link(signup?'/sign-in':'/sign-up')}>{signup?'Sign in':'Create an account'}</a></p></div></main></div>;
}

function AccountPage({user,error,onSignOut,onImport,hasLocalDraft,link}:{user:User;error:string;onSignOut:()=>Promise<void>;onImport:()=>Promise<void>;hasLocalDraft:boolean;link:(next:string)=>(event:MouseEvent<HTMLAnchorElement>)=>void}){
  const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const change=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setMessage('');try{await request('/api/auth/change-password','POST',{current_password:current,new_password:next});setCurrent('');setNext('');setMessage('Password updated. Other sessions were signed out.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Could not update your password.');}finally{setBusy(false);}};
  return <div className="site-page site-account"><header className="site-header"><div className="site-container site-nav"><Brand link={link}/><a className="site-button site-button-dark" href="/dashboard" onClick={link('/dashboard')}>Open dashboard <ArrowRight size={17}/></a></div></header><main className="site-container site-account-main"><a className="site-back-link" href="/dashboard" onClick={link('/dashboard')}>← Back to dashboard</a><p className="site-eyebrow">ACCOUNT</p><h1>Your workspace, your diagrams.</h1><div className="site-account-grid"><section><h2>Account details</h2><p>Signed in as</p><strong>{user.email}</strong><button className="site-signout" onClick={()=>void onSignOut()}>Sign out</button></section><section><h2>Change password</h2><form onSubmit={change}><label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" value={current} onChange={event=>setCurrent(event.target.value)} required/><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={next} onChange={event=>setNext(event.target.value)} minLength={12} maxLength={128} required/><button className="site-button site-button-dark" disabled={busy}>{busy?'Updating…':'Update password'}</button></form></section></div>{hasLocalDraft&&<section className="site-migrate"><h2>Have a diagram from before accounts?</h2><p>Bring the older local draft from this browser into your account as a separate diagram.</p><button onClick={()=>void onImport()}>Import local draft <ArrowRight size={16}/></button></section>}{(message||error)&&<p className="site-account-message" role="status">{message||error}</p>}</main></div>;
}
