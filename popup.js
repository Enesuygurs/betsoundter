(function(){
  const bandSets = {
    10: [32,64,125,250,500,1000,2000,4000,8000,16000],
    31: [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000]
  };

  let currentBandMode = '10';
  let bands = bandSets[10];

  
  function sendToActiveTab(msg, cb){
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      const tab = tabs && tabs[0];
      if(!tab){ if(cb) cb(null); return; }
      chrome.tabs.sendMessage(tab.id, msg, resp => {
        if(chrome.runtime.lastError){
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
  const exportAllBtn = document.getElementById('exportAllBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const importUrl = document.getElementById('importUrl');
  const importUrlBtn = document.getElementById('importUrlBtn');
  

  
  const globalBandsLocal = {};
  let bandsSaveTimer = null;
  const BANDS_SAVE_DEBOUNCE_MS = 1000;

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
    
    const freqLabel = freq >= 1000 ? (freq / 1000) + 'K' : freq + ' Hz';
    label.textContent = freqLabel;
    const range = document.createElement('input');
    range.type = 'range';
    // Set full range to -40..40 per user request, keep step at 0.5
    range.min = -40; range.max = 40; range.step = 0.5;
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
    globalBandsLocal[bandIndex] = Number(gain);
    scheduleSaveBands();
    sendToActiveTab({type:'setAllBands', bandIndex, gain});
  }

  function onMasterGainChange(v){
    masterVal.textContent = Number(v).toFixed(2);
    if(typeof v !== 'number') v = Number(v);
    if(!isFinite(v)) return;
    sendToActiveTab({type:'setMasterGain', gain: Number(v)});
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
    chrome.storage.sync.set({globalBands:{}, globalMasterGain:1, globalCompressor:{}});
    for(const k in globalBandsLocal) delete globalBandsLocal[k];
    const ranges = bandsWrap.querySelectorAll('input[type=range]');
    ranges.forEach(r=>{ r.value=0; const v = r.parentElement.querySelector('.val'); if(v) v.textContent=0; });
    if(masterGainInput){ masterGainInput.value = 1; masterVal.textContent = '1.00'; }
    sendToActiveTab({type:'applyAll'});
  });

  if(bandModeSelect){
    bandModeSelect.addEventListener('change', ()=>{
      const newMode = bandModeSelect.value;
      if(newMode !== currentBandMode){
        currentBandMode = newMode;
        bands = bandSets[newMode];
        chrome.storage.sync.set({bandMode: newMode});
        populateBands(globalBandsLocal);
      }
    });
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

  tabButtons.forEach(btn => btn.addEventListener('click', ()=>{
    const tab = btn.dataset.tab;
    tabButtons.forEach(b=>b.classList.toggle('active', b===btn));
    tabContents.forEach(c=> c.classList.toggle('active', c.id === `tab-${tab}`));
  }));

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

  function renderPresets(presets){
    presetList.innerHTML = '';
    const names = Object.keys(presets || {});
    if(names.length === 0){ presetList.innerHTML = '<div class="small">No presets saved.</div>'; return; }
    names.forEach(name => {
      const p = presets[name];
      const item = document.createElement('div'); item.className = 'preset-item';
      const span = document.createElement('div'); span.className='name'; span.textContent = name;
      const actions = document.createElement('div'); actions.className='actions';
      const exportBtn = document.createElement('button'); exportBtn.textContent = 'Export';
      const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy link';
      const applyBtn = document.createElement('button'); applyBtn.textContent = 'Apply';
      const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
      exportBtn.addEventListener('click', ()=> exportPreset(name));
      copyBtn.addEventListener('click', ()=> copyPresetLink(name));
      applyBtn.addEventListener('click', ()=> applyPreset(name));
      delBtn.addEventListener('click', ()=> deletePreset(name));
      actions.appendChild(exportBtn); actions.appendChild(copyBtn); actions.appendChild(applyBtn); actions.appendChild(delBtn);
      item.appendChild(span); item.appendChild(actions);
      presetList.appendChild(item);
    });
  }

  function exportPreset(name){
    loadPresets(ps => {
      if(!ps[name]){ alert('Preset not found'); return; }
      const content = {};
      content[name] = ps[name];
      const blob = new Blob([JSON.stringify(content, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9-_ ]/ig,'') || 'preset'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  function exportAllPresets(){
    loadPresets(ps => {
      const blob = new Blob([JSON.stringify(ps, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const stamp = now.toISOString().slice(0,19).replace(/[:T]/g,'-');
      a.download = `presets-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  function importPresetsFromFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try{
        const parsed = JSON.parse(e.target.result);
        if(!parsed || typeof parsed !== 'object') throw new Error('Invalid format');
        loadPresets(existing => {
          const merged = Object.assign({}, existing);
          for(const key in parsed){
            let name = key;
            let suffix = 0;
            while(merged.hasOwnProperty(name)){
              suffix++; name = `${key} (imported${suffix>1?'-'+suffix:''})`;
            }
            merged[name] = parsed[key];
          }
          chrome.storage.sync.set({presets: merged}, ()=>{ renderPresets(merged); alert('Presets imported.'); });
        });
      }catch(err){
        alert('Failed to import presets: ' + (err && err.message ? err.message : 'Invalid file'));
      }
    };
    reader.readAsText(file);
  }

  function base64UrlEncode(str){
    const utf8 = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1){ return String.fromCharCode('0x' + p1); });
    const b64 = btoa(utf8).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return b64;
  }
  function base64UrlDecode(b64){
    b64 = b64.replace(/-/g,'+').replace(/_/g,'/');
    while(b64.length % 4) b64 += '=';
    const bin = atob(b64);
    let out = '';
    for(let i=0;i<bin.length;i++) out += '%' + ('00' + bin.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(out);
  }

  function createShareStringForPreset(name, preset){
    const obj = {};
    obj[name] = preset;
    const json = JSON.stringify(obj);
    const enc = base64UrlEncode(json);
    return `betsoundter://preset#${enc}`;
  }

  function copyTextToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(()=> alert('Link copied to clipboard')) .catch(()=> fallbackCopy(text));
    }else fallbackCopy(text);
  }
  function fallbackCopy(text){
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); alert('Link copied to clipboard'); }catch(e){ prompt('Copy the link below:', text); }
    ta.remove();
  }

  function copyPresetLink(name){
    loadPresets(ps => {
      const p = ps[name]; if(!p){ alert('Preset not found'); return; }
      const link = createShareStringForPreset(name, p);
      copyTextToClipboard(link);
    });
  }

  function importFromUrlString(s){
    if(!s || !s.trim()) return alert('Please paste a URL or encoded preset string.');
    s = s.trim();
    let candidate = s;
    try{
      if(s.startsWith('betsoundter://')){
        let tail = s.slice('betsoundter://'.length);
        const fullHash = s.indexOf('#');
        if(fullHash >= 0){ candidate = s.slice(fullHash+1); }
        else {
          if(tail.startsWith('preset/')) tail = tail.slice('preset/'.length);
          else if(tail.startsWith('preset')) tail = tail.slice('preset'.length);
          tail = tail.replace(/^\/+/, '');
          candidate = tail;
        }
      } else {
        const hashIdx = s.indexOf('#');
        if(hashIdx >= 0) candidate = s.slice(hashIdx+1);
        else{
          const qIdx = s.indexOf('?');
          if(qIdx >= 0){
            const qs = s.slice(qIdx+1).split('&');
            for(const part of qs){ if(part.startsWith('data=')){ candidate = decodeURIComponent(part.slice(5)); break; } }
          }
        }
      }
      const decoded = base64UrlDecode(candidate);
      const parsed = JSON.parse(decoded);
      if(!parsed || typeof parsed !== 'object') throw new Error('Invalid preset payload');
      loadPresets(existing => {
        const merged = Object.assign({}, existing);
        for(const key in parsed){
          let name = key;
          let suffix = 0;
          while(merged.hasOwnProperty(name)){
            suffix++; name = `${key} (imported${suffix>1?'-'+suffix:''})`;
          }
          merged[name] = parsed[key];
        }
        chrome.storage.sync.set({presets: merged}, ()=>{ renderPresets(merged); alert('Preset(s) imported from URL.'); });
      });
    }catch(err){
      alert('Failed to import from URL/encoded string: ' + (err && err.message?err.message:'invalid data'));
    }
  }

  function loadPresets(cb){
    chrome.storage.sync.get(['presets'], data => { const ps = data.presets || {}; if(cb) cb(ps); });
  }

  function savePreset(name){
    if(!name) return;
    const preset = {};
    preset.bands = {};
    for(const k in globalBandsLocal) preset.bands[k] = globalBandsLocal[k];
    preset.masterGain = masterGainInput ? Number(masterGainInput.value) : 1;
    preset.compressor = {
      threshold: compThreshold ? Number(compThreshold.value) : -12,
      ratio: compRatio ? Number(compRatio.value) : 6,
      attack: compAttack ? Number(compAttack.value) : 0.003,
      release: compRelease ? Number(compRelease.value) : 0.25
    };
    loadPresets(ps => { ps[name] = preset; chrome.storage.sync.set({presets: ps}, ()=>{ renderPresets(ps); }); });
  }

  function applyPreset(name){
    loadPresets(ps => {
      const p = ps[name]; if(!p) return;
      if(p.bands){ 
        for(const k in p.bands){ 
          globalBandsLocal[k] = Number(p.bands[k]);
          sendToActiveTab({type:'setAllBands', bandIndex: Number(k), gain: Number(p.bands[k])});
        } 
      }
      const ranges = bandsWrap.querySelectorAll('input[type=range]');
      ranges.forEach(r=>{ 
        const idx = r.dataset.band; 
        if(typeof globalBandsLocal[idx] !== 'undefined') { 
          r.value = globalBandsLocal[idx]; 
          const v = r.parentElement.querySelector('.val'); 
          if(v) v.textContent = r.value; 
        } 
      });
      scheduleSaveBands();
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

  if(exportAllBtn) exportAllBtn.addEventListener('click', ()=> exportAllPresets());
  if(importBtn && importFile){
    importBtn.addEventListener('click', ()=> importFile.click());
    importFile.addEventListener('change', (ev)=>{
      const f = ev.target.files && ev.target.files[0];
      if(f) importPresetsFromFile(f);
      importFile.value = '';
    });
  }

  if(importUrlBtn && importUrl){
    importUrlBtn.addEventListener('click', ()=>{ importFromUrlString(importUrl.value); importUrl.value = ''; });
  }

  loadPresets(ps => renderPresets(ps));

  chrome.storage.sync.get(['globalBands'], data => {
    const saved = data.globalBands || {};
    for(const k in saved) try{ globalBandsLocal[k] = Number(saved[k]); }catch(e){}
    populateBands(saved);
  });
  chrome.storage.sync.get(['globalMasterGain'], data => {
    if(typeof data.globalMasterGain !== 'undefined' && masterGainInput){ masterGainInput.value = data.globalMasterGain; masterVal.textContent = Number(data.globalMasterGain).toFixed(2); }
  });
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
