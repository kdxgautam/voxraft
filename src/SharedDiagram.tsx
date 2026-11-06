import {useCallback,useEffect,useRef,useState} from 'react';
import {Excalidraw} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type {BinaryFiles,ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import {toElements} from './diagramElements';
import type {ProjectFiles} from './project';
import type {Scene} from './scene';

type Shared={name:string;updated_at:number;diagram:Pick<Scene,'nodes'|'edges'|'containers'|'extras'>;files:ProjectFiles};
const canvasOptions={canvasActions:{loadScene:false,saveToActiveFile:false,export:false,clearCanvas:false}} as const;

export default function SharedDiagram({token}:{token:string}){
  const [shared,setShared]=useState<Shared|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const last=useRef('');
  const canvas=useRef<ExcalidrawImperativeAPI|null>(null);
  const fit=useCallback((api:ExcalidrawImperativeAPI)=>{canvas.current=api;window.setTimeout(()=>api.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.86}),120);},[]);
  useEffect(()=>{
    let timer:number|undefined;
    const onResize=()=>{
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>canvas.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.86}),180);
    };
    window.addEventListener('resize',onResize);
    return ()=>{window.removeEventListener('resize',onResize);window.clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const response=await fetch(`/api/shared/${encodeURIComponent(token)}`);
        if(!response.ok)throw new Error(response.status===404?'This sharing link is unavailable.':'Could not load the shared diagram.');
        const data=await response.json() as Shared;
        if(!active)return;
        const fingerprint=JSON.stringify([data.updated_at,data.diagram,data.files]);
        if(fingerprint!==last.current){last.current=fingerprint;setShared(data);setRevision(value=>value+1);}
        setError('');
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:'Could not load the shared diagram.');}
    };
    void load();
    const timer=window.setInterval(()=>void load(),15000);
    return()=>{active=false;window.clearInterval(timer);};
  },[token]);
  return <div className="shared-page"><header className="shared-header"><a href="/" className="shared-brand">Voxraft</a><div><strong>{shared?.name||'Shared diagram'}</strong><span>Read only · updates automatically</span></div></header>{error?<main className="shared-state" role="alert">{error} <a href="/">Go home</a></main>:shared?<main className="shared-canvas"><Excalidraw key={revision} excalidrawAPI={fit} initialData={{elements:toElements(shared.diagram),files:shared.files as BinaryFiles}} viewModeEnabled UIOptions={canvasOptions} theme="light"/></main>:<main className="shared-state" role="status">Opening diagram…</main>}</div>;
}
