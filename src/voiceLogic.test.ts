import {describe,expect,it} from 'vitest';
import {RestVad,UtteranceQueue} from './voiceLogic';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
describe('hands-free command ordering',()=>{
  it('runs three completed utterances in order without concurrent edits',async()=>{
    const started:string[]=[],finished:string[]=[];
    let concurrent=0,maxConcurrent=0;
    const queue=new UtteranceQueue(async(text)=>{started.push(text);concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await tick();finished.push(text);concurrent--;},()=>{},()=>{});
    queue.push({id:'1',text:'Add frontend'});queue.push({id:'2',text:'Add backend'});queue.push({id:'3',text:'Connect frontend to backend'});
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(started).toEqual(['Add frontend','Add backend','Connect frontend to backend']);
    expect(finished).toEqual(started);
    expect(maxConcurrent).toBe(1);
  });
  it('ignores silence and duplicate completed segments',async()=>{
    const done:string[]=[];
    const queue=new UtteranceQueue(async text=>{done.push(text);},()=>{},()=>{});
    expect(queue.push({id:'empty',text:'  '})).toBe(false);
    expect(queue.push({id:'segment-1',text:'Undo'})).toBe(true);
    expect(queue.push({id:'segment-1',text:'Undo'})).toBe(false);
    await tick();expect(done).toEqual(['Undo']);
  });
  it('keeps the speech timing with its queued instruction',async()=>{
    const timings:number[]=[];
    const queue=new UtteranceQueue(async(_text,_signal,timing)=>{if(timing)timings.push(timing.speechStart);},()=>{},()=>{});
    queue.push({id:'first',text:'Add API',timing:{speechStart:12,speechEnd:30,transcriptAt:45,mode:'stream'}});
    queue.push({id:'second',text:'Add database',timing:{speechStart:50,speechEnd:90,transcriptAt:110,mode:'stream'}});
    await tick();
    expect(timings).toEqual([12,50]);
  });
  it('accepts two separate undo utterances without IDs',async()=>{
    let now=1000;
    const done:string[]=[];
    const queue=new UtteranceQueue(async text=>{done.push(text);},()=>{},()=>{},()=>now);
    expect(queue.push({id:'',text:'Undo'})).toBe(true);
    now+=200;
    expect(queue.push({id:'',text:'Undo'})).toBe(false);
    now+=600;
    expect(queue.push({id:'',text:'Undo'})).toBe(true);
    await tick();
    expect(done).toEqual(['Undo','Undo']);
  });
  it('cancels the current edit and drops queued utterances',async()=>{
    const committed:string[]=[];
    const queue=new UtteranceQueue(async(text,signal)=>{await new Promise(resolve=>setTimeout(resolve,10));if(!signal.aborted)committed.push(text);},()=>{},()=>{});
    queue.push({id:'1',text:'Add frontend'});queue.push({id:'2',text:'Add backend'});queue.stop();
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(committed).toEqual([]);
  });
});
describe('REST fallback VAD',()=>{
  it('ignores silence and keeps a brief pause within one instruction',()=>{
    const events:string[]=[];const vad=new RestVad(()=>events.push('start'),valid=>events.push(`end:${valid}`));
    for(let time=0;time<1000;time+=32)vad.feed(0,time);
    expect(events).toEqual([]);
    for(let time=1000;time<1500;time+=32)vad.feed(.1,time);
    for(let time=1500;time<2100;time+=32)vad.feed(0,time);
    for(let time=2100;time<2600;time+=32)vad.feed(.1,time);
    expect(events).toEqual(['start']);
    for(let time=2600;time<3800;time+=32)vad.feed(0,time);
    expect(events).toEqual(['start','end:true']);
  });
  it('segments three separate speech turns',()=>{
    const events:string[]=[];const vad=new RestVad(()=>events.push('start'),valid=>events.push(`end:${valid}`));
    for(let turn=0;turn<3;turn++){
      const base=turn*2000;
      for(let time=base;time<base+400;time+=32)vad.feed(.1,time);
      for(let time=base+400;time<base+1600;time+=32)vad.feed(0,time);
    }
    expect(events.filter(value=>value==='end:true')).toHaveLength(3);
  });
  it('ends a capped recording and waits for quiet before recording again',()=>{
    const events:string[]=[];const vad=new RestVad(()=>events.push('start'),valid=>events.push(`end:${valid}`));
    vad.feed(.1,0);
    vad.limit();vad.limit();
    for(let time=32;time<31000;time+=32)vad.feed(.1,time);
    expect(events).toEqual(['start','end:true']);
    vad.feed(0,32200);
    vad.feed(.1,32232);
    expect(events).toEqual(['start','end:true','start']);
  });
});
