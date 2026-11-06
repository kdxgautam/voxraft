export default function DemoBackdrop(){
  return <div className="bc-demo-backdrop" aria-hidden="true">
    <svg className="bc-demo-sky bc-demo-sky-left" viewBox="0 0 440 560" fill="none">
      <path d="M-25 102H116Q135 102 135 121V191H266Q284 191 284 209V278H407M135 191V354Q135 373 154 373H265V481H451"/>
      <path d="M-24 422H67Q86 422 86 403V354H135"/>
      <path className="bc-demo-route-left" d="M135 191V354Q135 373 154 373H265V481" stroke="none"/>
      <rect x="96" y="63" width="78" height="78" rx="19"/>
      <rect x="247" y="444" width="74" height="74" rx="18"/>
      <circle className="bc-demo-tracer" data-route="left" cx="135" cy="191" r="9"/>
    </svg>
    <svg className="bc-demo-sky bc-demo-sky-right" viewBox="0 0 440 560" fill="none">
      <path d="M-12 86H123V178H267Q286 178 286 197V303H460M123 178V344H54Q36 344 36 362V492H192Q210 492 210 474V409H450"/>
      <path d="M286 303V390Q286 409 305 409H450"/>
      <path className="bc-demo-route-top" d="M123 86V178H267Q286 178 286 197V303" stroke="none"/>
      <path className="bc-demo-route-bottom" d="M36 344V492H192Q210 492 210 474V409H450" stroke="none"/>
      <circle className="bc-demo-tracer" data-route="top" cx="123" cy="86" r="9"/>
      <rect x="247" y="265" width="78" height="78" rx="19"/>
      <rect x="171" y="370" width="78" height="78" rx="19"/>
      <circle className="bc-demo-tracer" data-route="bottom" cx="36" cy="344" r="7"/>
    </svg>
  </div>;
}
