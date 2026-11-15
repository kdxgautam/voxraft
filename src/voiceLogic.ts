export type UtteranceTiming={speechStart:number;speechEnd:number;transcriptAt:number;mode:'stream'|'rest'};
export type CompletedUtterance = {id:string;text:string;timing?:UtteranceTiming};

export class UtteranceQueue {
  private pending:CompletedUtterance[]=[];
  private seen=new Set<string>();
  private recent=new Map<string,number>();
  private active=true;
  private running=false;
  private controller:AbortController|null=null;
  constructor(private apply:(text:string,signal:AbortSignal,timing?:UtteranceTiming)=>Promise<void>,private onRunning:(running:boolean)=>void,private onError:(error:unknown)=>void,private now:()=>number=Date.now){}
  push(event:CompletedUtterance):boolean {
    const text=event.text.trim();
    if(!this.active||!text||event.id&&this.seen.has(event.id))return false;
    const normalized=text.toLowerCase().replace(/\s+/g,' ');
    const duplicateWindow=/^(?:undo|redo)$/.test(normalized)?500:2000;
    if(!event.id&&this.now()-(this.recent.get(normalized)??-Infinity)<duplicateWindow)return false;
    if(event.id)this.seen.add(event.id);
    this.recent.set(normalized,this.now());
    this.pending.push({...event,text});
    void this.drain();
    return true;
  }
  stop(){this.active=false;this.pending=[];this.controller?.abort();}
  private async drain(){
    if(this.running)return;
    this.running=true;
    while(this.active&&this.pending.length){
      const event=this.pending.shift()!;
      this.controller=new AbortController();
      this.onRunning(true);
      try{await this.apply(event.text,this.controller.signal,event.timing);}
      catch(error){if(!this.controller.signal.aborted)this.onError(error);}
      finally{this.controller=null;this.onRunning(false);}
    }
    this.running=false;
  }
}

export class RestVad {
  private startedAt:number|null=null;
  private lastLoud=0;
  private waitingForSilence=false;
  constructor(private onStart:()=>void,private onEnd:(valid:boolean)=>void,private threshold=0.025,private silenceMs=1100,private minSpeechMs=180){}
  feed(level:number,now:number){
    if(this.waitingForSilence){
      if(level>=this.threshold)this.lastLoud=now;
      else if(now-this.lastLoud>=this.silenceMs)this.waitingForSilence=false;
      return;
    }
    if(level>=this.threshold){
      if(this.startedAt===null){this.startedAt=now;this.onStart();}
      this.lastLoud=now;
    }else if(this.startedAt!==null&&now-this.lastLoud>=this.silenceMs){
      const valid=this.lastLoud-this.startedAt>=this.minSpeechMs;
      this.startedAt=null;this.onEnd(valid);
    }
  }
  limit(){
    if(this.startedAt===null)return;
    this.startedAt=null;this.waitingForSilence=true;this.onEnd(true);
  }
  reset(){this.startedAt=null;this.lastLoud=0;this.waitingForSilence=false;}
}
