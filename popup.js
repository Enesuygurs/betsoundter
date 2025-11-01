// popup.js - UI logic to control equalizer
(function(){
  // 31-band frequencies (Hz) - match content_script
  const bands = [
    20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000
  ];

  const mediaSelect = document.getElementById('mediaSelect');
  const bandsWrap = document.getElementById('bands');
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
      chrome.tabs.query({active:true,currentWindow:true}, tabs => {
        if(!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, {type:'setAllBands', bandIndex, gain});
      });
    }else{
      chrome.tabs.query({active:true,currentWindow:true}, tabs => {
        if(!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, {type:'setBand', id:selected, bandIndex, gain});
      });
    }
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
    chrome.tabs.query({active:true,currentWindow:true}, tabs => {
      if(!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {type:'getMedia'}, resp => {
        if(!resp || !resp.media) return;
        for(const m of resp.media){
          const o = document.createElement('option');
          o.value = m.id; o.textContent = `${m.tag} ${m.src?('- ' + (m.src.split('/').pop()||m.src)):''}`;
          mediaSelect.appendChild(o);
        }
      });
    });
  }

  refreshBtn.addEventListener('click', ()=> refreshMediaList());
  resetBtn.addEventListener('click', ()=>{
    // reset storage & UI
    chrome.storage.sync.set({globalBands:{}});
    const ranges = bandsWrap.querySelectorAll('input[type=range]');
    ranges.forEach(r=>{ r.value=0; const v = r.parentElement.querySelector('.val'); if(v) v.textContent=0; });
    // apply
    chrome.tabs.query({active:true,currentWindow:true}, tabs => { if(!tabs[0]) return; chrome.tabs.sendMessage(tabs[0].id, {type:'applyAll'}); });
  });

  applyAllBtn.addEventListener('click', ()=>{
    chrome.tabs.query({active:true,currentWindow:true}, tabs => { if(!tabs[0]) return; chrome.tabs.sendMessage(tabs[0].id, {type:'applyAll'}); });
  });

  // init: load stored bands & refresh media
  chrome.storage.sync.get(['globalBands'], data => {
    populateBands(data.globalBands || {});
  });
  refreshMediaList();

})();
