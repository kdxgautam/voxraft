import {describe,expect,it} from 'vitest';
import {edgeStyle} from './edgeStyle';
import type {Edge} from './scene';

const edge=(id:string,color?:string):Edge=>({id,sourceId:'source',targetId:'target',label:'',color});

describe('edge appearance',()=>{
  it('stays neutral until a style is explicitly applied',()=>{
    expect(edgeStyle(edge('one'))).toEqual(edgeStyle(edge('two')));
    expect(edgeStyle(edge('one')).stroke).toBe('#73819b');
    expect(edgeStyle(edge('styled','#16857d'))).toEqual({stroke:'#16857d',text:'#16857d'});
  });
});
