import {describe,expect,it} from 'vitest';
import {clearAccountStorage} from './accountStorage';

describe('account storage cleanup',()=>{
  it('removes the signed-out account only',()=>{
    const values=new Map<string,string>([
      ['bolcanvas.pending.alice.one','draft'],
      ['bolcanvas.scene.v1.alice.one','scene'],
      ['bolcanvas.logs.v1.alice.one','logs'],
      ['bolcanvas.latest.v1.alice.one','command'],
      ['bolcanvas.scene.v1.bob.one','other account'],
      ['bolcanvas.scene.v1','legacy draft'],
    ]);
    const storage={get length(){return values.size;},key:(index:number)=>[...values.keys()][index]||null,removeItem:(key:string)=>{values.delete(key);}};
    clearAccountStorage(storage,'alice');
    expect([...values.keys()]).toEqual(['bolcanvas.scene.v1.bob.one','bolcanvas.scene.v1']);
  });
});
