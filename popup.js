// popup.js - UI logic to control equalizer
(function(){
  // Use the 10-band set requested: 32,64,125,250,500,1k,2k,4k,8k,16k
  const bands = [32,64,125,250,500,1000,2000,4000,8000,16000];

  // helper to send messages safely to the active tab and handle cases with no receiver
  function sendToActiveTab(msg, cb){
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      const tab = tabs && tabs[0];
      if(!tab){ if(cb) cb(null); return; }
      chrome.tabs.sendMessage(tab.id, msg, resp => {
        if(chrome.runtime.lastError){
          // no content script in tab or other error; don't throw in popup
          console.warn('sendMessage ->', chrome.runtime.lastError.message);
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
  const autoFixBtn = document.getElementById('autoFixBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const resetBtn = document.getElementById('resetBtn');
  const applyAllBtn = document.getElementById('applyAllBtn');

  function createBandRow(idx, freq, value){
    const div = document.createElement('div');
    div.className = 'band';
    const label = document.createElement('label');
    label.textContent = freq + ' Hz';
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
    const selected = mediaSelect.value;
    // persist
    chrome.storage.sync.get(['globalBands'], data => {
      const globalBands = data.globalBands || {};
      globalBands[bandIndex] = Number(gain);
      chrome.storage.sync.set({globalBands});
    });

    // apply to either selected element or all
    if(selected === 'all'){
      // send message to active tab to update all elements
      sendToActiveTab({type:'setAllBands', bandIndex, gain});
    }else{
      sendToActiveTab({type:'setBand', id:selected, bandIndex, gain});
    }
  }

  // master gain change
  function onMasterGainChange(v){
    masterVal.textContent = Number(v).toFixed(2);
    chrome.storage.sync.set({globalMasterGain: Number(v)});
    sendToActiveTab({type:'setMasterGain', gain: Number(v)});
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
    const ranges = bandsWrap.querySelectorAll('input[type=range]');
    ranges.forEach(r=>{ r.value=0; const v = r.parentElement.querySelector('.val'); if(v) v.textContent=0; });
    if(masterGainInput){ masterGainInput.value = 1; masterVal.textContent = '1.00'; }
    // apply
    sendToActiveTab({type:'applyAll'});
  });

  applyAllBtn.addEventListener('click', ()=>{ sendToActiveTab({type:'applyAll'}); });

  if(masterGainInput){
    masterGainInput.addEventListener('input', ()=> onMasterGainChange(masterGainInput.value));
  }

  autoFixBtn.addEventListener('click', ()=>{
    // send applyAutoFix to page which also persists conservative settings
    sendToActiveTab({type:'applyAutoFix'}, resp => {
      if(resp && resp.ok){
        // update UI to reflect applied persistent values
        chrome.storage.sync.get(['globalMasterGain','globalCompressor'], data => {
          if(data.globalMasterGain && masterGainInput){ masterGainInput.value = data.globalMasterGain; masterVal.textContent = Number(data.globalMasterGain).toFixed(2); }
        });
      }
    });
  });

  // init: load stored bands & refresh media
  chrome.storage.sync.get(['globalBands'], data => {
    populateBands(data.globalBands || {});
  });
  // load master gain stored value
  chrome.storage.sync.get(['globalMasterGain'], data => {
    if(typeof data.globalMasterGain !== 'undefined' && masterGainInput){ masterGainInput.value = data.globalMasterGain; masterVal.textContent = Number(data.globalMasterGain).toFixed(2); }
  });
  refreshMediaList();

})();
