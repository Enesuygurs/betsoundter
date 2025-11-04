(function(){
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
  const elements = new Map();
  let nextId = 1;
  
  const master = (window._eqMasterNodes = window._eqMasterNodes || { });

  function ensureMasterNodes(){
    if(master.gain && master.compressor) return master;
    master.gain = ctx.createGain();
  master.gain.gain.value = 1.0;
    master.compressor = ctx.createDynamicsCompressor();
    
    master.analyser = ctx.createAnalyser();
    master.analyser.fftSize = 2048;
    master.analyser.smoothingTimeConstant = 0.3;
    
    master.waveshaper = ctx.createWaveShaper();
    master.waveshaper.curve = makeSoftClipperCurve(4096, 0.5);
    master.waveshaper.oversample = '4x';
  master.compressor.threshold.value = -12;
    master.compressor.knee.value = 30;
    master.compressor.ratio.value = 6;
    master.compressor.attack.value = 0.003;
    master.compressor.release.value = 0.25;
    
    master.gain.connect(master.analyser);
    master.gain.connect(master.compressor);
    master.compressor.connect(master.waveshaper);
    master.waveshaper.connect(ctx.destination);
    return master;
  }

  function makeSoftClipperCurve(samples, amount){
    const curve = new Float32Array(samples);
    const k = typeof amount === 'number' ? amount : 0.5;
    for(let i=0;i<samples;i++){
      const x = (i * 2 / samples) - 1;
        curve[i] = (Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k)));
    }
    return curve;
  }

  
  function ensureContextRunning(){
    if(!ctx) return Promise.resolve();
    if(ctx.state === 'running') return Promise.resolve();
  return ctx.resume().catch(e => {});
  }

  function createFilters(){
    return bands.map(b => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
  f.Q.value = 1.0;
  f.gain.value = 0;
      return f;
    });
  }

  function attach(el){
    if (elements.has(el._eqId)) return elements.get(el._eqId);
    try{
      const id = el._eqId = el._eqId || `eq-${nextId++}`;
      let source = null;
      try{
          source = ctx.createMediaElementSource(el);
        }catch(e){
          try{
            if(typeof el.captureStream === 'function'){
              const stream = el.captureStream();
              source = ctx.createMediaStreamSource(stream);
              console.debug('content_script: used captureStream fallback for', el);
            }
          }catch(e2){
          }
        }

      if(!source){
        console.debug('content_script: could not create MediaElementSource for', el);
        return null;
      }

      const filters = createFilters();
      let node = source;
      for(const f of filters){
        node.connect(f);
        node = f;
      }
      
      // Ensure context is running and connect immediately
      ensureContextRunning().then(()=>{
        const m = ensureMasterNodes();
        try{ 
          node.connect(m.gain); 
          console.debug('content_script: connected node to master gain for', id);
        }catch(e){ 
          console.debug('content_script: failed to connect node to master gain', e); 
        }
      });

      const record = {id, el, source, filters};
      elements.set(id, record);
      console.debug('content_script: attached eq to element', id, el);
      return record;
    }catch(e){
      console.debug('content_script: attach threw', e, el);
      return null;
    }
  }

  function attachAllExisting(){
    const medias = Array.from(document.querySelectorAll('audio,video'));
    medias.forEach(m => attach(m));
  }

  
  function applyStoredToElement(record){
    chrome.storage.sync.get(['globalBands'], data => {
      const globalBands = data.globalBands || {};
      record.filters.forEach((f, idx) => {
        const g = Number(globalBands[idx]) || 0;
        f.gain.value = g;
      });
    });
    
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
  }catch(e){}
      }
    });
  }

  
  function autoEQApply(){
    const m = ensureMasterNodes();
    const analyser = m.analyser;
    if(!analyser) return {ok:false, reason:'no-analyser'};
    const fftSize = analyser.fftSize;
    const bins = analyser.frequencyBinCount;
    const freqPerBin = ctx.sampleRate / fftSize;
    const data = new Float32Array(bins);

    
    const frames = 6;
    const accum = new Float32Array(bins);
    for(let f=0; f<frames; f++){
      analyser.getFloatFrequencyData(data);
      for(let i=0;i<bins;i++) accum[i] += data[i];
    }
  for(let i=0;i<bins;i++) accum[i] /= frames;

    
    const bandEnergies = bands.map(b => {
      const center = b.freq;
      
      const low = center / Math.sqrt(2);
      const high = center * Math.sqrt(2);
      const lowBin = Math.max(0, Math.floor(low / freqPerBin));
      const highBin = Math.min(bins-1, Math.ceil(high / freqPerBin));
      let sum = 0; let count = 0;
      for(let i=lowBin;i<=highBin;i++){ sum += Math.pow(10, accum[i]/10); count++; }
      const avgLinear = count? sum/count : 0;
      const avgDb = avgLinear>0 ? 10*Math.log10(avgLinear) : -200;
      return avgDb;
    });

    
    const sorted = bandEnergies.slice().sort((a,b)=>a-b);
    const median = sorted[Math.floor(sorted.length/2)];
  const threshold = median + 8;
    const harshBands = [];
    bandEnergies.forEach((val, idx) => { if(val >= threshold) harshBands.push({idx, val}); });

    
    if(harshBands.length === 0){
      let maxIdx = 0; let maxVal = -Infinity;
      bandEnergies.forEach((v,i)=>{ if(v>maxVal){ maxVal=v; maxIdx=i; }});
      harshBands.push({idx:maxIdx, val:maxVal});
    }

  chrome.storage.sync.get(['globalBands'], data => {
      const globalBands = data.globalBands || {};
      for(const hb of harshBands){
        const idx = hb.idx;
        const over = Math.max(0, hb.val - median);
  const reduce = Math.min(12, 6 + Math.round(over/6)*2);
        const prev = Number(globalBands[idx]) || 0;
        const newVal = prev - reduce;
        globalBands[idx] = newVal;
        
        for(const rec of elements.values()){
          const f = rec.filters[idx];
          if(f){
            try{ f.gain.setTargetAtTime(newVal, ctx.currentTime, 0.05); }catch(e){ f.gain.value = newVal; }
          }
        }
      }
      chrome.storage.sync.set({globalBands});
    });

    return {ok:true, harshBands};
  }

  
  const mo = new MutationObserver(mutations => {
    for(const m of mutations){
      for(const n of m.addedNodes){
        if(!(n instanceof Element)) continue;
        if(n.matches && (n.matches('audio') || n.matches('video'))){
          const r = attach(n);
          if(r) applyStoredToElement(r);
        }
        
        const medias = Array.from(n.querySelectorAll && n.querySelectorAll('audio,video') || []);
        medias.forEach(m => { const r = attach(m); if(r) applyStoredToElement(r); });
      }
    }
  });

  
  // Initialize context early to prevent audio issues on page load
  ensureContextRunning().then(() => {
    console.debug('content_script: AudioContext resumed at page startup');
  }).catch(e => {
    console.debug('content_script: failed to resume AudioContext early:', e);
  });
  
  attachAllExisting();
  for(const rec of elements.values()) applyStoredToElement(rec);
  mo.observe(document.documentElement || document, {childList: true, subtree: true});

  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    
    ensureContextRunning();
    console.debug('content_script: onMessage', msg);
    
    if(msg && msg.type === 'wakeUp'){
      // Popup opened - ensure context is running and all media is connected
      ensureMasterNodes();
      attachAllExisting();
      for(const rec of elements.values()) applyStoredToElement(rec);
      sendResponse({ok:true});
      return true;
    }
    
    if(msg && msg.type === 'getMedia'){
      const list = [];
      for(const [id, rec] of elements.entries()){
        list.push({id, tag: rec.el.tagName, src: rec.el.currentSrc || rec.el.src || null, paused: rec.el.paused});
      }
      sendResponse({media: list});
      return true;
    }

  if(msg && msg.type === 'setBand'){
      const rec = elements.get(msg.id);
      if(rec && rec.filters[msg.bandIndex]){
        rec.filters[msg.bandIndex].gain.value = Number(msg.gain) || 0;
        sendResponse({ok:true});
      }else sendResponse({ok:false});
      return true;
    }

  if(msg && msg.type === 'setAllBands'){
      for(const rec of elements.values()){
        if(rec.filters[msg.bandIndex]) rec.filters[msg.bandIndex].gain.value = Number(msg.gain) || 0;
      }
      sendResponse({ok:true});
      return true;
    }

    if(msg && msg.type === 'setMasterGain'){
      const m = ensureMasterNodes();
      ensureContextRunning();
      m.gain.gain.value = Number(msg.gain) || 1.0;
      sendResponse({ok:true});
      return true;
    }

  if(msg && msg.type === 'setCompressor'){
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
      
      const m = ensureMasterNodes();
      ensureContextRunning();
      
      m.gain.gain.value = 0.5;
      
      m.compressor.threshold.value = -18;
      m.compressor.knee.value = 0;
      m.compressor.ratio.value = 12;
      m.compressor.attack.value = 0.001;
      m.compressor.release.value = 0.05;
  chrome.storage.sync.set({globalMasterGain: m.gain.gain.value, globalCompressor:{threshold: m.compressor.threshold.value, knee: m.compressor.knee.value, ratio: m.compressor.ratio.value, attack: m.compressor.attack.value, release: m.compressor.release.value}});
      
      chrome.storage.sync.get(['globalBands'], data => {
        const globalBands = data.globalBands || {};
        for(const rec of elements.values()){
          rec.filters.forEach((f, idx) => { f.gain.value = Number(globalBands[idx]) || 0; });
        }
        sendResponse({ok:true});
      });
      return true;
    }

  if(msg && msg.type === 'applyAll'){
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
