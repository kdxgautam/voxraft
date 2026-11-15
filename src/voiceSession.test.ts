import {afterEach,describe,expect,it,vi} from 'vitest';
import {VoiceSession,type VoiceStatus} from './voiceSession';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

function browser(){
  const stopTrack=vi.fn(),closeContext=vi.fn(async()=>{});
  const tracks=[{stop:stopTrack}];
  const sockets:FakeSocket[]=[];
  let port:{onmessage:((event:{data:{pcm:ArrayBuffer;level:number}})=>void)|null}={onmessage:null};
  class FakeSocket {
    static OPEN=1;
    readyState=1;
    bufferedAmount=0;
    onopen:(()=>void)|null=null;
    onmessage:((event:{data:string})=>void)|null=null;
    onclose:(()=>void)|null=null;
    onerror:(()=>void)|null=null;
    send=vi.fn();
    constructor(_url:string){sockets.push(this);}
    close(){this.readyState=3;this.onclose?.();}
    receive(data:object){this.onmessage?.({data:JSON.stringify(data)});}
  }
  class FakeWorklet {
    port=port;
    connect=vi.fn();disconnect=vi.fn();
    constructor(_context:unknown,_name:string){port={onmessage:null};this.port=port;}
  }
  class FakeContext {
    audioWorklet={addModule:vi.fn(async()=>{})};
    destination={};
    createMediaStreamSource(){return {connect:vi.fn(),disconnect:vi.fn()};}
    resume=vi.fn(async()=>{});
    close=closeContext;
  }
  vi.stubGlobal('window',globalThis);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>tracks}))}});
  vi.stubGlobal('AudioContext',FakeContext);
  vi.stubGlobal('AudioWorkletNode',FakeWorklet);
  vi.stubGlobal('WebSocket',FakeSocket);
  vi.stubGlobal('location',{protocol:'http:',host:'localhost:5173'});
  return {sockets,stopTrack,closeContext,getPort:()=>port};
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
describe('continuous voice session',()=>{
  it('explains when no microphone is available',async()=>{
    browser();
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>{throw new DOMException('The object can not be found here.','NotFoundError');})}});
    const statuses:VoiceStatus[]=[];
    const session=new VoiceSession({onStatus:value=>statuses.push(value),onTranscript:()=>{},onExecute:async()=>{},onError:()=>{}});
    await expect(session.start()).rejects.toThrow('No microphone was found. Connect one or use the text command box.');
    expect(statuses.at(-1)).toMatchObject({phase:'ERROR',active:false});
  });
  it('shows partial speech without executing it',async()=>{
    const fake=browser(),partials:string[]=[],applied:string[]=[];
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onPartialTranscript:text=>partials.push(text),onExecute:async text=>{applied.push(text);},onError:()=>{}});
    await session.start();
    const socket=fake.sockets[0];socket.receive({type:'ready'});
    socket.receive({type:'partial',text:'Add a'});
    expect(partials).toEqual(['Add a']);
    expect(applied).toEqual([]);
    socket.receive({type:'completed',id:'1',text:'Add a gateway'});
    await tick();
    expect(partials.at(-1)).toBe('');
    expect(applied).toEqual(['Add a gateway']);
    session.stop();
  });
  it('passes speech-to-transcript timestamps to the command',async()=>{
    const fake=browser();
    let timing:{speechStart:number;speechEnd:number;transcriptAt:number;mode:string}|undefined;
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async(_text,_signal,value)=>{timing=value;},onError:()=>{}});
    await session.start();
    fake.sockets[0].receive({type:'ready'});
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0.1}});
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0}});
    fake.sockets[0].receive({type:'completed',id:'timed',text:'Add API'});
    await tick();
    expect(timing?.mode).toBe('stream');
    expect(timing!.speechStart).toBeLessThanOrEqual(timing!.speechEnd);
    expect(timing!.speechEnd).toBeLessThanOrEqual(timing!.transcriptAt);
    session.stop();
  });
  it('joins a paused incomplete voice fragment before planning',async()=>{
    vi.useFakeTimers();
    const fake=browser(),applied:string[]=[],errors:string[]=[],partials:string[]=[];
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onPartialTranscript:value=>partials.push(value),onExecute:async value=>{applied.push(value);},onError:value=>errors.push(value)});
    await session.start();
    const socket=fake.sockets[0];socket.receive({type:'ready'});
    socket.receive({type:'completed',id:'part-1',text:'Move the'});
    expect(applied).toEqual([]);
    expect(partials.at(-1)).toBe('Move the');
    await vi.advanceTimersByTimeAsync(500);
    socket.receive({type:'completed',id:'part-2',text:'API Gateway above the database'});
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual(['Move the API Gateway above the database']);
    expect(errors).toEqual([]);
    session.stop();
  });
  it('asks for a repeat when an incomplete voice fragment has no continuation',async()=>{
    vi.useFakeTimers();
    const fake=browser(),applied:string[]=[],errors:string[]=[];
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async value=>{applied.push(value);},onError:value=>errors.push(value)});
    await session.start();
    fake.sockets[0].receive({type:'ready'});
    fake.sockets[0].receive({type:'completed',id:'part-1',text:'Move the'});
    await vi.advanceTimersByTimeAsync(4000);
    expect(applied).toEqual([]);
    expect(errors.at(-1)).toContain('repeat the full instruction');
    session.stop();
  });
  it('applies three completed segments, ignores silence/duplicates, and releases microphone on stop',async()=>{
    const fake=browser(),statuses:VoiceStatus[]=[],transcripts:string[]=[],applied:string[]=[];
    const session=new VoiceSession({onStatus:value=>statuses.push(value),onTranscript:value=>transcripts.push(value),onExecute:async value=>{applied.push(value);},onError:()=>{},getKeyTerms:()=>['Payments API']});
    await session.start();
    const socket=fake.sockets[0];socket.onopen?.();socket.receive({type:'ready'});
    expect(JSON.parse(String(socket.send.mock.calls[0][0]))).toEqual({type:'config',keyTerms:['Payments API']});
    expect(fake.getPort().onmessage).not.toBeNull();
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0}});
    socket.receive({type:'completed',id:'1',text:'Add frontend'});
    socket.receive({type:'completed',id:'1',text:'Add frontend'});
    socket.receive({type:'completed',id:'empty',text:'  '});
    socket.receive({type:'completed',id:'2',text:'Add backend'});
    socket.receive({type:'completed',id:'3',text:'Connect frontend to backend'});
    await tick();
    expect(applied).toEqual(['Add frontend','Add backend','Connect frontend to backend']);
    expect(statuses.some(status=>status.phase==='EXECUTING')).toBe(true);
    session.stop();
    expect(fake.stopTrack).toHaveBeenCalledOnce();
    expect(fake.closeContext).toHaveBeenCalledOnce();
    expect(fake.getPort().onmessage).toBeNull();
    expect(socket.readyState).toBe(3);
    expect(statuses.at(-1)?.phase).toBe('IDLE');
    expect(transcripts.filter(value=>value==='Add frontend')).toHaveLength(1);
  });
  it('reconnects the browser relay and resumes after a ready event',async()=>{
    const fake=browser(),statuses:VoiceStatus[]=[];
    const session=new VoiceSession({onStatus:value=>statuses.push(value),onTranscript:()=>{},onExecute:async()=>{},onError:()=>{}});
    await session.start();
    fake.sockets[0].close();
    expect(statuses.at(-1)?.phase).toBe('CONNECTING');
    await new Promise(resolve=>setTimeout(resolve,650));
    expect(fake.sockets).toHaveLength(2);
    fake.sockets[1].receive({type:'ready'});
    expect(statuses.at(-1)?.phase).toBe('LISTENING');
    session.stop();
  });
  it('stops when the server rejects another voice session',async()=>{
    const fake=browser(),errors:string[]=[];
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async()=>{},onError:value=>errors.push(value)});
    await session.start();
    fake.sockets[0].receive({type:'limit',message:'Voice session limit reached.'});
    expect(errors).toEqual(['Voice session limit reached.']);
    expect(fake.stopTrack).toHaveBeenCalledOnce();
    expect(fake.sockets[0].readyState).toBe(3);
  });
  it('recovers when the WebSocket never opens',async()=>{
    vi.useFakeTimers();
    const fake=browser(),statuses:VoiceStatus[]=[],errors:string[]=[];
    const session=new VoiceSession({onStatus:value=>statuses.push(value),onTranscript:()=>{},onExecute:async()=>{},onError:value=>errors.push(value)});
    await session.start();
    fake.sockets[0].readyState=0;
    await vi.advanceTimersByTimeAsync(16000);
    expect(fake.sockets[0].readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(600);
    expect(fake.sockets).toHaveLength(2);
    fake.sockets[1].readyState=0;
    await vi.advanceTimersByTimeAsync(16000+1200);
    expect(fake.sockets).toHaveLength(3);
    fake.sockets[2].readyState=0;
    await vi.advanceTimersByTimeAsync(16000);
    expect(statuses.at(-1)).toMatchObject({mode:'rest',active:true});
    expect(errors.at(-1)).toContain('REST transcription');
    session.stop();
  });
  it('stops fallback recording after 30 seconds of continuous noise',async()=>{
    vi.useFakeTimers();
    const fake=browser(),recorders:Recorder[]=[];
    class Recorder {
      state:'inactive'|'recording'='inactive';mimeType='audio/webm';
      ondataavailable:((event:{data:Blob})=>void)|null=null;
      onstop:(()=>void)|null=null;
      constructor(_stream:unknown){recorders.push(this);}
      start(){this.state='recording';}
      stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}
    }
    const fetchMock=vi.fn(async()=>({ok:true,json:async()=>({transcript:'Add database'})}));
    vi.stubGlobal('MediaRecorder',Recorder);
    vi.stubGlobal('fetch',fetchMock);
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async()=>{},onError:()=>{}});
    await session.start();
    fake.sockets[0].receive({type:'fallback'});
    const frame=(level:number)=>fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level}});
    frame(.1);
    expect(recorders).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(recorders[0].state).toBe('inactive');
    expect(fetchMock).toHaveBeenCalledOnce();
    frame(.1);frame(.1);
    expect(recorders).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1100);
    frame(0);frame(.1);
    expect(recorders).toHaveLength(2);
    session.stop();
  });
  it('passes REST fallback timing with the completed command',async()=>{
    vi.useFakeTimers();
    const fake=browser();
    class Recorder {
      state:'inactive'|'recording'='inactive';mimeType='audio/webm';
      ondataavailable:((event:{data:Blob})=>void)|null=null;
      onstop:(()=>void)|null=null;
      start(){this.state='recording';}
      stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}
    }
    vi.stubGlobal('MediaRecorder',Recorder);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({transcript:'Add Redis'})})));
    let timing:{speechStart:number;speechEnd:number;transcriptAt:number;mode:string}|undefined;
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async(_text,_signal,value)=>{timing=value;},onError:()=>{}});
    await session.start();
    fake.sockets[0].receive({type:'fallback'});
    const frame=(level:number)=>fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level}});
    frame(.1);
    await vi.advanceTimersByTimeAsync(250);
    frame(.1);
    await vi.advanceTimersByTimeAsync(1100);
    frame(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(timing?.mode).toBe('rest');
    expect(timing!.speechStart).toBeLessThanOrEqual(timing!.speechEnd);
    expect(timing!.speechEnd).toBeLessThanOrEqual(timing!.transcriptAt);
    session.stop();
  });
  it('waits through a ten-second Gnani connection and only sends audio after ready',async()=>{
    const fake=browser(),statuses:VoiceStatus[]=[];
    const session=new VoiceSession({onStatus:value=>statuses.push(value),onTranscript:()=>{},onExecute:async()=>{},onError:()=>{}});
    await session.start();
    const socket=fake.sockets[0];
    expect(statuses.at(-1)).toMatchObject({phase:'CONNECTING',active:true});
    vi.useFakeTimers();
    socket.onopen?.();
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0.1}});
    expect(socket.send).toHaveBeenCalledTimes(1); // config only; audio is unavailable until ready
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.sockets).toHaveLength(1);
    expect(statuses.at(-1)?.phase).toBe('CONNECTING');
    socket.receive({type:'ready'});
    expect(statuses.at(-1)?.phase).toBe('LISTENING');
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0.1}});
    expect(socket.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7000);
    expect(fake.sockets).toHaveLength(1);
    session.stop();
  });
  it('speaks a clarification without sending its audio back to STT',async()=>{
    const fake=browser();
    const speak=vi.fn(),cancel=vi.fn();
    class Utterance {lang='';onend:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(public text:string){}}
    vi.stubGlobal('SpeechSynthesisUtterance',Utterance);
    vi.stubGlobal('speechSynthesis',{speak,cancel});
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async()=>{},onError:()=>{}});
    await session.start();
    const socket=fake.sockets[0];socket.receive({type:'ready'});
    session.speakQuestion('Which database?');
    expect(speak).toHaveBeenCalledOnce();
    fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level:0.2}});
    expect(socket.send).not.toHaveBeenCalled();
    session.stop();
    expect(cancel).toHaveBeenCalled();
  });
  it('lets the user interrupt a spoken clarification and captures the answer',async()=>{
    const fake=browser(),speak=vi.fn(),cancel=vi.fn(),answers:string[]=[];
    class Utterance {lang='';onend:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(public text:string){}}
    vi.stubGlobal('SpeechSynthesisUtterance',Utterance);
    vi.stubGlobal('speechSynthesis',{speak,cancel});
    const session=new VoiceSession({onStatus:()=>{},onTranscript:()=>{},onExecute:async value=>{answers.push(value);},onError:()=>{}});
    await session.start();
    const socket=fake.sockets[0];socket.receive({type:'ready'});
    session.speakQuestion('Which database?');
    const speech=speak.mock.calls[0][0] as Utterance;
    const frame=(level:number)=>fake.getPort().onmessage?.({data:{pcm:new ArrayBuffer(1024),level}});
    frame(.01);
    for(let index=0;index<4;index++)frame(.08);
    expect(cancel).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    frame(.08);
    expect(cancel).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledTimes(5);
    speech.onend?.(); // A late end event must not mute the user's answer.
    frame(.08);
    expect(socket.send).toHaveBeenCalledTimes(6);
    socket.receive({type:'completed',id:'answer',text:'Backup database'});
    await tick();
    expect(answers).toEqual(['Backup database']);
    session.stop();
  });
});
