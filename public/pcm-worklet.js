class BolCanvasPcmProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.ratio=sampleRate/16000;
    this.phase=0;
    this.sum=0;
    this.count=0;
    this.frame=new Int16Array(512);
    this.frameIndex=0;
    this.level=0;
  }
  process(inputs){
    const channel=inputs[0]?.[0];
    if(!channel)return true;
    let energy=0;
    for(const sample of channel){
      energy+=sample*sample;
      this.phase+=1;
      this.sum+=sample;
      this.count+=1;
      if(this.phase>=this.ratio){
        const value=Math.max(-1,Math.min(1,this.sum/this.count));
        this.frame[this.frameIndex++]=value<0?Math.round(value*32768):Math.round(value*32767);
        this.phase-=this.ratio;
        this.sum=0;
        this.count=0;
        if(this.frameIndex===512){
          const bytes=new ArrayBuffer(1024);
          const view=new DataView(bytes);
          for(let i=0;i<512;i++)view.setInt16(i*2,this.frame[i],true);
          this.port.postMessage({pcm:bytes,level:this.level},[bytes]);
          this.frameIndex=0;
        }
      }
    }
    this.level=this.level*.7+Math.sqrt(energy/channel.length)*.3;
    return true;
  }
}
registerProcessor('bolcanvas-pcm',BolCanvasPcmProcessor);
