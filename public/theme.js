(() => {
  const root=document.documentElement;
  const media=matchMedia('(prefers-color-scheme: dark)');
  const preferences=['system','light','dark'];
  let preference='system';
  const error=message=>{root.dataset.themeError=message;};
  const read=value=>{
    if(value===null)return 'system';
    if(preferences.includes(value))return value;
    error('Saved theme preference is invalid; using System.');
    return 'system';
  };
  try{preference=read(localStorage.getItem('evie-theme'));}
  catch(e){error(`Theme preference could not be read: ${e.message}`);}
  const getState=()=>({preference,effective:preference==='system'?(media.matches?'dark':'light'):preference});
  const apply=()=>{
    const state=getState();
    root.dataset.theme=state.effective;
    root.dataset.themePreference=state.preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',state.effective==='dark'?'#151719':'#FFFFFF');
    window.dispatchEvent(new CustomEvent('evie-theme-change',{detail:state}));
  };
  window.evieAppearance=Object.freeze({
    getState,
    setPreference(value){
      if(!preferences.includes(value))throw new Error(`Invalid theme preference: ${value}`);
      preference=value;
      try{localStorage.setItem('evie-theme',value);delete root.dataset.themeError;}
      catch(e){error(`Theme preference could not be saved: ${e.message}`);}
      apply();
    },
  });
  media.addEventListener('change',apply);
  window.addEventListener('storage',event=>{
    if(event.key===null||event.key==='evie-theme'){
      delete root.dataset.themeError;
      preference=read(event.key===null?null:event.newValue);
      apply();
    }
  });
  apply();
})();
