import {describe,expect,it} from 'vitest';
import {historyCommand,proposalCommand} from './controlCommands';

describe('spoken control commands',()=>{
  it('maps common history phrases without catching node or arrow edits',()=>{
    for(const phrase of ['undo','Undo that','revert the last change','take it back','go back one step','reverse the last action'])
      expect(historyCommand(phrase)?.type).toBe('UNDO');
    for(const phrase of ['redo','Redo that','do it again','reapply the last change','go forward one step'])
      expect(historyCommand(phrase)?.type).toBe('REDO');
    expect(historyCommand('undo undo')).toEqual({type:'UNDO',steps:2});
    expect(historyCommand('undo the frontend')).toBeNull();
    expect(historyCommand('reverse this arrow')).toBeNull();
    expect(historyCommand('do not undo')).toBeNull();
  });
  it('recognizes apply and discard for pending proposals',()=>{
    expect(proposalCommand('Apply design')).toEqual({verb:'apply',target:'design'});
    expect(proposalCommand('Apply shapes')).toEqual({verb:'apply',target:'design'});
    expect(proposalCommand('Discard shape suggestions')).toEqual({verb:'discard',target:'design'});
    expect(proposalCommand('accept the layout proposal')).toEqual({verb:'apply',target:'layout'});
    expect(proposalCommand('use that suggestion')).toEqual({verb:'apply',target:'current'});
    expect(proposalCommand('discard the design')).toEqual({verb:'discard',target:'design'});
    expect(proposalCommand('apply a blue color')).toBeNull();
  });
});
