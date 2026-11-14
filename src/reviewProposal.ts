import {bindSelection,execute,type Scene} from './scene';

export type ReviewFinding={title:string;message:string;node_ids:string[];edge_ids:string[];actions:unknown[]};

export function applyReplicaProposal(scene:Scene,finding:ReviewFinding):Scene{
  const actions=bindSelection(finding.actions,null);
  if(actions.length!==2||actions[0].type!=='ADD_NODE'||actions[1].type!=='ADD_EDGE'
    ||actions[1].target!==actions[0].label||actions[1].source!==finding.node_ids[0])
    throw new Error('The proposal does not match an additive replica edit.');
  return execute(scene,actions);
}
