import {RestVad,UtteranceQueue,type UtteranceTiming} from './voiceLogic';

export type VoicePhase='IDLE'|'CONNECTING'|'LISTENING'|'SPEECH_DETECTED'|'TRANSCRIBING'|'EXECUTING'|'ERROR';
export type VoiceMode='stream'|'rest';
export type VoiceStatus={phase:VoicePhase;mode:VoiceMode;detail:string;active:boolean};
type Callbacks={onStatus:(status:VoiceStatus)=>void;onTranscript:(text:string)=>void;onPartialTranscript?:(text:string)=>void;onExecute:(text:string,signal:AbortSignal,timing?:UtteranceTiming)=>Promise<void>;onError:(message:string)=>void;getKeyTerms?:()=>string[]};

export class VoiceSession {
  // The relay can spend up to 12 seconds connecting to Gnani after it receives config.
  private static readonly READY_TIMEOUT_MS=16000;
  private static readonly FRAGMENT_WAIT_MS=4000;
  private active=false;
  private stream:MediaStream|null=null;
  private context:AudioContext|null=null;
  private source:MediaStreamAudioSourceNode|null=null;
  private worklet:AudioWorkletNode|null=null;
  private socket:WebSocket|null=null;
  private ready=false;
  private readyTimer:number|undefined;
  private reconnectTimer:number|undefined;
  private reconnects=0;
  private phase:VoicePhase='IDLE';
  private mode:VoiceMode='stream';
  private detail='';
  private lastLoud=0;
  private speechStartedAt:number|null=null;
  private pendingFragment:{text:string;timing?:UtteranceTiming}|null=null;
  private fragmentTimer:number|undefined;
  private executing=false;
  private transcribing=false;
  private queue:UtteranceQueue;
  private vad:RestVad;
  private recorder:MediaRecorder|null=null;
  private restRecordingTimer:number|undefined;
  private restUploads:Promise<void>=Promise.resolve();
  private restAbort=new AbortController();
  private restIndex=0;
  private muteUntil=0;
  private speaking=false;
  private speech:SpeechSynthesisUtterance|null=null;
  private bargeFrames:ArrayBuffer[]=[];
  private speechTimer:number|undefined;
  constructor(private callbacks:Callbacks){
    this.queue=new UtteranceQueue((text,signal,timing)=>callbacks.onExecute(text,signal,timing),running=>{this.executing=running;this.refreshPhase();},error=>callbacks.onError(error instanceof Error?error.message:String(error)));
    this.vad=new RestVad(()=>this.beginRestRecording(),valid=>this.endRestRecording(valid));
  }
  private emit(phase:VoicePhase,detail=this.detail){
    if(this.phase===phase&&this.detail===detail)return;
    this.phase=phase;this.detail=detail;
    this.callbacks.onStatus({phase,mode:this.mode,detail,active:this.active});
  }
  private refreshPhase(){
    if(!this.active)return;
    if(this.executing)this.emit('EXECUTING',this.mode==='rest'?'Applying queued command · REST fallback':'Applying queued command');
    else if(this.pendingFragment)this.emit('TRANSCRIBING','Waiting for the rest of your instruction…');
    else if(this.transcribing)this.emit('TRANSCRIBING',this.mode==='rest'?'Transcribing · REST fallback':'Gnani is transcribing');
    else if(this.mode==='stream'&&!this.ready)this.emit('CONNECTING','Connecting to Gnani… Start speaking when Listening appears.');
    else if(performance.now()-this.lastLoud<550)this.emit('SPEECH_DETECTED',this.mode==='rest'?'Speech detected · REST fallback':'Speech detected');
    else this.emit('LISTENING',this.mode==='rest'?'Listening · automatic REST fallback':'Listening for your next instruction');
  }
  async start(){
    if(this.active)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Continuous voice requires localhost or HTTPS and a browser with microphone access.');
    if(!window.AudioWorkletNode||!window.WebSocket)throw new Error('This browser does not support continuous voice capture. Use the text command box.');
    this.active=true;
    this.emit('CONNECTING','Requesting microphone access…');
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});
      if(!this.active){this.stream.getTracks().forEach(track=>track.stop());this.stream=null;return;}
      this.context=new AudioContext({sampleRate:16000});
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      if(!this.active)return;
      this.source=this.context.createMediaStreamSource(this.stream);
      this.worklet=new AudioWorkletNode(this.context,'bolcanvas-pcm');
      this.worklet.port.onmessage=event=>this.onAudio(event.data);
      this.source.connect(this.worklet);
      this.worklet.connect(this.context.destination);
      await Promise.race([this.context.resume(),new Promise((_,reject)=>window.setTimeout(()=>reject(new Error('Audio capture could not start.')),5000))]);
      if(!this.active)return;
      this.connectSocket();
    }catch(error){
      const failure=error instanceof DOMException&&error.name==='NotFoundError'
        ?new Error('No microphone was found. Connect one or use the text command box.')
        :error instanceof DOMException&&error.name==='NotAllowedError'
          ?new Error('Microphone access was denied. Allow it in your browser settings or use the text command box.')
          :error;
      this.stop();this.emit('ERROR',failure instanceof Error?failure.message:String(failure));throw failure;
    }
  }
  private connectSocket(){
    if(!this.active||this.mode==='rest')return;
    this.ready=false;
    this.refreshPhase();
    const scheme=location.protocol==='https:'?'wss':'ws';
    const socket=new WebSocket(`${scheme}://${location.host}/api/voice/stream`);
    this.socket=socket;
    this.readyTimer=window.setTimeout(()=>this.reconnectSocket('Realtime STT did not become ready.'),VoiceSession.READY_TIMEOUT_MS);
    socket.onopen=()=>{
      if(!this.active||this.socket!==socket)return;
      socket.send(JSON.stringify({type:'config',keyTerms:this.callbacks.getKeyTerms?.()||[]}));
      this.refreshPhase();
    };
    socket.onmessage=event=>{
      if(!this.active||this.socket!==socket)return;
      let data:Record<string,unknown>;
      try{data=JSON.parse(event.data);}catch{return;}
      if(data.type==='ready'){
        window.clearTimeout(this.readyTimer);this.ready=true;this.reconnects=0;this.transcribing=false;this.speechStartedAt=null;this.lastLoud=0;this.refreshPhase();
      }else if(data.type==='transcribing'){
        this.transcribing=true;this.refreshPhase();
      }else if(data.type==='partial'){
        this.callbacks.onPartialTranscript?.(String(data.text||''));
      }else if(data.type==='completed'){
        this.transcribing=false;
        this.callbacks.onPartialTranscript?.('');
        const text=String(data.text||'').trim();
        const timing=this.completedTiming(this.speechStartedAt,this.lastLoud,'stream');
        this.speechStartedAt=null;this.lastLoud=0;
        this.acceptTranscript(String(data.id||''),text,timing);
        this.refreshPhase();
      }else if(data.type==='listening'){
        this.transcribing=false;this.refreshPhase();
      }else if(data.type==='reconnecting'){
        this.ready=false;this.emit('CONNECTING','Gnani disconnected; reconnecting… Start speaking when Listening appears.');
        window.clearTimeout(this.readyTimer);
        this.readyTimer=window.setTimeout(()=>this.switchToRest('Realtime STT could not reconnect.'),VoiceSession.READY_TIMEOUT_MS);
      }else if(data.type==='fallback'){
        this.switchToRest(String(data.message||'Realtime STT unavailable.'));
      }else if(data.type==='limit'){
        this.callbacks.onError(String(data.message||'Voice session limit reached.'));
        this.stop();
      }
    };
    socket.onclose=()=>{if(this.active&&this.mode==='stream'&&this.socket===socket)this.reconnectSocket('Voice relay disconnected.');};
    socket.onerror=()=>{};
  }
  private reconnectSocket(reason:string){
    if(!this.active||this.mode==='rest')return;
    window.clearTimeout(this.readyTimer);
    this.ready=false;
    const socket=this.socket;this.socket=null;
    if(socket&&socket.readyState<2)socket.close();
    this.reconnects++;
    if(this.reconnects>2){this.switchToRest(reason);return;}
    this.emit('CONNECTING',`${reason} Reconnecting (${this.reconnects}/2)…`);
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer=window.setTimeout(()=>this.connectSocket(),this.reconnects*600);
  }
  private switchToRest(reason:string){
    if(!this.active||this.mode==='rest')return;
    this.mode='rest';this.ready=false;window.clearTimeout(this.readyTimer);window.clearTimeout(this.reconnectTimer);
    const socket=this.socket;this.socket=null;if(socket&&socket.readyState<2)socket.close();
    this.transcribing=false;this.speechStartedAt=null;this.lastLoud=0;this.vad.reset();this.callbacks.onError(`${reason} Using automatic REST transcription.`);this.refreshPhase();
  }
  private completedTiming(start:number|null,end:number,mode:VoiceMode):UtteranceTiming|undefined{
    const transcriptAt=performance.now();
    if(start===null||end<start||transcriptAt-start>30000)return undefined;
    return {speechStart:start,speechEnd:end,transcriptAt,mode};
  }
  private acceptTranscript(id:string,received:string,timing?:UtteranceTiming){
    if(!received)return;
    let text=received;
    if(this.pendingFragment){
      window.clearTimeout(this.fragmentTimer);
      const previous=this.pendingFragment;
      this.pendingFragment=null;
      if(/^(?:please\s+)?(?:add|create|make|connect|link|move|put|place|delete|remove|rename|undo|redo|clear|arrange|generate|no|actually)\b/i.test(received)){
        this.callbacks.onError(`I heard only “${previous.text}”. Please repeat that instruction.`);
      }else{
        text=`${previous.text} ${received}`;
        if(previous.timing&&timing)timing={...timing,speechStart:previous.timing.speechStart};
        else timing=previous.timing||timing;
      }
    }
    if(/^(?:(?:please\s+)?(?:add|create|make|connect|link|move|put|place|delete|remove|rename|color|colour)(?:\s+(?:the|a|an|this|that|my))?|.*\b(?:to|above|below|before|after|under|and|with|of))$/i.test(text)){
      this.pendingFragment={text,timing};
      this.callbacks.onPartialTranscript?.(text);
      this.emit('TRANSCRIBING','Waiting for the rest of your instruction…');
      this.fragmentTimer=window.setTimeout(()=>{
        if(this.pendingFragment?.text!==text)return;
        this.pendingFragment=null;this.callbacks.onPartialTranscript?.('');
        this.callbacks.onError(`I heard only “${text}”. Please repeat the full instruction.`);
        this.refreshPhase();
      },VoiceSession.FRAGMENT_WAIT_MS);
      return;
    }
    this.callbacks.onPartialTranscript?.('');
    if(this.queue.push({id,text,timing}))this.callbacks.onTranscript(text);
  }
  private onAudio(data:{pcm?:ArrayBuffer;level?:number}){
    if(!this.active||!data.pcm||data.pcm.byteLength!==1024)return;
    const level=Number(data.level)||0,now=performance.now();
    if(this.speaking){
      this.bargeFrames=level>=0.06?[...this.bargeFrames,data.pcm]:[];
      if(this.bargeFrames.length<5)return;
      const frames=this.bargeFrames;
      this.interruptSpeech();
      if(this.mode==='stream'&&this.ready&&this.socket?.readyState===WebSocket.OPEN)
        for(const frame of frames)this.socket.send(frame);
      if(this.mode==='rest')this.vad.feed(level,now);
      this.speechStartedAt=now;this.lastLoud=now;this.refreshPhase();return;
    }
    if(now<this.muteUntil)return;
    if(this.mode==='stream'&&!this.ready)return;
    if(level>=0.025&&this.speechStartedAt===null)this.speechStartedAt=now;
    if(this.mode==='stream'&&this.ready&&this.socket?.readyState===WebSocket.OPEN&&this.socket.bufferedAmount<65536)this.socket.send(data.pcm);
    if(this.mode==='rest')this.vad.feed(level,now);
    if(level>=0.025){this.lastLoud=now;if(!this.executing&&!this.transcribing&&this.phase==='LISTENING')this.refreshPhase();}
    else if(this.phase==='SPEECH_DETECTED'&&now-this.lastLoud>550)this.refreshPhase();
  }
  private beginRestRecording(){
    if(!this.active||!this.stream||this.recorder?.state==='recording')return;
    if(typeof MediaRecorder==='undefined'){this.emit('ERROR','Automatic REST fallback requires MediaRecorder.');return;}
    const recorder=new MediaRecorder(this.stream),chunks:Blob[]=[];
    let valid=false,speechStart:number|null=null,speechEnd=0;
    this.recorder=recorder;
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      if(!this.active||!chunks.length||!valid)return;
      const blob=new Blob(chunks,{type:recorder.mimeType});
      const id=`rest-${++this.restIndex}`;
      this.restUploads=this.restUploads.then(()=>this.uploadRest(blob,id,speechStart,speechEnd));
    };
    this.setRestRecordingTiming=(value,start,end)=>{valid=value;speechStart=start;speechEnd=end;};
    recorder.start();
    this.restRecordingTimer=window.setTimeout(()=>this.vad.limit(),30000);
  }
  private setRestRecordingTiming:((valid:boolean,start:number|null,end:number)=>void)|null=null;
  private endRestRecording(valid:boolean){
    window.clearTimeout(this.restRecordingTimer);
    const recorder=this.recorder;
    if(!recorder||recorder.state!=='recording')return;
    const speechStart=this.speechStartedAt,speechEnd=this.lastLoud;
    this.speechStartedAt=null;this.lastLoud=0;
    this.setRestRecordingTiming?.(valid,speechStart,speechEnd);
    recorder.stop();
    if(!this.executing)this.refreshPhase();
  }
  private async uploadRest(blob:Blob,id:string,speechStart:number|null,speechEnd:number){
    if(!this.active)return;
    this.transcribing=true;this.refreshPhase();
    try{
      const form=new FormData();form.append('audio',blob,blob.type.includes('webm')?'command.webm':blob.type.includes('mp4')?'command.m4a':'command.ogg');form.append('key_terms',JSON.stringify(this.callbacks.getKeyTerms?.()||[]));
      const response=await fetch('/api/transcribe',{method:'POST',body:form,signal:this.restAbort.signal});
      const data=await response.json();
      if(!response.ok)throw new Error(data.detail||'Transcription failed.');
      if(this.active&&String(data.transcript||'').trim()){
        this.acceptTranscript(id,String(data.transcript).trim(),this.completedTiming(speechStart,speechEnd,'rest'));
      }
    }catch(error){if(this.active&&!(error instanceof DOMException&&error.name==='AbortError'))this.callbacks.onError(error instanceof Error?error.message:String(error));}
    finally{this.transcribing=false;this.refreshPhase();}
  }
  speakQuestion(question:string){
    if(!this.active||!('speechSynthesis' in window))return;
    this.interruptSpeech();
    this.speaking=true;
    const speech=new SpeechSynthesisUtterance(question);
    this.speech=speech;
    speech.lang='en-IN';
    const finish=()=>{if(this.speech!==speech)return;window.clearTimeout(this.speechTimer);this.speech=null;this.speaking=false;this.bargeFrames=[];this.muteUntil=performance.now()+400;};
    speech.onend=speech.onerror=finish;
    this.speechTimer=window.setTimeout(()=>{this.interruptSpeech();this.muteUntil=performance.now()+400;},20000);
    try{window.speechSynthesis.speak(speech);}catch{finish();}
  }
  interruptSpeech(){
    if(!this.speaking)return;
    this.speaking=false;this.speech=null;this.bargeFrames=[];this.muteUntil=0;
    window.clearTimeout(this.speechTimer);
    window.speechSynthesis.cancel();
  }
  stop(){
    if(!this.active){this.emit('IDLE','');return;}
    this.callbacks.onPartialTranscript?.('');
    window.clearTimeout(this.fragmentTimer);this.pendingFragment=null;
    this.active=false;this.queue.stop();this.restAbort.abort();
    this.interruptSpeech();
    window.clearTimeout(this.readyTimer);window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.restRecordingTimer);
    this.vad.reset();
    if(this.recorder?.state==='recording')this.recorder.stop();
    this.recorder=null;
    const socket=this.socket;this.socket=null;
    if(socket&&socket.readyState===WebSocket.OPEN)socket.send('stop');
    if(socket&&socket.readyState<2)socket.close();
    if(this.worklet){this.worklet.port.onmessage=null;this.worklet.disconnect();}
    this.source?.disconnect();
    this.stream?.getTracks().forEach(track=>track.stop());
    void this.context?.close().catch(()=>{});
    this.stream=null;this.context=null;this.source=null;this.worklet=null;
    this.executing=false;this.transcribing=false;this.speechStartedAt=null;this.lastLoud=0;this.mode='stream';this.emit('IDLE','');
  }
}
