// content_script.js
// Attaches a WebAudio graph to media elements and exposes simple RPC via chrome.runtime messages

(function(){
  const bands = [
    {freq: 60, type: 'lowshelf'},
    {freq: 170, type: 'peaking'},
    {freq: 310, type: 'peaking'},
    {freq: 600, type: 'peaking'},
    {freq: 1000, type: 'peaking'},
    {freq: 3000, type: 'peaking'},
    {freq: 6000, type: 'peaking'},
    {freq: 12000, type: 'peaking'},
    {freq: 14000, type: 'peaking'},
    {freq: 16000, type: 'highshelf'}
  ];

  const ctx = (window._eqAudioContext = window._eqAudioContext || new (window.AudioContext || window.webkitAudioContext)());
  const elements = new Map(); // id -> {el, source, filters}
  let nextId = 1;

  function createFilters(){
    return bands.map(b => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
      // default Q and gain
      f.Q.value = 1;
      f.gain.value = 0;
      return f;
    });
  }

  function attach(el){
    if (elements.has(el._eqId)) return elements.get(el._eqId);
    try{
      const id = el._eqId = el._eqId || `eq-${nextId++}`;
      const source = ctx.createMediaElementSource(el);
      const filters = createFilters();
      let node = source;
      for(const f of filters){
        node.connect(f);
        node = f;
      }
      node.connect(ctx.destination);
      const record = {id, el, source, filters};
      elements.set(id, record);
      return record;
    }catch(e){
      // Some media elements (e.g., cross-origin or already-attached) may throw
      return null;
    }
  }

  function attachAllExisting(){
    const medias = Array.from(document.querySelectorAll('audio,video'));
    medias.forEach(m => attach(m));
  }

  // apply stored global band gains on newly attached elements
  function applyStoredToElement(record){
    chrome.storage.sync.get(['globalBands'], data => {
      const globalBands = data.globalBands || {};
      record.filters.forEach((f, idx) => {
        const g = Number(globalBands[idx]) || 0;
        f.gain.value = g;
      });
    });
  }

  // Observe additions
  const mo = new MutationObserver(mutations => {
    for(const m of mutations){
      for(const n of m.addedNodes){
        if(!(n instanceof Element)) continue;
        if(n.matches && (n.matches('audio') || n.matches('video'))){
          const r = attach(n);
          if(r) applyStoredToElement(r);
        }
        // also find nested
        const medias = Array.from(n.querySelectorAll && n.querySelectorAll('audio,video') || []);
        medias.forEach(m => { const r = attach(m); if(r) applyStoredToElement(r); });
      }
    }
  });

  // initial attach
  attachAllExisting();
  for(const rec of elements.values()) applyStoredToElement(rec);
  mo.observe(document.documentElement || document, {childList: true, subtree: true});

  // message handling from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if(msg && msg.type === 'getMedia'){
      const list = [];
      for(const [id, rec] of elements.entries()){
        list.push({id, tag: rec.el.tagName, src: rec.el.currentSrc || rec.el.src || null, paused: rec.el.paused});
      }
      sendResponse({media: list});
      return true;
    }

    if(msg && msg.type === 'setBand'){ // {id, bandIndex, gain}
      const rec = elements.get(msg.id);
      if(rec && rec.filters[msg.bandIndex]){
        rec.filters[msg.bandIndex].gain.value = Number(msg.gain) || 0;
        sendResponse({ok:true});
      }else sendResponse({ok:false});
      return true;
    }

    if(msg && msg.type === 'setAllBands'){ // {bandIndex, gain}
      for(const rec of elements.values()){
        if(rec.filters[msg.bandIndex]) rec.filters[msg.bandIndex].gain.value = Number(msg.gain) || 0;
      }
      sendResponse({ok:true});
      return true;
    }

    if(msg && msg.type === 'applyAll'){ // apply all stored bands
      chrome.storage.sync.get(['globalBands'], data => {
        const globalBands = data.globalBands || {};
        for(const rec of elements.values()){
          rec.filters.forEach((f, idx) => { f.gain.value = Number(globalBands[idx]) || 0; });
        }
        sendResponse({ok:true});
      });
      return true;
    }
  });

})();
