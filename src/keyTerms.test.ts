import {expect,it} from 'vitest';
import {keyTerms} from './keyTerms';
import {emptyScene,execute} from './scene';

it('includes current node names once and keeps keyword input bounded',()=>{
  const scene=execute(emptyScene(),[{type:'ADD_NODE',label:'Payments API'},{type:'ADD_NODE',label:'Redis'},{type:'CREATE_GROUP',name:'backend services',targets:['Payments API','Redis']},{type:'CREATE_CONTAINER',name:'Application tier',targets:['Payments API','Redis']}]);
  const terms=keyTerms(scene);
  expect(terms[0]).toBe('Payments API');
  expect(terms.filter(term=>term==='Redis')).toHaveLength(1);
  expect(terms).toContain('backend services');
  expect(terms).toContain('Application tier');
  expect(terms.length).toBeLessThanOrEqual(40);
});
