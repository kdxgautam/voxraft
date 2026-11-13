import type { Scene } from './scene';

const common=['Frontend','API Gateway','FastAPI','PostgreSQL','Redis','Authentication Service','Order Service'];

export function keyTerms(scene:Scene):string[]{
  return [...new Set([...scene.nodes.map(node=>node.label),...(scene.groups||[]).map(group=>group.name),...(scene.containers||[]).map(container=>container.name),...common].map(term=>term.trim()).filter(term=>term.length>1&&term.length<=64))].slice(0,40);
}
