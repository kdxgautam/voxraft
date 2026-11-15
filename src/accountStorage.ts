export function clearAccountStorage(storage:Pick<Storage,'length'|'key'|'removeItem'>,accountId:string){
  const prefixes=[
    `bolcanvas.pending.${accountId}.`,
    `bolcanvas.scene.v1.${accountId}.`,
    `bolcanvas.logs.v1.${accountId}.`,
    `bolcanvas.latest.v1.${accountId}.`,
  ];
  for(let index=storage.length-1;index>=0;index--){
    const key=storage.key(index);
    if(key&&prefixes.some(prefix=>key.startsWith(prefix)))storage.removeItem(key);
  }
}
