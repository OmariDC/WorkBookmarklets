if (!window._autoAcceptInstalled) window._autoAcceptInstalled = true;

const BUTTON_SELECTOR =
  '#agent-workspace-app .manual-queue-area button';

let obs = null;

function enable(){
  if(obs) return;
  obs=new MutationObserver(()=>{
    const b=document.querySelector(BUTTON_SELECTOR);
    if(b && !b.disabled && !b.dataset.clicked){
      setTimeout(()=>{b.click(); b.dataset.clicked="1";},500+Math.random()*1100);
    }
  });
  obs.observe(document.body,{childList:true,subtree:true});
  console.log("Auto-accept ON");
}

function disable(){
  if(obs){ obs.disconnect(); obs=null; }
  console.log("Auto-accept OFF");
}

function toggle(){ obs?disable():enable(); }

window.addEventListener("keydown",e=>{
  if(e.altKey && e.code==="KeyX"){ e.preventDefault(); toggle(); }
});

enable();
