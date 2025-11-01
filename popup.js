// popup.js - UI logic to control equalizer
(function(){
  // Define two band sets
  const bandSets = {
    10: [32,64,125,250,500,1000,2000,4000,8000,16000],
    31: [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000]
  };

  let currentBandMode = '10'; // default to 10-band
  let bands = bandSets[10]; // Start with 10-band set

  // helper to send messages safely to the active tab and handle cases with no receiver
  function sendToActiveTab(msg, cb){
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      const tab = tabs && tabs[0];
      if(!tab){ if(cb) cb(null); return; }
      chrome.tabs.sendMessage(tab.id, msg, resp => {
        if(chrome.runtime.lastError){
          // no content script in tab or other error; ignore silently (avoid noisy console warnings)
          if(cb) cb(null);
        }else{
          if(cb) cb(resp);
        }
      });
    });
  }

  const mediaSelect = document.getElementById('mediaSelect');
  const bandsWrap = document.getElementById('bands');
  const masterGainInput = document.getElementById('masterGain');
  const masterVal = document.getElementById('masterVal');
  const refreshBtn = document.getElementById('refreshBtn');
  const resetBtn = document.getElementById('resetBtn');
  const bandModeSelect = document.getElementById('bandModeSelect');
  // tabs
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const tabContents = Array.from(document.querySelectorAll('.tab-content'));
  const compThreshold = document.getElementById('compThreshold');
  const compThresholdVal = document.getElementById('compThresholdVal');
  const compRatio = document.getElementById('compRatio');
  const compRatioVal = document.getElementById('compRatioVal');
  const compAttack = document.getElementById('compAttack');
  const compAttackVal = document.getElementById('compAttackVal');
  const compRelease = document.getElementById('compRelease');
  const compReleaseVal = document.getElementById('compReleaseVal');
  const presetNameInput = document.getElementById('presetName');
  const savePresetBtn = document.getElementById('savePresetBtn');
  const presetList = document.getElementById('presetList');
  

  // local cache of band gains to batch writes and avoid storage quota errors
  const globalBandsLocal = {};
  let bandsSaveTimer = null;
  const BANDS_SAVE_DEBOUNCE_MS = 1000; // wait 1s after last change to write

  function scheduleSaveBands(){
    if(bandsSaveTimer) clearTimeout(bandsSaveTimer);
    bandsSaveTimer = setTimeout(()=>{
      chrome.storage.sync.set({globalBands: globalBandsLocal});
      bandsSaveTimer = null;
    }, BANDS_SAVE_DEBOUNCE_MS);
  }

  function createBandRow(idx, freq, value){
    const div = document.createElement('div');
    div.className = 'band';
    const label = document.createElement('label');
    // Format frequency: 1000+ Hz as K (e.g., 1000 Hz = 1K, 16000 Hz = 16K)
    const freqLabel = freq >= 1000 ? (freq / 1000) + 'K' : freq + ' Hz';
    label.textContent = freqLabel;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = -12; range.max = 12; range.step = 0.5;
    range.value = value || 0;
    range.dataset.band = idx;
    const val = document.createElement('div'); val.className='val'; val.textContent = range.value;
    
    range.addEventListener('input', ()=>{ val.textContent = range.value; onBandChange(idx, range.value); });
    
    div.appendChild(label);
    div.appendChild(range);
    div.appendChild(val);
    return div;
  }

  function onBandChange(bandIndex, gain){
    // Always apply to all elements immediately
    globalBandsLocal[bandIndex] = Number(gain);
    scheduleSaveBands();
    // Always send to all tabs/elements
    sendToActiveTab({type:'setAllBands', bandIndex, gain});
  }

  // master gain change
  function onMasterGainChange(v){
    masterVal.textContent = Number(v).toFixed(2);
    // debounce master gain writes
    if(typeof v !== 'number') v = Number(v);
    if(!isFinite(v)) return;
    // update UI immediately, send to page
    sendToActiveTab({type:'setMasterGain', gain: Number(v)});
    // schedule save
    scheduleSaveMaster(Number(v));
  }

  let masterSaveTimer = null;
  const MASTER_SAVE_DEBOUNCE_MS = 800;
  function scheduleSaveMaster(value){
    if(masterSaveTimer) clearTimeout(masterSaveTimer);
    masterSaveTimer = setTimeout(()=>{
      chrome.storage.sync.set({globalMasterGain: value});
      masterSaveTimer = null;
    }, MASTER_SAVE_DEBOUNCE_MS);
  }

  function populateBands(saved){
    bandsWrap.innerHTML = '';
    for(let i=0;i<bands.length;i++){
      const v = (saved && typeof saved[i] !== 'undefined') ? saved[i] : 0;
      bandsWrap.appendChild(createBandRow(i, bands[i], v));
    }
  }

  function refreshMediaList(){
    mediaSelect.innerHTML = '';
    const optAll = document.createElement('option'); optAll.value='all'; optAll.textContent='All elements';
    mediaSelect.appendChild(optAll);
    sendToActiveTab({type:'getMedia'}, resp => {
      if(!resp || !resp.media) return;
      for(const m of resp.media){
        const o = document.createElement('option');
        o.value = m.id; o.textContent = `${m.tag} ${m.src?('- ' + (m.src.split('/').pop()||m.src)):''}`;
        mediaSelect.appendChild(o);
      }
    });
  }

  refreshBtn.addEventListener('click', ()=> refreshMediaList());
  resetBtn.addEventListener('click', ()=>{
    // reset storage & UI
    chrome.storage.sync.set({globalBands:{}, globalMasterGain:1, globalCompressor:{}});
    // clear local cache
    for(const k in globalBandsLocal) delete globalBandsLocal[k];
    const ranges = bandsWrap.querySelectorAll('input[type=range]');
    ranges.forEach(r=>{ r.value=0; const v = r.parentElement.querySelector('.val'); if(v) v.textContent=0; });
    if(masterGainInput){ masterGainInput.value = 1; masterVal.textContent = '1.00'; }
    // apply
    sendToActiveTab({type:'applyAll'});
  });

  // Band mode switcher
  if(bandModeSelect){
    bandModeSelect.addEventListener('change', ()=>{
      const newMode = bandModeSelect.value;
      if(newMode !== currentBandMode){
        currentBandMode = newMode;
        bands = bandSets[newMode];
        chrome.storage.sync.set({bandMode: newMode});
        // Reload bands UI
        populateBands(globalBandsLocal);
      }
    });
    // Load saved band mode
    chrome.storage.sync.get(['bandMode'], data => {
      if(data.bandMode && bandModeSelect){
        bandModeSelect.value = data.bandMode;
        currentBandMode = data.bandMode;
        bands = bandSets[currentBandMode];
      }
    });
  }

  if(masterGainInput){
    masterGainInput.addEventListener('input', ()=> onMasterGainChange(masterGainInput.value));
  }

  // tab switching
  tabButtons.forEach(btn => btn.addEventListener('click', ()=>{
    const tab = btn.dataset.tab;
    tabButtons.forEach(b=>b.classList.toggle('active', b===btn));
    tabContents.forEach(c=> c.classList.toggle('active', c.id === `tab-${tab}`));
  }));

  // compressor controls wiring
  function updateCompUI(){
    if(compThreshold) compThresholdVal.textContent = compThreshold.value;
    if(compRatio) compRatioVal.textContent = compRatio.value;
    if(compAttack) compAttackVal.textContent = compAttack.value;
    if(compRelease) compReleaseVal.textContent = compRelease.value;
  }
  if(compThreshold) compThreshold.addEventListener('input', ()=>{ updateCompUI(); sendToActiveTab({type:'setCompressor', settings:{threshold: Number(compThreshold.value)}}); });
  if(compRatio) compRatio.addEventListener('input', ()=>{ updateCompUI(); sendToActiveTab({type:'setCompressor', settings:{ratio: Number(compRatio.value)}}); });
  if(compAttack) compAttack.addEventListener('input', ()=>{ updateCompUI(); sendToActiveTab({type:'setCompressor', settings:{attack: Number(compAttack.value)}}); });
  if(compRelease) compRelease.addEventListener('input', ()=>{ updateCompUI(); sendToActiveTab({type:'setCompressor', settings:{release: Number(compRelease.value)}}); });

  // presets: save, apply, delete
  function renderPresets(presets){
    presetList.innerHTML = '';
    const names = Object.keys(presets || {});
    if(names.length === 0){ presetList.innerHTML = '<div class="small">No presets saved.</div>'; return; }
    names.forEach(name => {
      const p = presets[name];
      const item = document.createElement('div'); item.className = 'preset-item';
      const span = document.createElement('div'); span.className='name'; span.textContent = name;
      const actions = document.createElement('div'); actions.className='actions';
      const applyBtn = document.createElement('button'); applyBtn.textContent = 'Apply';
      const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
      applyBtn.addEventListener('click', ()=> applyPreset(name));
      delBtn.addEventListener('click', ()=> deletePreset(name));
      actions.appendChild(applyBtn); actions.appendChild(delBtn);
      item.appendChild(span); item.appendChild(actions);
      presetList.appendChild(item);
    });
  }

  function loadPresets(cb){
    chrome.storage.sync.get(['presets'], data => { const ps = data.presets || {}; if(cb) cb(ps); });
  }

  function savePreset(name){
    if(!name) return;
    // capture current settings
    const preset = {};
    preset.bands = {};
    // copy local bands cache
    for(const k in globalBandsLocal) preset.bands[k] = globalBandsLocal[k];
    // master gain
    preset.masterGain = masterGainInput ? Number(masterGainInput.value) : 1;
    // compressor UI values
    preset.compressor = {
      threshold: compThreshold ? Number(compThreshold.value) : -12,
      ratio: compRatio ? Number(compRatio.value) : 6,
      attack: compAttack ? Number(compAttack.value) : 0.003,
      release: compRelease ? Number(compRelease.value) : 0.25
    };
    // store
    loadPresets(ps => { ps[name] = preset; chrome.storage.sync.set({presets: ps}, ()=>{ renderPresets(ps); }); });
  }

  function applyPreset(name){
    loadPresets(ps => {
      const p = ps[name]; if(!p) return;
      // apply bands
      if(p.bands){ 
        for(const k in p.bands){ 
          globalBandsLocal[k] = Number(p.bands[k]);
          // Send each band change immediately
          sendToActiveTab({type:'setAllBands', bandIndex: Number(k), gain: Number(p.bands[k])});
        } 
      }
      // update UI sliders
      const ranges = bandsWrap.querySelectorAll('input[type=range]');
      ranges.forEach(r=>{ 
        const idx = r.dataset.band; 
        if(typeof globalBandsLocal[idx] !== 'undefined') { 
          r.value = globalBandsLocal[idx]; 
          const v = r.parentElement.querySelector('.val'); 
          if(v) v.textContent = r.value; 
        } 
      });
      // persist debounced
      scheduleSaveBands();
      // master & compressor
      if(p.masterGain && masterGainInput){ 
        masterGainInput.value = p.masterGain; 
        masterVal.textContent = Number(p.masterGain).toFixed(2); 
        sendToActiveTab({type:'setMasterGain', gain: p.masterGain}); 
        scheduleSaveMaster(p.masterGain); 
      }
      if(p.compressor){ 
        if(compThreshold) compThreshold.value = p.compressor.threshold; 
        if(compRatio) compRatio.value = p.compressor.ratio; 
        if(compAttack) compAttack.value = p.compressor.attack; 
        if(compRelease) compRelease.value = p.compressor.release; 
        updateCompUI(); 
        sendToActiveTab({type:'setCompressor', settings: p.compressor}); 
        chrome.storage.sync.set({globalCompressor: p.compressor}); 
      }
    });
  }

  function deletePreset(name){
    loadPresets(ps => { if(ps[name]){ delete ps[name]; chrome.storage.sync.set({presets: ps}, ()=>{ renderPresets(ps); }); } });
  }

  if(savePresetBtn){ savePresetBtn.addEventListener('click', ()=>{ const n = presetNameInput.value && presetNameInput.value.trim(); if(n) { savePreset(n); presetNameInput.value = ''; } }); }

  // load presets on init
  loadPresets(ps => renderPresets(ps));

  // (auto buttons removed) compressor values loaded below

  // init: load stored bands & refresh media
  chrome.storage.sync.get(['globalBands'], data => {
    const saved = data.globalBands || {};
    // populate local cache
    for(const k in saved) try{ globalBandsLocal[k] = Number(saved[k]); }catch(e){}
    populateBands(saved);
  });
  // load master gain stored value
  chrome.storage.sync.get(['globalMasterGain'], data => {
    if(typeof data.globalMasterGain !== 'undefined' && masterGainInput){ masterGainInput.value = data.globalMasterGain; masterVal.textContent = Number(data.globalMasterGain).toFixed(2); }
  });
  // load compressor stored values
  chrome.storage.sync.get(['globalCompressor'], data => {
    const c = data.globalCompressor || {};
    if(compThreshold && typeof c.threshold !== 'undefined') compThreshold.value = c.threshold;
    if(compRatio && typeof c.ratio !== 'undefined') compRatio.value = c.ratio;
    if(compAttack && typeof c.attack !== 'undefined') compAttack.value = c.attack;
    if(compRelease && typeof c.release !== 'undefined') compRelease.value = c.release;
    updateCompUI();
  });
  refreshMediaList();

})();
