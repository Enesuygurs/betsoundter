// content_script.js
// Attaches a WebAudio graph to media elements and exposes simple RPC via chrome.runtime messages

(function(){
  // 10-band equalizer frequencies requested by user
  // Using common 1/1-octave center frequencies: 32,64,125,250,500,1k,2k,4k,8k,16k
  const bands = [
    {freq: 32, type: 'lowshelf'},
    {freq: 64, type: 'peaking'},
    {freq: 125, type: 'peaking'},
    {freq: 250, type: 'peaking'},
    {freq: 500, type: 'peaking'},
    {freq: 1000, type: 'peaking'},
    {freq: 2000, type: 'peaking'},
    {freq: 4000, type: 'peaking'},
    {freq: 8000, type: 'peaking'},
    {freq: 16000, type: 'highshelf'}
  ];

  const ctx = (window._eqAudioContext = window._eqAudioContext || new (window.AudioContext || window.webkitAudioContext)());
  const elements = new Map(); // id -> {el, source, filters}
  let nextId = 1;
  // master nodes shared per page
  const master = (window._eqMasterNodes = window._eqMasterNodes || { });

  function ensureMasterNodes(){
    if(master.gain && master.compressor) return master;
    master.gain = ctx.createGain();
    master.gain.gain.value = 1.0; // default unity
    master.compressor = ctx.createDynamicsCompressor();
    // default gentle compressor settings; can be tuned via messages
    master.compressor.threshold.value = -12;
    master.compressor.knee.value = 30;
    master.compressor.ratio.value = 6;
    master.compressor.attack.value = 0.003;
    master.compressor.release.value = 0.25;
    // connect chain: filters -> master.gain -> compressor -> destination
    master.gain.connect(master.compressor);
    master.compressor.connect(ctx.destination);
    return master;
  }

  function createFilters(){
    return bands.map(b => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
      // default Q and gain. With many bands, a moderate Q provides reasonable overlap.
      f.Q.value = 1.0;
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
  // connect into the shared master chain
  const m = ensureMasterNodes();
  node.connect(m.gain);
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
    // also apply master gain and compressor settings
    chrome.storage.sync.get(['globalMasterGain','globalCompressor'], data => {
      const m = ensureMasterNodes();
      if(typeof data.globalMasterGain !== 'undefined') m.gain.gain.value = Number(data.globalMasterGain);
      if(data.globalCompressor){
        try{
          const c = data.globalCompressor;
          if(typeof c.threshold !== 'undefined') m.compressor.threshold.value = Number(c.threshold);
          if(typeof c.knee !== 'undefined') m.compressor.knee.value = Number(c.knee);
          if(typeof c.ratio !== 'undefined') m.compressor.ratio.value = Number(c.ratio);
          if(typeof c.attack !== 'undefined') m.compressor.attack.value = Number(c.attack);
          if(typeof c.release !== 'undefined') m.compressor.release.value = Number(c.release);
        }catch(e){/* ignore */}
      }
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

    if(msg && msg.type === 'setMasterGain'){
      const m = ensureMasterNodes();
      m.gain.gain.value = Number(msg.gain) || 1.0;
      sendResponse({ok:true});
      return true;
    }

    if(msg && msg.type === 'setCompressor'){ // {settings: {threshold,knee,ratio,attack,release}}
      const m = ensureMasterNodes();
      const s = msg.settings || {};
      if(typeof s.threshold !== 'undefined') m.compressor.threshold.value = Number(s.threshold);
      if(typeof s.knee !== 'undefined') m.compressor.knee.value = Number(s.knee);
      if(typeof s.ratio !== 'undefined') m.compressor.ratio.value = Number(s.ratio);
      if(typeof s.attack !== 'undefined') m.compressor.attack.value = Number(s.attack);
      if(typeof s.release !== 'undefined') m.compressor.release.value = Number(s.release);
      sendResponse({ok:true});
      return true;
    }

    if(msg && msg.type === 'applyAutoFix'){
      // apply a conservative auto-fix: lower master gain and enable compressor with limiter-like settings
      const m = ensureMasterNodes();
      // reduce gain to avoid clipping (0.5 ~= -6dB)
      m.gain.gain.value = 0.5;
      // more aggressive compressor/limiter
      m.compressor.threshold.value = -18;
      m.compressor.knee.value = 0;
      m.compressor.ratio.value = 12;
      m.compressor.attack.value = 0.001;
      m.compressor.release.value = 0.05;
      // persist these settings
      chrome.storage.sync.set({globalMasterGain: m.gain.gain.value, globalCompressor:{threshold: m.compressor.threshold.value, knee: m.compressor.knee.value, ratio: m.compressor.ratio.value, attack: m.compressor.attack.value, release: m.compressor.release.value}});
      // also apply stored band settings (in case we want to reduce harsh bands)
      chrome.storage.sync.get(['globalBands'], data => {
        const globalBands = data.globalBands || {};
        for(const rec of elements.values()){
          rec.filters.forEach((f, idx) => { f.gain.value = Number(globalBands[idx]) || 0; });
        }
        sendResponse({ok:true});
      });
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
