export const nodeFill=(node:{fillColor?:string})=>node.fillColor||'#ffffff';

export function nodeTextColor(fillColor?:string):string{
  const raw=fillColor?.replace(/^#/,'')||'';
  const hex=raw.length===3?raw.split('').map(part=>part+part).join(''):raw;
  if(!/^[0-9a-f]{6}$/i.test(hex))return '#19243b';
  const channels=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255)
    .map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  const luminance=channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  const dark=0.017;
  return (luminance+0.05)/(dark+0.05)>(1.05)/(luminance+0.05)?'#19243b':'#ffffff';
}
