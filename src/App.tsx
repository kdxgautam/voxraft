import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ArrowDownToLine, ChevronDown, CornerDownLeft, History, LayoutGrid, Mic, MoreHorizontal, Palette, RotateCcw, RotateCw, Settings2, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { bindSelection, clarifyActions, clearScene, descendantNodeIds, emptyScene, execute, intentScope, moveFromCanvas, replaceLastEdit, SceneError, selectedEdgeId, selectedNodeIds, syncCanvas, type Action, type CanvasElement, type Scene } from './scene';
import { readSavedLogs, readSavedScene, writeProject, type Log, type ProjectFiles } from './project';
import { VoiceSession, type VoiceStatus } from './voiceSession';
import { resolvePlannedActions } from './targetResolver';
import { keyTerms } from './keyTerms';
import { diagramInsight } from './insights';
import { applyReplicaProposal,type ReviewFinding } from './reviewProposal';
import { LayoutPreview, verifiedPositions, type LayoutResult } from './layoutCritique';
import { applyVisualProposal, type VisualResult } from './visualProposal';
import {historyCommand,proposalCommand} from './controlCommands';
import {conversionOptions,conversionQuestions,conversionRootChoices,convertScene,withConversionPositions,type ConversionChoices} from './conversion';
import { toElements } from './diagramElements';
import {appendGeneratedDiagram,type GeneratedType} from './generatedDiagram';

const storageKey='bolcanvas.scene.v1';
const logsKey='bolcanvas.logs.v1';
const latestKey='bolcanvas.latest.v1';
const canvasOptions={canvasActions:{loadScene:false,saveToActiveFile:false,export:false,clearCanvas:false}} as const;
type DiagramType=NonNullable<Scene['context']['type']>;
const diagramName=(type:DiagramType)=>({architecture:'Architecture',mindmap:'Mind map',hierarchy:'Hierarchy',brainstorming:'Brainstorming',flowchart:'Flowchart',mixed:'Mixed'}[type]);
const suggestedProjectName=(description:string)=>{
  const clean=description.trim().replace(/^(?:(?:please\s+)?(?:create|generate|draw|make)\s+(?:a\s+)?(?:complete\s+)?(?:diagram|flowchart|mind\s*map|org\s*chart|hierarchy|system\s+architecture|architecture|brainstorming)?\s*(?:about|of|for|showing)?\s*)/i,'').replace(/[.!?]+$/,'').trim();
  if(!clean)return 'Untitled diagram';
  const words=clean.split(/\s+/).slice(0,8).join(' ');
  return words.charAt(0).toUpperCase()+words.slice(1);
};
type Clarification=
  | {kind:'node';actions:Action[];reference:string;candidateIds:string[];question:string;command:string;mode:'llm'|'fallback';revision?:boolean}
  | {kind:'question';question:string;command:string;turns:number;revision?:boolean};
type LastApplied={before:Scene;after:Scene;command:string;actions:Action[]};
type ReviewResult={finding:ReviewFinding|null;mode:'agent'|'rules';tools_used:string[]};
type PendingReview={scene:Scene;finding:ReviewFinding;mode:ReviewResult['mode'];tools:string[]};
type PendingLayout={scene:Scene;result:LayoutResult;positions:Record<string,{x:number;y:number}>};
type PendingVisual={scene:Scene;preview:Scene;result:VisualResult;shapeOnly:boolean};
type PendingConversion={scene:Scene;target:DiagramType;choices:ConversionChoices;rootId:string;preview?:Scene;loading?:boolean};
const conversionTarget=(text:string):DiagramType|null=>{
  const match=text.trim().replace(/[.!?]+$/,'').match(/^convert\s+(?:(?:this|the|my)\s+)?(?:(?:diagram|canvas|mind\s*map|architecture|hierarchy|brainstorm(?:ing)?|flow\s*chart|mixed)\s+)?to\s+(?:a\s+)?(architecture|mind\s*map|hierarchy|brainstorm(?:ing)?|notes?|flow\s*chart|mixed(?:\s+canvas)?)$/i);
  if(!match)return null;
  const name=match[1].toLowerCase().replace(/\s+/g,'');
  return name==='mindmap'?'mindmap':name==='hierarchy'?'hierarchy':name.startsWith('brainstorm')||name.startsWith('note')?'brainstorming':name==='flowchart'?'flowchart':name.startsWith('mixed')?'mixed':'architecture';
};
const isCorrection=(text:string)=>/^(?:wait\b[,!:\s]*)?(?:no\b[,!:\s]*|actually\b[,\s]*|i meant\b|sorry\b[,\s]*|instead\b)/i.test(text.trim());
const correctedPurpose=(text:string)=>text.trim().replace(/[.!?]+$/,'').match(/^(?:actually|no|i meant)[,\s]+(?:this diagram is for|the (?:diagram )?purpose (?:is|should be))\s+(.+)$/i)?.[1]?.trim();
const isReviewUtterance=(text:string)=>/^(?:please\s+)?(?:review|analyze|analyse)\s+(?:(?:this|the|my)\s+)?(?:diagram|architecture|mind\s*map|hierarchy|brainstorm(?:ing)?|notes?|flow\s*chart)(?:\s+please)?[.!?]?$/i.test(text.trim());
const isLayoutUtterance=(text:string)=>/^(?:please\s+)?(?:make\s+(?:this|the|my)\s+(?:diagram\s+)?easier\s+to\s+read|critique\s+(?:this|the|my)\s+layout|improve\s+(?:this|the|my)\s+layout|(?:arrange|organize|organise|tidy(?:\s+up)?|auto\s*layout)\s+(?:(?:the|this|my)\s+)?(?:diagram|canvas|blocks|nodes|mind\s*map|notes?|ideas?))(?:\s+please)?[.!?]?$/i.test(text.trim());
const isVisualUtterance=(text:string)=>/^(?:please\s+)?(?:style\s+(?:this|the|my)\s+(?:diagram|canvas|mind\s*map|notes?|ideas?)|improve\s+(?:this|the|my)\s+(?:diagram(?:'s)?\s+)?visual\s+design|design\s+(?:this|the|my)\s+(?:diagram|mind\s*map|notes?|ideas?))(?:\s+please)?[.!?]?$/i.test(text.trim());
const isShapeUtterance=(text:string)=>/^(?:please\s+)?(?:suggest|recommend|review)\s+(?:meaningful\s+)?shapes(?:\s+for\s+(?:this|the|my)\s+(?:diagram|canvas))?(?:\s+please)?[.!?]?$/i.test(text.trim());
const isShapeReconsideration=(text:string)=>/^(?:please\s+)?reconsider\s+(?:(?:my|the)\s+)?(?:shape\s+choices|shapes)(?:\s+please)?[.!?]?$/i.test(text.trim());
const storageWarningText='Auto-save is unavailable. Use Save to export your project before closing this page.';
function savedValue(key:string):string|null {try{return localStorage.getItem(key);}catch{return null;}}
function load(storageId:string,project:{scene:Scene}|null):{scene:Scene;warning:string}{
  if(project)return {scene:project.scene,warning:''};
  try{const value=localStorage.getItem(`${storageKey}.${storageId}`);return {scene:value?readSavedScene(value):emptyScene(),warning:''};}
  catch{return {scene:emptyScene(),warning:storageWarningText};}
}
async function api<T>(path:string,body:BodyInit,headers?:HeadersInit,signal?:AbortSignal):Promise<T>{const response=await fetch(path,{method:'POST',body,headers,signal});const json=await response.json();if(!response.ok)throw new Error(json.detail||'Request failed');return json;}

export default function App({projectId,storageId,projectName,initialProject,onPersist,onDashboard,onCreate,onAutoName,saveError}:{projectId:string;storageId:string;projectName:string;initialProject:{scene:Scene;logs:Log[];latest:string;files?:ProjectFiles}|null;onPersist:(project:string)=>Promise<void>;onDashboard:(project:string)=>Promise<void>;onCreate:()=>Promise<void>;onAutoName:(name:string)=>Promise<void>;saveError:string}){
  const [initial]=useState(()=>load(storageId,initialProject));
  const [scene,setScene]=useState<Scene>(initial.scene);
  const sceneRef=useRef(scene); sceneRef.current=scene;
  const [logs,setLogs]=useState<Log[]>(()=>initialProject?.logs||readSavedLogs(savedValue(`${logsKey}.${storageId}`)));
  const [files,setFiles]=useState<ProjectFiles>(initialProject?.files||{});
  const [shareToken,setShareToken]=useState<string|null>(null);
  const [shareBusy,setShareBusy]=useState(false);
  const [text,setText]=useState('');
  const [purposeDraft,setPurposeDraft]=useState(initial.scene.context.purpose);
  const [noteDraft,setNoteDraft]=useState('');
  const [latest,setLatest]=useState(()=>initialProject?.latest||savedValue(`${latestKey}.${storageId}`)||'');
  const [status,setStatus]=useState<'idle'|'planning'>('idle');
  const [generating,setGenerating]=useState(false);
  const generatingRef=useRef(false);
  const [voice,setVoice]=useState<VoiceStatus>({phase:'IDLE',mode:'stream',detail:'',active:false});
  const [liveTranscript,setLiveTranscript]=useState('');
  const voiceSession=useRef<VoiceSession|null>(null);
  const [message,setMessage]=useState('');
  const [review,setReview]=useState<PendingReview|null>(null);
  const reviewRef=useRef(review);reviewRef.current=review;
  const [reviewing,setReviewing]=useState(false);
  const reviewingRef=useRef(false);
  const [layout,setLayout]=useState<PendingLayout|null>(null);
  const layoutRef=useRef(layout);layoutRef.current=layout;
  const [critiquing,setCritiquing]=useState(false);
  const critiquingRef=useRef(false);
  const [visual,setVisual]=useState<PendingVisual|null>(null);
  const visualRef=useRef(visual);visualRef.current=visual;
  const [conversion,setConversion]=useState<PendingConversion|null>(null);
  const conversionRef=useRef(conversion);conversionRef.current=conversion;
  const [designing,setDesigning]=useState(false);
  const designingRef=useRef(false);
  const [dismissedInsight,setDismissedInsight]=useState<string|null>(null);
  const [storageWarning,setStorageWarning]=useState(initial.warning);
  const autoSaveBlocked=useRef(!!initial.warning);
  const [,setSelectedId]=useState<string|null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [,setSelectedEdge]=useState<string|null>(null);
  const lastApplied=useRef<LastApplied|null>(null);
  const [clarification,setClarificationState]=useState<Clarification|null>(null);
  const clarificationRef=useRef<Clarification|null>(null);
  const setClarification=(value:Clarification|null)=>{clarificationRef.current=value;setClarificationState(value);};
  const [activeMenu,setActiveMenu]=useState<'details'|'assist'|'more'|null>(null);
  const [activityOpen,setActivityOpen]=useState(false);
  const excalidraw=useRef<ExcalidrawImperativeAPI|null>(null);
  const imageCommitTimer=useRef<number|undefined>(undefined);
  const elements=useMemo(()=>toElements(scene),[scene]);
  const insight=useMemo(()=>scene.context.type==='architecture'||scene.containers?.some(container=>container.intentType==='architecture')?diagramInsight(scene):null,[scene]);
  useEffect(()=>setPurposeDraft(scene.context.purpose),[scene.context.purpose]);
  const visibleReview=review?.scene===scene?review:null;
  const visibleLayout=layout?.scene===scene?layout:null;
  const visibleVisual=visual?.scene===scene?visual:null;
  const visibleConversion=conversion?.scene===scene?conversion:null;
  const visibleInsight=visibleReview||insight?.key===dismissedInsight?null:insight;
  const hasDiagramIntent=!!scene.context.type||!!scene.containers?.some(container=>container.intentType);
  const initialCanvasData=useRef({elements,files:files as BinaryFiles,appState:{viewBackgroundColor:'transparent'}}).current;
  const setExcalidrawApi=useCallback((value:ExcalidrawImperativeAPI)=>{excalidraw.current=value;},[]);
  const onCanvasChange=useCallback((_els:readonly {id:string;type:string}[],appState:{selectedElementIds:Record<string,boolean>},currentFiles:BinaryFiles)=>{
    setFiles(previous=>{const ids=Object.keys(currentFiles);return ids.length===Object.keys(previous).length&&ids.every(id=>previous[id]?.dataURL===currentFiles[id].dataURL)?previous:currentFiles;});
    if(_els.some(element=>element.type==='image')){
      window.clearTimeout(imageCommitTimer.current);
      imageCommitTimer.current=window.setTimeout(()=>{
        const current=sceneRef.current,raw=excalidraw.current?.getSceneElements();
        if(!raw)return;
        const next=syncCanvas(current,raw as readonly CanvasElement[]);
        if(next!==current){sceneRef.current=next;setScene(next);lastApplied.current=null;}
      },300);
    }
    const current=sceneRef.current;
    const ids=selectedNodeIds(current,appState.selectedElementIds);
    const id=ids.length===1?ids[0]:null;
    setSelectedId(previous=>previous===id?previous:id);
    setSelectedIds(previous=>previous.length===ids.length&&previous.every((value,index)=>value===ids[index])?previous:ids);
    const edge=selectedEdgeId(current,appState.selectedElementIds);
    setSelectedEdge(previous=>previous===edge?previous:edge);
  },[]);
  useEffect(()=>()=>window.clearTimeout(imageCommitTimer.current),[]);
  const commitCanvas=()=>{
    const current=sceneRef.current;
    const raw=excalidraw.current?.getSceneElements();
    if(!raw)return;
    const next=syncCanvas(current,raw as readonly CanvasElement[]);
    if(next!==current){sceneRef.current=next;setScene(next);lastApplied.current=null;}
    readSelection();
  };
  const highlightInsight=()=>{
    if(!visibleInsight)return;
    const selectedElementIds:Record<string,true>={};
    for(const id of [visibleInsight.nodeId,...visibleInsight.edgeIds])selectedElementIds[id]=true;
    excalidraw.current?.updateScene({appState:{selectedElementIds}});
    setDismissedInsight(visibleInsight.key);
  };
  const highlightReview=()=>{
    if(!visibleReview)return;
    const selectedElementIds:Record<string,true>={};
    for(const id of [...visibleReview.finding.node_ids,...visibleReview.finding.edge_ids])selectedElementIds[id]=true;
    excalidraw.current?.updateScene({appState:{selectedElementIds}});
  };
  const store=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{setStorageWarning(storageWarningText);}};
  useEffect(()=>{if(!autoSaveBlocked.current)store(`${storageKey}.${storageId}`,JSON.stringify(scene));},[scene,storageId]);
  useEffect(()=>{store(`${logsKey}.${storageId}`,JSON.stringify(logs));},[logs,storageId]);
  useEffect(()=>{store(`${latestKey}.${storageId}`,latest);},[latest,storageId]);
  useEffect(()=>{void onPersist(writeProject(scene,logs,latest,files));},[scene,logs,latest,files,onPersist]);
  useEffect(()=>{let active=true;void fetch(`/api/projects/${encodeURIComponent(projectId)}/share`).then(response=>response.ok?response.json():null).then(data=>{if(active&&data)setShareToken(data.token||null);}).catch(()=>{});return()=>{active=false;};},[projectId]);
  useEffect(()=>{excalidraw.current?.updateScene({elements});},[elements]);
  useEffect(()=>{
    if(!visibleVisual&&!visibleLayout)return;
    const timer=window.setTimeout(()=>excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.9}),100);
    return ()=>window.clearTimeout(timer);
  },[visibleVisual,visibleLayout]);
  useEffect(()=>{
    if(!sceneRef.current.nodes.length)return;
    const timer=window.setTimeout(()=>excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.9}),150);
    return ()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{
    let compact=window.innerWidth<=760;
    let timer:number|undefined;
    const onResize=()=>{
      const next=window.innerWidth<=760;
      if(next===compact)return;
      compact=next;
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>{
        if(sceneRef.current.nodes.length)excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.9});
      },180);
    };
    window.addEventListener('resize',onResize);
    return ()=>{window.removeEventListener('resize',onResize);window.clearTimeout(timer);};
  },[]);
  const log=(value:string,kind:Log['kind'])=>setLogs(old=>[{text:value,kind,time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})},...old].slice(0,24));
  const acceptReview=()=>{
    const pending=reviewRef.current;
    if(!pending||sceneRef.current!==pending.scene){setReview(null);reviewRef.current=null;setMessage('The diagram changed. Run the review again.');return;}
    try{
      const next=applyReplicaProposal(pending.scene,pending.finding);
      sceneRef.current=next;setScene(next);setReview(null);reviewRef.current=null;lastApplied.current=null;
      setMessage('Review suggestion added. Undo will remove it.');log('Accepted architecture review suggestion','info');
    }catch(error){setMessage(`Could not apply review suggestion: ${error instanceof Error?error.message:String(error)}`);}
  };
  const readSelection=()=>{
    const selected=excalidraw.current?.getAppState().selectedElementIds||{};
    const nodeIds=selectedNodeIds(sceneRef.current,selected);
    const nodeId=nodeIds.length===1?nodeIds[0]:null;
    const edgeId=selectedEdgeId(sceneRef.current,selected);
    setSelectedId(nodeId);setSelectedIds(nodeIds);setSelectedEdge(edgeId);
    return {nodeId,nodeIds,edgeId};
  };
  const runReview=async(signal?:AbortSignal)=>{
    if(reviewingRef.current)return;
    const current=sceneRef.current;
    if(!current.context.type&&!current.containers?.some(container=>container.intentType)){setMessage('Describe what you want to map first, then I can review it.');return;}
    if(current.nodes.length<2){setMessage('Add at least two topics or components before reviewing the diagram.');return;}
    reviewingRef.current=true;setReviewing(true);reviewRef.current=null;setReview(null);setMessage('');
    try{
      const selected=readSelection();
      const result=await api<ReviewResult>('/api/review',JSON.stringify({nodes:current.nodes.map(({id,label,role})=>({id,label,role})),edges:current.edges.map(({id,sourceId,targetId,relation,label})=>({id,sourceId,targetId,relation,label})),selected_node_id:selected.nodeId,diagram_context:current.context,containers:current.containers||[]}),{'Content-Type':'application/json'},signal);
      if(signal?.aborted)return;
      if(sceneRef.current!==current){setMessage('The diagram changed during review. Run it again.');return;}
      if(result.finding){const pending={scene:current,finding:result.finding,mode:result.mode,tools:result.tools_used};reviewRef.current=pending;setReview(pending);log(`${diagramName(current.context.type!)} review · ${result.mode==='agent'?'agent':'graph rules'}`,'info');}
      else setMessage(current.context.type==='mindmap'?'No disconnected mind-map topics found.':current.context.type==='hierarchy'?'No unattached hierarchy nodes found.':current.context.type==='brainstorming'?'Loose notes and groups are fine here.':current.context.type==='flowchart'?'No supported flowchart issue found.':current.context.type==='mixed'?'No scoped issue found in this mixed diagram.':current.context.type?'No supported architecture issue found in this diagram yet.':'No scoped issue found.');
    }finally{reviewingRef.current=false;setReviewing(false);}
  };
  const runLayoutCritique=async(signal?:AbortSignal)=>{
    if(critiquingRef.current)return;
    const current=sceneRef.current;
    if(!current.context.type&&!current.containers?.some(container=>container.intentType)){setMessage('Describe what you want to map first, then I can critique its layout.');return;}
    if(current.nodes.length<2){setMessage('Add at least two components before critiquing the layout.');return;}
    critiquingRef.current=true;setCritiquing(true);layoutRef.current=null;setLayout(null);setMessage('');
    try{
      const result=await api<LayoutResult>('/api/layout-critique',JSON.stringify({nodes:current.nodes.map(({id,label,x,y,width,height,role})=>({id,label,x,y,width,height,role})),edges:current.edges.map(({id,sourceId,targetId,relation})=>({id,sourceId,targetId,relation})),containers:current.containers||[],diagram_context:current.context}),{'Content-Type':'application/json'},signal);
      if(signal?.aborted)return;
      if(sceneRef.current!==current){setMessage('The diagram changed during layout critique. Run it again.');return;}
      const positions=verifiedPositions(current,result);
      if(positions){const pending={scene:current,result,positions};layoutRef.current=pending;setLayout(pending);log(`Layout critique · ${result.mode==='agent'?'agent':'measured rules'}`,'info');}
      else setMessage(result.summary);
    }finally{critiquingRef.current=false;setCritiquing(false);}
  };
  const acceptLayout=()=>{
    const pending=layoutRef.current;
    if(!pending||sceneRef.current!==pending.scene){setLayout(null);layoutRef.current=null;setMessage('The diagram changed. Run layout critique again.');return;}
    try{
      const positions=verifiedPositions(pending.scene,pending.result);
      if(!positions)throw new Error('No layout change was proposed.');
      const next=moveFromCanvas(pending.scene,positions);
      sceneRef.current=next;setScene(next);setLayout(null);layoutRef.current=null;lastApplied.current=null;
      setMessage('Layout applied. Undo will restore the previous positions.');log('Accepted layout critique','info');
      window.setTimeout(()=>excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.7}),80);
    }catch(error){setMessage(`Could not apply layout: ${error instanceof Error?error.message:String(error)}`);}
  };
  const runVisualDesign=async(signal?:AbortSignal,suggestShapes=false,reconsiderShapes=false)=>{
    if(designingRef.current)return;
    const current=sceneRef.current;
    if(!current.context.type&&!current.containers?.some(container=>container.intentType)){setMessage('Describe what you want to map first, then I can suggest a design.');return;}
    if(!current.nodes.length){setMessage('Add a component before requesting visual design.');return;}
    designingRef.current=true;setDesigning(true);visualRef.current=null;setVisual(null);setMessage('');
    try{
      const result=await api<VisualResult>('/api/visual-design',JSON.stringify({nodes:current.nodes.map(({id,label,shape,shapeSource,role,roleSource})=>({id,label,shape,shapeSource,role,roleSource})),edges:current.edges.map(({id,sourceId,targetId,label,relation})=>({id,sourceId,targetId,label,relation})),groups:current.groups||[],containers:current.containers||[],diagram_context:current.context,suggest_shapes:suggestShapes,reconsider_explicit_shapes:reconsiderShapes}),{'Content-Type':'application/json'},signal);
      if(signal?.aborted)return;
      if(sceneRef.current!==current){setMessage('The diagram changed during visual review. Run it again.');return;}
      const preview=applyVisualProposal(current,result,reconsiderShapes,!suggestShapes);
      if(preview===current){setMessage(suggestShapes?'No supported shape changes to suggest for this diagram.':'This diagram already uses the proposed styles.');return;}
      const pending={scene:current,preview,result,shapeOnly:suggestShapes};visualRef.current=pending;setVisual(pending);log(`${suggestShapes?'Shape review':'Visual design'} · ${result.mode==='agent'?'agent':'diagram rules'}`,'info');
    }finally{designingRef.current=false;setDesigning(false);}
  };
  const acceptVisual=()=>{
    const pending=visualRef.current;
    if(!pending||sceneRef.current!==pending.scene){setVisual(null);visualRef.current=null;setMessage('The diagram changed. Run visual design again.');return;}
    sceneRef.current=pending.preview;setScene(pending.preview);setVisual(null);visualRef.current=null;lastApplied.current=null;
    setMessage(`${pending.shapeOnly?'Shapes':'Visual design'} applied. Undo will restore the previous diagram.`);log(`Accepted ${pending.shapeOnly?'shape suggestions':'visual design'}`,'info');
  };
  const previewConversion=async(pending:PendingConversion,signal?:AbortSignal)=>{
    if(sceneRef.current!==pending.scene){setConversion(null);setMessage('The diagram changed. Start conversion again.');return;}
    setConversion({...pending,loading:true});
    try{
      let preview=convertScene(pending.scene,pending.target,pending.choices,pending.rootId||undefined);
      if(preview.nodes.length>1&&pending.target!=='brainstorming'){
        const result=await api<LayoutResult>('/api/layout-critique',JSON.stringify({nodes:preview.nodes.map(({id,label,x,y,width,height,role})=>({id,label,x,y,width,height,role})),edges:preview.edges.map(({id,sourceId,targetId,relation})=>({id,sourceId,targetId,relation})),containers:preview.containers||[],diagram_context:preview.context}),{'Content-Type':'application/json'},signal);
        const positions=verifiedPositions(preview,result);
        if(positions)preview=withConversionPositions(preview,positions);
      }
      if(signal?.aborted||sceneRef.current!==pending.scene)return;
      const ready={...pending,preview,loading:false};conversionRef.current=ready;setConversion(ready);setMessage('Conversion preview ready. Apply or discard it.');
    }catch(error){setConversion({...pending,loading:false});setMessage(error instanceof Error?error.message:String(error));}
  };
  const beginConversion=async(target:DiagramType,signal?:AbortSignal)=>{
    const current=sceneRef.current;
    if(current.context.type===target){setMessage(`This diagram is already ${diagramName(target)}.`);return;}
    if(!current.context.type){setMessage('Choose a diagram type before converting it.');return;}
    const pending:PendingConversion={scene:current,target,choices:{},rootId:''};conversionRef.current=pending;setConversion(pending);
    if(!conversionQuestions(current,target).length&&!conversionRootChoices(current,target).length)await previewConversion(pending,signal);
    else setMessage('Choose the meaning of ambiguous connections, then preview the conversion.');
  };
  const acceptConversion=()=>{
    const pending=conversionRef.current;
    if(!pending?.preview||sceneRef.current!==pending.scene){setConversion(null);setMessage('The diagram changed. Start conversion again.');return;}
    sceneRef.current=pending.preview;setScene(pending.preview);setConversion(null);conversionRef.current=null;lastApplied.current=null;
    setMessage(`Converted to ${diagramName(pending.target)}. Undo will restore the previous diagram.`);log(`Converted to ${diagramName(pending.target)}`,'info');
  };
  const commitPlanned=(next:Scene,command:string,mode:'llm'|'fallback',plannerMs:number,editMs:number,before:Scene,actions:Action[],historyCommand=command)=>{
    const committedAt=performance.now();
    setClarification(null);setMessage('');setScene(next);sceneRef.current=next;
    lastApplied.current=actions.some(action=>action.type==='UNDO'||action.type==='REDO')?null:{before,after:next,command:historyCommand,actions};
    let logged=false;
    const recordPaint=()=>{if(logged)return;logged=true;log(`${command} · ${mode==='llm'?'AI planner':'local parser'} · plan ${Math.round(plannerMs)} ms · scene ${Math.round(editMs)} ms · view ~${Math.round(performance.now()-committedAt)} ms`,'command');};
    requestAnimationFrame(()=>requestAnimationFrame(recordPaint));
    window.setTimeout(recordPaint,300);
    setText('');
    if(next.nodes.length)setTimeout(()=>excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.9}),80);
  };
  const generateDiagram=async(description:string,kind:GeneratedType|'auto'='auto',signal?:AbortSignal)=>{
    if(generatingRef.current)return;
    const current=sceneRef.current;
    generatingRef.current=true;setGenerating(true);
    setMessage('Building the diagram…');
    try{
      const result=await api<{actions:Action[];diagram_type:GeneratedType;mode:'llm'|'fallback'}>('/api/generate',JSON.stringify({description,diagram_type:kind}),{'Content-Type':'application/json'},signal);
      if(signal?.aborted)return;
      if(sceneRef.current!==current)throw new Error('The canvas changed while generating. Please try again.');
      const next=appendGeneratedDiagram(current,result.actions,result.diagram_type,description);
      sceneRef.current=next;setScene(next);setClarification(null);setText('');lastApplied.current=null;
      if(projectName==='Untitled diagram')void onAutoName(suggestedProjectName(description)).catch(error=>setMessage(`Diagram created, but its title could not be saved: ${error instanceof Error?error.message:String(error)}`));
      setMessage(`${diagramName(result.diagram_type)} added to this canvas.`);log(`Generated ${diagramName(result.diagram_type)} from description`,'command');
      window.setTimeout(()=>excalidraw.current?.scrollToContent(undefined,{fitToViewport:true,viewportZoomFactor:0.9}),100);
    }finally{generatingRef.current=false;setGenerating(false);}
  };
  const applyCommand=async(value:string,signal?:AbortSignal,confirmedIntent?:DiagramType)=>{
    if(!clarificationRef.current&&/^(?:please\s+)?(?:create|start|open|make)?\s*(?:a\s+)?new\s+diagram[.!?]?$/i.test(value.trim())){voiceSession.current?.stop();await onPersist(writeProject(sceneRef.current,logs,latest,files));await onCreate();return;}
    const conversionVerb=value.trim().replace(/[.!?]+$/,'').match(/^(preview|apply|discard|cancel)\s+(?:the\s+)?conversion$/i)?.[1]?.toLowerCase();
    if(conversionVerb&&conversionRef.current){
      const pending=conversionRef.current;
      if(conversionVerb==='apply')acceptConversion();
      else if(conversionVerb==='preview')await previewConversion(pending,signal);
      else {setConversion(null);conversionRef.current=null;setMessage('Conversion discarded.');}
      setText('');return;
    }
    const convertTo=conversionTarget(value);
    if(convertTo){await beginConversion(convertTo,signal);setText('');return;}
    const fullDiagram=!clarificationRef.current&&value.trim().match(/^(?:generate|draw|create)\s+(?:a\s+)?(?:complete\s+)?(flowchart|mind\s*map|org\s*chart|hierarchy|system\s+architecture|architecture|brainstorming)(?:\s+(?:about|of|for|showing))?\s+(.+)$/i);
    if(fullDiagram){const named=fullDiagram[1].toLowerCase().replace(/\s+/g,'');const kind:Exclude<DiagramType,'mixed'>=named==='mindmap'?'mindmap':named==='orgchart'||named==='hierarchy'?'hierarchy':named==='systemarchitecture'||named==='architecture'?'architecture':named==='brainstorming'?'brainstorming':'flowchart';await generateDiagram(fullDiagram[2].trim(),kind,signal);return;}
    const openDiagram=!clarificationRef.current&&value.trim().match(/^(?:generate|draw|create)\s+(?:a\s+)?diagram\s+(?:of|for|about|showing)\s+(.+)$/i);
    if(openDiagram){await generateDiagram(openDiagram[1].trim(),'auto',signal);return;}
    if(isReviewUtterance(value)){voiceSession.current?.interruptSpeech();setClarification(null);await runReview(signal);return;}
    if(isLayoutUtterance(value)){voiceSession.current?.interruptSpeech();setClarification(null);setText('');await runLayoutCritique(signal);return;}
    if(isVisualUtterance(value)||isShapeUtterance(value)||isShapeReconsideration(value)){voiceSession.current?.interruptSpeech();setClarification(null);setText('');await runVisualDesign(signal,isShapeUtterance(value)||isShapeReconsideration(value),isShapeReconsideration(value));return;}
    const history=historyCommand(value);
    if(history){voiceSession.current?.interruptSpeech();historyAction(history.type,history.steps);setText('');return;}
    const proposal=proposalCommand(value);
    if(proposal){
      voiceSession.current?.interruptSpeech();setClarification(null);setText('');
      const current=sceneRef.current;
      const available={design:!!visualRef.current&&visualRef.current.scene===current,layout:!!layoutRef.current&&layoutRef.current.scene===current,review:!!reviewRef.current&&reviewRef.current.scene===current&&reviewRef.current.finding.actions.length>0};
      const matches=proposal.target==='current'?(Object.keys(available) as (keyof typeof available)[]).filter(key=>available[key]):[proposal.target];
      if(matches.length!==1||!available[matches[0]]){setMessage(matches.length>1?'Say “apply design”, “apply layout”, or “apply review” to choose a suggestion.':`No ${proposal.target==='current'?'suggestion':proposal.target+' proposal'} is waiting to ${proposal.verb}.`);return;}
      const target=matches[0];
      if(proposal.verb==='apply'){if(target==='design')acceptVisual();else if(target==='layout')acceptLayout();else acceptReview();}
      else {if(target==='design'){setVisual(null);visualRef.current=null;}else if(target==='layout'){setLayout(null);layoutRef.current=null;}else {setReview(null);reviewRef.current=null;}setMessage(`${target[0].toUpperCase()+target.slice(1)} suggestion discarded.`);}
      return;
    }
    const current=sceneRef.current;
    const purposeFix=correctedPurpose(value);
    if(purposeFix){const next=execute(current,[{type:'SET_PURPOSE',purpose:purposeFix}]);commitPlanned(next,value,'fallback',0,0,current,[{type:'SET_PURPOSE',purpose:purposeFix}]);return;}
    const selected=readSelection();
    let pending=clarificationRef.current;
    if(pending&&/^(cancel|never mind|nevermind|skip)$/i.test(value.trim().replace(/[.!?]+$/,''))){voiceSession.current?.interruptSpeech();setClarification(null);setMessage('Pending command cancelled.');setText('');return;}
    const revision=!!pending&&'revision' in pending&&!!pending.revision||!pending&&isCorrection(value);
    const previous=revision?lastApplied.current:null;
    if(revision&&(!previous||previous.after!==current))throw new Error('There is no unchanged recent command to correct. Please give the full command.');
    const base=previous?.before||current;
    const selectedNode=selected.nodeId&&base.nodes.some(node=>node.id===selected.nodeId)?selected.nodeId:null;
    const selectedNodes=selected.nodeIds.filter(id=>base.nodes.some(node=>node.id===id));
    const selectedArrow=selected.edgeId&&base.edges.some(edge=>edge.id===selected.edgeId)?selected.edgeId:null;
    const started=performance.now();let plannerMs=0;
    let actions:Action[],mode:'llm'|'fallback',command=value;
    if(pending?.kind==='node'){
      try{actions=clarifyActions(base,pending.actions,pending.reference,pending.candidateIds,value,selectedNode);}
      catch(error){setMessage(`${error instanceof Error?error.message:String(error)} ${pending.question}`);return;}
      mode=pending.mode;command=pending.command;
    }else{
      const result=await api<{actions:unknown[];mode:'llm'|'fallback';question?:string;intent_suggestion?:{type:DiagramType|null;reason:string}}>('/api/plan',JSON.stringify({text:value,pending_command:pending?.kind==='question'?pending.command:undefined,clarification_answer:pending?.kind==='question'?value:undefined,revision_of:revision?previous!.command:undefined,previous_actions:revision?previous!.actions:undefined,nodes:base.nodes,last_command:lastApplied.current?.after===base?lastApplied.current.command:undefined,last_actions:lastApplied.current?.after===base?lastApplied.current.actions:[],edges:base.edges,groups:base.groups||[],containers:base.containers||[],diagram_context:confirmedIntent?{...base.context,type:confirmedIntent,source:'confirmed'}:base.context,recent_ids:base.recentIds,selected_node_id:selectedNode,selected_node_ids:selectedNodes,selected_edge_id:selectedArrow,recent_edge_id:base.recentEdgeId||null}),{'Content-Type':'application/json'},signal);
      plannerMs=performance.now()-started;
      if(signal?.aborted)return;
      if(sceneRef.current!==current)throw new Error('The canvas changed while I was planning. Please repeat the command.');
      if(result.intent_suggestion){
        if(result.intent_suggestion.type){await applyCommand(value,signal,result.intent_suggestion.type);return;}
        setMessage('Describe how these parts relate so I can draw the right diagram.');setText('');return;
      }
      if(result.question){
        if(pending?.kind==='question'&&pending.turns>=3)throw new Error('I still need more detail. Please start the command again with the component names.');
        setClarification({kind:'question',question:result.question,command:pending?.command||value,turns:(pending?.kind==='question'?pending.turns:0)+1,revision});
        setMessage(result.question);setText('');voiceSession.current?.speakQuestion(result.question);return;
      }
      actions=bindSelection(result.actions,null);if(actions.length===1&&actions[0].type==='NEW_DIAGRAM'){voiceSession.current?.stop();await onPersist(writeProject(sceneRef.current,logs,latest,files));await onCreate();return;}if(confirmedIntent)actions=[{type:'SET_DIAGRAM_CONTEXT',diagramType:confirmedIntent,source:'confirmed'},...actions];mode=result.mode;
      if(pending?.kind==='question')command=pending.command;
    }
    let next:Scene;
    const editStarted=performance.now();
    try{
      actions=pending?.kind==='node'?actions:resolvePlannedActions(base,actions,command,selectedNode,selectedNodes,selectedArrow);
      next=revision?replaceLastEdit(current,base,previous!.after,actions):execute(base,actions);
      if(confirmedIntent&&!revision&&base.context.type===null){
        const scoped=execute(next,[{type:'SET_DIAGRAM_CONTEXT',diagramType:'mixed',source:'explicit'}]);
        next={...scoped,past:next.past};
      }
    }
    catch(error){
      if(error instanceof SceneError&&error.clarification&&error.reference){
        setClarification({kind:'node',actions:error.actions||actions,reference:error.reference,candidateIds:error.candidateIds,question:error.message,command,mode,revision});
        setMessage(error.message);setText('');voiceSession.current?.speakQuestion(error.message);return;
      }
      throw error;
    }
    if(signal?.aborted)return;
    const editMs=performance.now()-editStarted;
    commitPlanned(next,revision?`Corrected: ${command}`:command,mode,plannerMs,editMs,base,actions,revision?previous!.command:command);
  };
  const run=useCallback(async(command:string)=>{
    const value=command.trim();if(!value||status!=='idle'||voice.active)return;
    setMessage('');setLatest(value);setStatus('planning');
    try{await applyCommand(value);}catch(error){const detail=error instanceof Error?error.message:String(error);setMessage(detail);log(detail,'error');}
    finally{setStatus('idle');}
  },[status,voice.active]);
  const startVoiceSession=async()=>{
    if(voiceSession.current||status!=='idle')return;
    setMessage('');
    const session=new VoiceSession({
      onStatus:setVoice,
      onTranscript:setLatest,
      onPartialTranscript:setLiveTranscript,
      onExecute:async(value,signal)=>{await applyCommand(value,signal);},
      onError:detail=>{setMessage(detail);log(detail,'error');},
      onSttTiming:ms=>{if(ms<30000)log(`Speech to transcript ~${Math.round(ms)} ms`,'info');},
      getKeyTerms:()=>keyTerms(sceneRef.current)
    });
    voiceSession.current=session;
    try{await session.start();}
    catch(error){voiceSession.current=null;setMessage(error instanceof Error?error.message:String(error));}
  };
  const stopVoiceSession=()=>{voiceSession.current?.stop();voiceSession.current=null;setClarification(null);};
  useEffect(()=>()=>{voiceSession.current?.stop();voiceSession.current=null;},[]);
  const historyAction=(type:'UNDO'|'REDO',steps=1)=>{try{const next=execute(sceneRef.current,[{type,steps}]);setClarification(null);setScene(next);sceneRef.current=next;lastApplied.current=null;log(`${type==='UNDO'?'Undo':'Redo'}${steps>1?` ${steps} steps`:''}`,'info');setMessage('');}catch(error){setMessage((error as Error).message);}};
  const downloadBlob=(filename:string,blob:Blob)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const download=(filename:string,data:string)=>downloadBlob(filename,new Blob([data],{type:'application/json'}));
  const exportScene=()=>download('voxraft.excalidraw',JSON.stringify({type:'excalidraw',version:2,source:'bolcanvas',elements,appState:{viewBackgroundColor:'#ffffff'},files},null,2));
  const shareUrl=shareToken?`${window.location.origin}/share/${shareToken}`:'';
  const createShare=async()=>{
    setShareBusy(true);
    try{
      const serialized=writeProject(sceneRef.current,logs,latest,files);
      await onPersist(serialized);
      const saved=await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
      if(!saved.ok)throw new Error('Could not verify the saved diagram.');
      const savedProject=(await saved.json()).project;
      const expected=JSON.parse(serialized);
      if(JSON.stringify(savedProject.scene)!==JSON.stringify(expected.scene)||JSON.stringify(savedProject.files||{})!==JSON.stringify(expected.files))throw new Error('The latest diagram could not be saved. Try sharing again after autosave succeeds.');
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/share`,{method:'POST'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.detail||'Could not create sharing link.');
      setShareToken(data.token);
      try{await navigator.clipboard.writeText(`${window.location.origin}/share/${data.token}`);setMessage('Read-only link copied. Anyone with the link can view the latest saved diagram.');}
      catch{setMessage('Read-only link ready. Copy it from the menu.');}
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setShareBusy(false);}
  };
  const revokeShare=async()=>{
    setShareBusy(true);
    try{const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/share`,{method:'DELETE'});if(!response.ok)throw new Error('Could not stop sharing.');setShareToken(null);setMessage('Sharing stopped. The old link no longer works.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setShareBusy(false);}
  };
  const exportImage=async(format:'png'|'svg'|'pdf')=>{
    const api=excalidraw.current;
    if(!api||!api.getSceneElements().length){setMessage('Add something to the canvas before exporting.');return;}
    try{
      const {exportToBlob,exportToSvg}=await import('@excalidraw/excalidraw');
      const options={elements:api.getSceneElements(),files:api.getFiles(),appState:{viewBackgroundColor:'#ffffff',exportBackground:true,exportWithDarkMode:false},exportPadding:32};
      if(format==='png'){downloadBlob(`${projectName}.png`,await exportToBlob({...options,mimeType:'image/png'}));return;}
      const svg=await exportToSvg(options);
      if(format==='svg'){downloadBlob(`${projectName}.svg`,new Blob([svg.outerHTML],{type:'image/svg+xml'}));return;}
      const frame=document.createElement('iframe');
      frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.append(frame);
      frame.onload=()=>{frame.contentWindow?.focus();frame.contentWindow?.print();window.setTimeout(()=>frame.remove(),60000);};
      frame.srcdoc=`<!doctype html><html><head><title>Voxraft diagram</title><style>@page{size:landscape;margin:12mm}body{margin:0;display:grid;place-items:center;min-height:90vh}svg{max-width:100%;max-height:90vh}</style></head><body>${svg.outerHTML}</body></html>`;
      setMessage('Choose “Save as PDF” in the print dialog.');
    }catch(error){setMessage(`Export failed: ${error instanceof Error?error.message:String(error)}`);}
  };
  const clear=()=>{if(!scene.nodes.length&&!scene.edges.length&&!scene.extras?.length)return;if(!window.confirm('Clear this diagram? You can undo this.'))return;const next=clearScene(sceneRef.current);sceneRef.current=next;setScene(next);setClarification(null);lastApplied.current=null;setSelectedId(null);setSelectedIds([]);setSelectedEdge(null);log('Clear diagram','info');setLatest('');setText('');setMessage('Canvas cleared. Undo will restore it.');};
  const savePurpose=()=>{const purpose=purposeDraft.trim();if(purpose===sceneRef.current.context.purpose)return;try{const next=execute(sceneRef.current,[{type:'SET_PURPOSE',purpose}]);sceneRef.current=next;setScene(next);lastApplied.current=null;}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const rememberNote=()=>{const note=noteDraft.trim();if(!note)return;try{const next=execute(sceneRef.current,[{type:'REMEMBER_NOTE',note}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setNoteDraft('');setMessage('Decision saved for this diagram.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const forgetNote=(note:string)=>{try{const next=execute(sceneRef.current,[{type:'FORGET_NOTE',note}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setMessage('Decision removed.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const createSelectedContainer=()=>{
    if(selectedIds.length<2)return;
    const name=window.prompt('Name this container (for example, Backend cluster):')?.trim();
    if(!name)return;
    try{const next=execute(sceneRef.current,[{type:'CREATE_CONTAINER',name,targets:selectedIds}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setMessage(`Container “${name}” created. Undo will remove it.`);log(`Created container ${name}`,'info');setActiveMenu(null);}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const highlightContainer=(ids:string[])=>{
    const selectedElementIds:Record<string,true>={};for(const id of ids)selectedElementIds[id]=true;
    excalidraw.current?.updateScene({appState:{selectedElementIds}});setActiveMenu(null);
  };
  const dissolveContainer=(id:string,name:string)=>{
    try{const next=execute(sceneRef.current,[{type:'DELETE_CONTAINER',container:id}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setMessage(`Container “${name}” removed. Its blocks remain; Undo will restore it.`);log(`Dissolved container ${name}`,'info');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const toggleContainer=(id:string,collapsed:boolean)=>{
    try{const next=execute(sceneRef.current,[{type:'SET_CONTAINER_COLLAPSED',container:id,collapsed}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setMessage(`${collapsed?'Collapsed':'Expanded'} container. Undo will restore it.`);}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const setContainerRoot=(id:string,nodeId:string)=>{
    try{const next=execute(sceneRef.current,[{type:'SET_CONTAINER_ROOT',container:id,target:nodeId}]);sceneRef.current=next;setScene(next);lastApplied.current=null;setMessage('Central topic selected for this container.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const containerDepth=(id:string)=>{let depth=0;let item=scene.containers?.find(container=>container.id===id);while(item?.parentId){depth++;item=scene.containers?.find(container=>container.id===item?.parentId);}return depth;};
  return <div className="shell editor-shell">
    <main className="main editor-main">
      <header className="topbar editor-topbar">
        <div className="editor-identity">
          <button className="editor-back" onClick={()=>{const serialized=writeProject(sceneRef.current,logs,latest,files);void onPersist(serialized).then(()=>onDashboard(serialized))}} aria-label="Back to dashboard" title="Back to dashboard"><span>Voxraft</span></button>
          <span className="editor-divider"/>
          <div className="editor-project-title"><strong>{projectName}</strong><span>{saveError?'Saved locally':'Autosave on'}</span></div>
        </div>
        <div className="top-actions editor-actions">
          {selectedIds.length>1&&<button title="Contain selected blocks" onClick={createSelectedContainer} disabled={voice.active}>Contain {selectedIds.length} blocks</button>}
          <button className="icon-action" title="Undo" aria-label="Undo" onClick={()=>historyAction('UNDO')} disabled={!scene.past.length||voice.active}><RotateCcw size={18}/></button>
          <button className="icon-action" title="Redo" aria-label="Redo" onClick={()=>historyAction('REDO')} disabled={!scene.future.length||voice.active}><RotateCw size={18}/></button>
          <span className="editor-divider"/>
          <button className="editor-add-diagram" onClick={()=>{setActiveMenu(null);void startVoiceSession();}} disabled={voice.active||generating||status!=='idle'}><Mic size={16}/> Add by voice</button>
          <div className="editor-menu-wrap"><button className="editor-menu-trigger" aria-expanded={activeMenu==='assist'} onClick={()=>setActiveMenu(activeMenu==='assist'?null:'assist')}><Sparkles size={17}/> Assist <ChevronDown size={14}/></button>
            {activeMenu==='assist'&&<div className="editor-popover editor-action-menu" role="menu"><strong>Improve this diagram</strong><button onClick={()=>{setActiveMenu(null);void runReview().catch(error=>setMessage(error instanceof Error?error.message:String(error)))}} disabled={reviewing||!hasDiagramIntent||scene.nodes.length<2}><Sparkles size={17}/> Review structure</button><button onClick={()=>{setActiveMenu(null);void runLayoutCritique().catch(error=>setMessage(error instanceof Error?error.message:String(error)))}} disabled={critiquing||!hasDiagramIntent||scene.nodes.length<2}><LayoutGrid size={17}/> Critique layout</button><button onClick={()=>{setActiveMenu(null);void runVisualDesign().catch(error=>setMessage(error instanceof Error?error.message:String(error)))}} disabled={designing||!hasDiagramIntent||!scene.nodes.length}><Palette size={17}/> Design suggestion</button><small>Suggestions preview before you apply them.</small></div>}
          </div>
          <div className="editor-menu-wrap"><button className="editor-menu-trigger" aria-expanded={activeMenu==='details'} onClick={()=>setActiveMenu(activeMenu==='details'?null:'details')}><Settings2 size={17}/> Details</button>
            {activeMenu==='details'&&<div className="editor-popover editor-details" role="dialog" aria-label="Diagram details"><div className="editor-popover-heading"><strong>Diagram details</strong><button onClick={()=>setActiveMenu(null)} aria-label="Close diagram details"><X size={16}/></button></div>
              <div className="intent-controls"><label htmlFor="diagram-purpose">Canvas notes</label><input id="diagram-purpose" value={purposeDraft} onChange={event=>setPurposeDraft(event.target.value)} onBlur={savePurpose} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} maxLength={240} placeholder="What are you exploring?"/></div>
              <div className="detail-section"><h3>Decisions</h3><div className="memory-list">{(scene.context.notes||[]).map(note=><div key={note}><span>{note}</span><button type="button" onClick={()=>forgetNote(note)} aria-label={`Forget ${note}`}>×</button></div>)}<form onSubmit={event=>{event.preventDefault();rememberNote();}}><input aria-label="Diagram decision" value={noteDraft} onChange={event=>setNoteDraft(event.target.value)} maxLength={200} placeholder="Remember a design decision"/><button type="submit" disabled={!noteDraft.trim()}>Add</button></form></div></div>
              {!!scene.groups?.length&&<div className="detail-section"><h3>Groups</h3><div className="group-list">{scene.groups.map(group=><div key={group.name}><strong>{group.name}</strong><span>{group.nodeIds.length} blocks</span></div>)}</div></div>}
              <div className="detail-section"><h3>Containers</h3><button className="detail-contain" onClick={createSelectedContainer} disabled={selectedIds.length<2||voice.active}>Contain selected blocks</button>{(scene.containers||[]).map(container=><div className="detail-container" key={container.id} style={{marginLeft:containerDepth(container.id)*12}}><div><strong>{container.name}</strong><span>{descendantNodeIds(scene,container).length} blocks</span></div><div className="detail-container-actions"><button onClick={()=>toggleContainer(container.id,!container.collapsed)}>{container.collapsed?'Expand':'Collapse'}</button><button onClick={()=>highlightContainer(descendantNodeIds(scene,container))} disabled={!!container.collapsed}>Show</button><button onClick={()=>dissolveContainer(container.id,container.name)}>Dissolve</button></div><span className="diagram-region-type">{container.intentType?diagramName(container.intentType):"Untyped group"}</span>{container.intentType==='mindmap'&&<select aria-label={`Central topic for ${container.name}`} value={container.rootId||''} onChange={event=>event.target.value&&setContainerRoot(container.id,event.target.value)}><option value="">Choose central topic</option>{scene.nodes.filter(node=>intentScope(scene,node.id)?.id===container.id).map(node=><option key={node.id} value={node.id}>{node.label}</option>)}</select>}</div>)}</div>
            </div>}
          </div>
          <div className="editor-menu-wrap"><button className="icon-action" title="More diagram actions" aria-label="More diagram actions" aria-expanded={activeMenu==='more'} onClick={()=>setActiveMenu(activeMenu==='more'?null:'more')}><MoreHorizontal size={20}/></button>{activeMenu==='more'&&<div className="editor-popover editor-action-menu editor-more" role="menu"><button className="mobile-history-action" onClick={()=>{setActiveMenu(null);historyAction('UNDO')}} disabled={!scene.past.length||voice.active}><RotateCcw size={17}/> Undo</button><button className="mobile-history-action" onClick={()=>{setActiveMenu(null);historyAction('REDO')}} disabled={!scene.future.length||voice.active}><RotateCw size={17}/> Redo</button><button onClick={()=>{setActiveMenu(null);void exportImage('png')}} disabled={!scene.nodes.length&&!scene.extras?.length}><ArrowDownToLine size={17}/> Export PNG</button><button onClick={()=>{setActiveMenu(null);void exportImage('svg')}} disabled={!scene.nodes.length&&!scene.extras?.length}><ArrowDownToLine size={17}/> Export SVG</button><button onClick={()=>{setActiveMenu(null);void exportImage('pdf')}} disabled={!scene.nodes.length&&!scene.extras?.length}><ArrowDownToLine size={17}/> Print / Save PDF</button><button onClick={()=>{setActiveMenu(null);exportScene()}}><ArrowDownToLine size={17}/> Export Excalidraw</button>{shareToken?<><div className="editor-share-link"><span>Read-only link</span><input aria-label="Read-only sharing link" readOnly value={shareUrl} onFocus={event=>event.currentTarget.select()}/></div><button onClick={()=>void navigator.clipboard.writeText(shareUrl).then(()=>setMessage('Sharing link copied.')).catch(()=>setMessage('Select and copy the link above.'))} disabled={shareBusy}><Share2 size={17}/> Copy sharing link</button><button onClick={()=>void revokeShare()} disabled={shareBusy}><X size={17}/> Stop sharing</button></>:<button onClick={()=>void createShare()} disabled={shareBusy}><Share2 size={17}/> {shareBusy?'Creating link…':'Share read-only link'}</button>}<button onClick={()=>{setActiveMenu(null);clear()}} disabled={voice.active}><Trash2 size={17}/> Clear canvas</button></div>}</div>
        </div>
      </header>
      <section className="workspace editor-workspace">
        <div className="canvas-wrap" onPointerDown={()=>setActiveMenu(null)} onPointerUp={()=>window.setTimeout(commitCanvas,0)} onKeyUp={event=>{if(!(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLElement&&event.target.isContentEditable))window.setTimeout(commitCanvas,0);}} onBlur={()=>window.setTimeout(commitCanvas,0)}>
          <Excalidraw excalidrawAPI={setExcalidrawApi} initialData={initialCanvasData} onChange={onCanvasChange} UIOptions={canvasOptions} theme="light"/>
        </div>
      </section>
      <div className="proposal-stack">
      {visibleConversion&&<aside className="layout-critique-card conversion-card" role="status"><div className="layout-critique-copy"><strong>Convert to {diagramName(visibleConversion.target)}</strong><span>{visibleConversion.preview?'Review the proposed shapes, connections, and positions.':'Choose a meaning for each connection that cannot be mapped safely.'}</span>{!visibleConversion.preview&&conversionQuestions(scene,visibleConversion.target).map(edge=><label key={edge.id} className="conversion-choice">{scene.nodes.find(node=>node.id===edge.sourceId)?.label} → {scene.nodes.find(node=>node.id===edge.targetId)?.label}<select aria-label={`Meaning of ${edge.id}`} value={visibleConversion.choices[edge.id]||''} onChange={event=>setConversion(current=>current?{...current,choices:{...current.choices,[edge.id]:event.target.value as typeof edge.relation&string}}:current)}><option value="">Choose meaning</option>{conversionOptions(visibleConversion.target,edge).map(kind=><option key={kind} value={kind}>{kind.replaceAll('_',' ')}</option>)}</select></label>)}{!visibleConversion.preview&&conversionRootChoices(scene,visibleConversion.target).length>0&&<label className="conversion-choice">Central topic<select aria-label="Central topic for conversion" value={visibleConversion.rootId} onChange={event=>setConversion(current=>current?{...current,rootId:event.target.value}:current)}><option value="">Choose central topic</option>{conversionRootChoices(scene,visibleConversion.target).map(node=><option key={node.id} value={node.id}>{node.label}</option>)}</select></label>}</div>{visibleConversion.preview&&<LayoutPreview scene={visibleConversion.preview} positions={Object.fromEntries(visibleConversion.preview.nodes.map(node=>[node.id,{x:node.x,y:node.y}]))}/>}<div className="layout-critique-actions">{visibleConversion.preview?<button className="apply-review" onClick={acceptConversion}>Apply conversion</button>:<button className="apply-review" disabled={visibleConversion.loading||conversionQuestions(scene,visibleConversion.target).some(edge=>!visibleConversion.choices[edge.id])||conversionRootChoices(scene,visibleConversion.target).length>0&&!visibleConversion.rootId} onClick={()=>void previewConversion(visibleConversion)}>{visibleConversion.loading?'Preparing…':'Preview conversion'}</button>}<button onClick={()=>{setConversion(null);conversionRef.current=null;setMessage('Conversion discarded.');}}>Discard</button></div></aside>}
      {visibleVisual&&<aside className="layout-critique-card visual-design-card" role="status"><div className="layout-critique-copy"><strong>{visibleVisual.shapeOnly?'Shape suggestions':visibleVisual.result.mode==='agent'?'Visual Design Agent':'Diagram style review'}</strong><span>{visibleVisual.result.summary}</span>{visibleVisual.result.boundary_questions?.map(question=><small key={question} className="boundary-question">{question}</small>)}<small>Checked: {visibleVisual.result.tools_used.map(tool=>tool.replaceAll('_',' ')).join(' → ')}</small>{Object.entries(visibleVisual.result.shape_suggestions||{}).map(([id,suggestion])=>{const node=visibleVisual.scene.nodes.find(item=>item.id===id);return node?<small key={id} className="shape-suggestion"><strong>{node.label}: {node.shape} → {suggestion.shape}</strong> · {suggestion.reason}</small>:null;})}{!visibleVisual.shapeOnly&&<div className="visual-role-list">{visibleVisual.result.roles.slice(0,6).map(item=><span key={item.id}><i style={{background:visibleVisual.result.node_styles[item.id]?.color}}/>{item.label} · {item.group||item.role}</span>)}</div>}</div><LayoutPreview scene={visibleVisual.preview} positions={Object.fromEntries(visibleVisual.preview.nodes.map(node=>[node.id,{x:node.x,y:node.y}]))}/><div className="layout-critique-actions"><button className="apply-review" onClick={acceptVisual}>{visibleVisual.shapeOnly?'Apply shapes':'Apply design'}</button><button onClick={()=>setVisual(null)}>Discard</button></div></aside>}
      {visibleLayout&&<aside className="layout-critique-card" role="status"><div className="layout-critique-copy"><strong>{visibleLayout.result.mode==='agent'?'Layout Critic Agent':'Measured layout critique'} · {visibleLayout.result.selected} proposal</strong><span>{visibleLayout.result.summary}</span><small>Score {visibleLayout.result.scores.current.score} → {visibleLayout.result.scores[visibleLayout.result.selected].score} · Checked: {visibleLayout.result.tools_used.map(tool=>tool.replaceAll('_',' ')).join(' → ')}</small></div><LayoutPreview scene={visibleLayout.scene} positions={visibleLayout.positions}/><div className="layout-critique-actions"><button className="apply-review" onClick={acceptLayout}>Apply layout</button><button onClick={()=>setLayout(null)}>Discard</button></div></aside>}
      {visibleReview&&<aside className="diagram-insight agent-review" role="status"><Sparkles size={18}/><div><strong>{scene.context.type==='mindmap'?'Mind map review':scene.context.type==='hierarchy'?'Hierarchy review':scene.context.type==='brainstorming'?'Idea review':scene.context.type==='flowchart'?'Flowchart review':scene.context.type==='mixed'?'Mixed diagram review':visibleReview.mode==='agent'?'Architecture Review Agent':'Graph review'} · {visibleReview.finding.title}</strong><span>{visibleReview.finding.message}</span><small>Checked: {visibleReview.tools.map(tool=>tool.replaceAll('_',' ')).join(' → ')}</small></div><button onClick={highlightReview}>Highlight</button>{visibleReview.finding.actions.length>0&&<button className="apply-review" onClick={acceptReview}>Apply suggestion</button>}<button onClick={()=>setReview(null)} aria-label="Dismiss diagram review">Dismiss</button></aside>}
      {visibleInsight&&<aside className="diagram-insight" role="status"><Sparkles size={18}/><div><strong>Design insight</strong><span>{visibleInsight.message}</span></div><button onClick={highlightInsight}>Highlight</button><button onClick={()=>setDismissedInsight(visibleInsight.key)} aria-label="Dismiss design insight">Dismiss</button></aside>}
      </div>
      <section className="bottom-panel editor-dock">{voice.active&&<div className="editor-voice-status" role="status"><span className={`editor-voice-dot ${voice.phase.toLowerCase()}`}/><strong>{voice.phase==='EXECUTING'?'Drawing from speech…':voice.phase==='TRANSCRIBING'?'Transcribing…':voice.phase==='SPEECH_DETECTED'?'Hearing you…':voice.phase==='CONNECTING'?'Connecting microphone…':'Listening'}</strong><span>{liveTranscript?`“${liveTranscript}”`:voice.phase==='LISTENING'?voice.detail:latest?`“${latest}”`:voice.detail}</span></div>}<div className={`activity ${activityOpen||clarification||message||saveError||storageWarning?'is-open':''} ${!activityOpen?'is-compact':''}`}><div className="activity-title"><span>COMMAND ACTIVITY</span><span>{logs.length ? `${logs.length} recent`:'Ready when you are'}</span></div>{storageWarning&&<div className="alert" role="status">{storageWarning}</div>}{saveError&&<div className="alert" role="status">Account save failed: {saveError}. Your local copy is still available.</div>}{clarification&&<div className="clarification" role="status"><strong>{message||clarification.question}</strong><span>{clarification.kind==='node'?'Say or type a node name, or say “second one”.':'Say or type the missing detail.'} Speak to interrupt the question, or say “cancel” to discard it.</span><button onClick={()=>{voiceSession.current?.interruptSpeech();setClarification(null);setMessage('Pending command cancelled.');}} aria-label="Cancel clarification">Cancel</button></div>}{message&&!clarification&&<div className="alert" role="status">{message}</div>}{latest&&<div className="transcript"><Sparkles size={15}/><span>Latest</span><strong>“{latest}”</strong></div>}<div className="log-list">{logs.length?logs.slice(0,3).map((entry,i)=><div key={`${entry.time}-${i}`} className={`log ${entry.kind}`}><span className="log-mark">{entry.kind==='error'?'!':'↳'}</span><span>{entry.text}</span><time>{entry.time}</time></div>):<div className="no-activity">Commands and edits will appear here.</div>}</div></div>
        <div className={`command-bar ${!scene.nodes.length&&!scene.extras?.length?'is-empty':''}`}><button className={`dock-voice ${voice.active?'active':''}`} onClick={voice.active?stopVoiceSession:()=>void startVoiceSession()} disabled={!voice.active&&status!=='idle'} aria-pressed={voice.active} title={voice.detail||'Hands-free voice session'}><span className="dock-voice-icon"><Mic size={18}/></span><span className="dock-voice-label">{voice.active?'Stop listening':'Start speaking'}</span><span className="dock-voice-wave" aria-hidden="true"><i/><i/><i/></span></button><span className="dock-separator"/><div className="command-input"><label htmlFor="command">{clarification?'Answer the question above':voice.active?'Voice session active · speak naturally':status==='planning'?'Planning diagram edit…':'Or type an architecture command'}</label><form onSubmit={e=>{e.preventDefault();void run(text);}}><input id="command" value={text} onChange={e=>setText(e.target.value)} placeholder={clarification?'e.g. The second service':!scene.nodes.length?'Create a frontend, a backend and a database…':'Describe a diagram change…'} disabled={status!=='idle'||voice.active}/><button disabled={!text.trim()||status!=='idle'||voice.active} aria-label="Send command"><CornerDownLeft size={18}/></button></form></div><button className={`dock-activity ${activityOpen?'active':''}`} onClick={()=>setActivityOpen(value=>!value)} aria-expanded={activityOpen} aria-label="Command activity" title="Command activity"><History size={18}/>{logs.length>0&&<span>{logs.length}</span>}</button></div>
      </section>
    </main>
  </div>;
}
