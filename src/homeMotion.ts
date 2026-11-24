import {useEffect,useRef,useState} from 'react';

export function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const query=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  return reduced;
}

export function pointerCoordinates(clientX:number,clientY:number,left:number,top:number,width:number,height:number){
  const x=Math.max(0,Math.min(width,clientX-left));
  const y=Math.max(0,Math.min(height,clientY-top));
  return {x,y,dx:(x/Math.max(width,1)-.5)*2,dy:(y/Math.max(height,1)-.5)*2};
}

export function useHomeMotion(enabled:boolean){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=root.current;
    if(!element||!enabled)return;
    const reveal=Array.from(element.querySelectorAll<HTMLElement>('.bc-section-heading,.bc-feature-copy,.bc-use-grid article,.bc-faq,.bc-final h2,.bc-final-board'));
    const panels=Array.from(element.querySelectorAll<HTMLElement>('.bc-speech-panel,.bc-edit-panel,.bc-export-art'));
    const progress=element.querySelector<HTMLElement>('.bc-scroll-progress');
    const ribbon=element.querySelector<HTMLElement>('.bc-thought-ribbon>div');
    const demo=element.querySelector<HTMLElement>('.bc-demo-entrance');
    const demoSection=element.querySelector<HTMLElement>('.bc-demo-section');
    const hero=element.querySelector<HTMLElement>('.bc-hero');
    const pointerGlow=element.querySelector<HTMLElement>('.bc-pointer-glow');
    const heroStory=element.querySelector<HTMLElement>('.bc-hero-story');
    const skyLeft=element.querySelector<SVGSVGElement>('.bc-demo-sky-left');
    const skyRight=element.querySelector<SVGSVGElement>('.bc-demo-sky-right');
    const tracers=Array.from(element.querySelectorAll<SVGCircleElement>('.bc-demo-tracer')).flatMap(dot=>{
      const route=dot.dataset.route;
      const path=route&&dot.ownerSVGElement?.querySelector<SVGPathElement>(`.bc-demo-route-${route}`);
      if(!path)return [];
      return [{dot,path,length:path.getTotalLength(),x:Number(dot.getAttribute('cx')),y:Number(dot.getAttribute('cy'))}];
    });
    reveal.forEach(item=>item.classList.add('bc-reveal'));
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('bc-revealed');observer.unobserve(entry.target);}
    }),{threshold:.12});
    reveal.forEach(item=>observer.observe(item));
    const activity=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.classList.toggle('bc-in-view',entry.isIntersecting)),{threshold:.15});
    panels.forEach(item=>activity.observe(item));
    let frame=0;
    let pointerFrame=0;
    let pointerEvent:PointerEvent|null=null;
    const update=()=>{
      frame=0;
      const height=window.innerHeight;
      const scrollable=document.documentElement.scrollHeight-height;
      if(progress)progress.style.transform=`scaleX(${scrollable>0?window.scrollY/scrollable:0})`;
      panels.forEach(panel=>{const rect=panel.getBoundingClientRect();if(rect.bottom>0&&rect.top<height)panel.style.transform=`translateY(${Math.max(-18,Math.min(18,(rect.top-height*.4)*.045))}px)`;});
      if(ribbon){const top=ribbon.parentElement!.getBoundingClientRect().top;ribbon.style.transform=`translateX(${Math.max(-100,Math.min(100,(top-height*.5)*.16))}px)`;}
      if(demo){const rect=demo.getBoundingClientRect();const amount=Math.max(0,Math.min(1,(height-rect.top)/(height*.65)));demo.style.transform=`perspective(1400px) rotateX(${(1-amount)*5}deg) scale(${.96+amount*.04})`;}
      if(demoSection&&(skyLeft||skyRight)){
        const rect=demoSection.getBoundingClientRect();
        if(rect.bottom>0&&rect.top<height){
          const progress=Math.max(0,Math.min(1,(height-rect.top)/(rect.height+height)));
          if(skyLeft)skyLeft.style.transform=`translate3d(0,${-38+progress*76}px,0)`;
          if(skyRight)skyRight.style.transform=`translate3d(0,${38-progress*76}px,0)`;
          tracers.forEach(({dot,path,length,x,y})=>{
            const point=path.getPointAtLength(progress*length);
            dot.setAttribute('transform',`translate(${point.x-x} ${point.y-y})`);
          });
        }
      }
    };
    const schedule=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(update);};
    const updatePointer=()=>{
      pointerFrame=0;
      if(!hero||!pointerGlow||!pointerEvent)return;
      const rect=hero.getBoundingClientRect();
      const {x,y,dx,dy}=pointerCoordinates(pointerEvent.clientX,pointerEvent.clientY,rect.left,rect.top,rect.width,rect.height);
      pointerGlow.style.opacity='1';
      pointerGlow.style.transform=`translate3d(${x-180}px,${y-180}px,0)`;
      if(heroStory)heroStory.style.transform=`perspective(1100px) translate3d(${dx*8}px,${dy*5}px,0) rotateX(${-dy*1.2}deg) rotateY(${dx*1.8}deg)`;
    };
    const trackPointer=(event:PointerEvent)=>{pointerEvent=event;if(!pointerFrame)pointerFrame=requestAnimationFrame(updatePointer);};
    const resetPointer=()=>{pointerEvent=null;if(pointerGlow)pointerGlow.style.opacity='0';if(heroStory)heroStory.style.removeProperty('transform');};
    const finePointer=window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    if(finePointer)hero?.addEventListener('pointermove',trackPointer,{passive:true});
    if(finePointer)hero?.addEventListener('pointerleave',resetPointer);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);update();
    return()=>{observer.disconnect();activity.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(pointerFrame);hero?.removeEventListener('pointermove',trackPointer);hero?.removeEventListener('pointerleave',resetPointer);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);reveal.forEach(item=>item.classList.remove('bc-reveal','bc-revealed'));panels.forEach(item=>{item.style.removeProperty('transform');item.classList.remove('bc-in-view');});[ribbon,demo,progress,skyLeft,skyRight,pointerGlow,heroStory].forEach(item=>item?.style.removeProperty('transform'));pointerGlow?.style.removeProperty('opacity');tracers.forEach(({dot})=>dot.removeAttribute('transform'));};
  },[enabled]);
  return root;
}
