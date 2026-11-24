import {describe,expect,it} from 'vitest';
import {pointerCoordinates} from './homeMotion';

describe('homepage pointer motion',()=>{
  it('normalizes the pointer around the hero center and clamps it to the panel',()=>{
    expect(pointerCoordinates(300,250,100,50,400,400)).toEqual({x:200,y:200,dx:0,dy:0});
    expect(pointerCoordinates(900,-20,100,50,400,400)).toEqual({x:400,y:0,dx:1,dy:-1});
  });
});
