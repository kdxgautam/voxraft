export default function FinalDiagram(){
  return <div className="bc-final-board" aria-hidden="true">
    <div className="bc-final-board-top"><span>Your next canvas</span><span>Always editable</span></div>
    <div className="bc-final-prompt"><span className="bc-final-prompt-bars"><i/><i/><i/><i/></span><span>“Map a simple checkout.”</span></div>
    <svg className="bc-final-graph" viewBox="0 0 520 270" fill="none">
      <path className="bc-final-flow" d="M143 115H198M322 115H377M260 166V214" stroke="#59716d" strokeWidth="2" strokeLinecap="round"/>
      <path className="bc-final-flow" d="m191 109 7 6-7 6m179-12 7 6-7 6m-116 92-6 7 6 7" stroke="#59716d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <g className="bc-final-node bc-final-node-one"><rect x="22" y="83" width="121" height="64" rx="13" fill="#dfeaf9" stroke="#6684a1" strokeWidth="1.5"/><text x="82.5" y="120">Cart</text></g>
      <g className="bc-final-node bc-final-node-two"><path d="M260 64 322 115 260 166 198 115Z" fill="#fff0c9" stroke="#a18b58" strokeWidth="1.5"/><text x="260" y="111">Payment</text><text x="260" y="128">approved?</text></g>
      <g className="bc-final-node bc-final-node-three"><rect x="377" y="83" width="121" height="64" rx="32" fill="#dcefdc" stroke="#769c7a" strokeWidth="1.5"/><text x="437.5" y="120">Done</text></g>
      <g className="bc-final-node bc-final-node-four"><rect x="202" y="214" width="116" height="44" rx="12" fill="#eee6f6" stroke="#9987a8" strokeWidth="1.5"/><text x="260" y="241">Try again</text></g>
      <text className="bc-final-edge-label" x="347" y="103">Yes</text><text className="bc-final-edge-label" x="274" y="191">No</text>
    </svg>
    <div className="bc-final-board-bottom"><span><i/> From one sentence</span><span>to something you can share ↗</span></div>
  </div>;
}
