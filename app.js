const channels = ["A", "B", "C", "D", "E"];
const channelKeys = ["5", "6", "7", "8", "9"];
const padKeys = [
  "1", "2", "3", "4",
  "q", "w", "e", "r",
  "a", "s", "d", "f",
  "z", "x", "c", "v",
];
const audioExt = /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i;
const dbName = "pon-dash-library";
const storeName = "audioFiles";
const padColors = ["#278fea", "#44c66b", "#e44c63", "#9a6df0", "#f0a444"];

const state = {
  channelIndex: 0,
  pads: [],
  activeVoices: new Map(),
  audioReady: false,
  audioContext: null,
  masterGain: null,
  analyser: null,
  lowEq: null,
  midEq: null,
  highEq: null,
  lowPass: null,
  highPass: null,
  meterData: null,
  spectrumData: null,
  armedPadId: null,
};

const elements = {
  channelStrip: document.querySelector("#channelStrip"),
  padGrid: document.querySelector("#padGrid"),
  padTemplate: document.querySelector("#padTemplate"),
  folderButton: document.querySelector("#folderButton"),
  folderInput: document.querySelector("#folderInput"),
  stopAllButton: document.querySelector("#stopAllButton"),
  libraryStatus: document.querySelector("#libraryStatus"),
  analyzerCanvas: document.querySelector("#analyzerCanvas"),
  filterCanvas: document.querySelector("#filterCanvas"),
  peakDb: document.querySelector("#peakDb"),
  rmsDb: document.querySelector("#rmsDb"),
  masterMeter: document.querySelector("#masterMeter"),
  masterGain: document.querySelector("#masterGain"),
  masterValue: document.querySelector("#masterValue"),
  eqLow: document.querySelector("#eqLow"),
  eqMid: document.querySelector("#eqMid"),
  eqHigh: document.querySelector("#eqHigh"),
  eqLowValue: document.querySelector("#eqLowValue"),
  eqMidValue: document.querySelector("#eqMidValue"),
  eqHighValue: document.querySelector("#eqHighValue"),
  eqReset: document.querySelector("#eqReset"),
  lowPass: document.querySelector("#lowPass"),
  highPass: document.querySelector("#highPass"),
  filterValue: document.querySelector("#filterValue"),
};

init();

function init() {
  state.pads = createPadModels();
  renderChannels();
  renderPads();
  bindEvents();
  restoreLibrary();
  drawAnalyzer();
  drawFilterCurve();
  updateKnobs();
}

function createPadModels() {
  return channels.flatMap((channel, channelIndex) =>
    padKeys.map((key, padIndex) => ({
      id: `${channel}-${padIndex}`,
      channel,
      channelIndex,
      padIndex,
      key,
      fileName: "",
      displayName: "Empty",
      blob: null,
      buffer: null,
      color: padColors[(channelIndex + padIndex) % padColors.length],
    }))
  );
}

function bindEvents() {
  elements.folderButton.addEventListener("click", chooseFolder);
  elements.folderInput.addEventListener("change", event => importFiles([...event.target.files]));
  elements.stopAllButton.addEventListener("click", stopAllImmediate);
  elements.masterGain.addEventListener("input", updateMasterGain);
  elements.lowPass.addEventListener("input", updateFilter);
  elements.highPass.addEventListener("input", updateFilter);
  elements.eqLow.addEventListener("input", updateEq);
  elements.eqMid.addEventListener("input", updateEq);
  elements.eqHigh.addEventListener("input", updateEq);
  elements.eqReset.addEventListener("click", resetEq);

  window.addEventListener("keydown", event => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();

    if (key === "0") {
      event.preventDefault();
      stopAllImmediate();
      return;
    }

    const channelIndex = channelKeys.indexOf(key);
    if (channelIndex !== -1) {
      event.preventDefault();
      setChannel(channelIndex);
      return;
    }

    const padIndex = padKeys.indexOf(key);
    if (padIndex !== -1) {
      event.preventDefault();
      const pad = getVisiblePads()[padIndex];
      if (event.shiftKey) {
        stopPadImmediate(pad.id);
      } else if (event.altKey) {
        tapeStopPad(pad.id);
      } else {
        triggerPad(pad.id);
      }
    }
  });
}

async function chooseFolder() {
  if ("showDirectoryPicker" in window) {
    try {
      const directory = await window.showDirectoryPicker();
      const files = [];
      for await (const entry of directory.values()) {
        if (entry.kind === "file" && audioExt.test(entry.name)) {
          files.push(await entry.getFile());
        }
      }
      await importFiles(files);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  elements.folderInput.value = "";
  elements.folderInput.click();
}

async function importFiles(files) {
  const audioFiles = files
    .filter(file => audioExt.test(file.name) || file.type.startsWith("audio/"))
    .sort((a, b) => getFilePath(a).localeCompare(getFilePath(b), "ja"));

  if (!audioFiles.length) {
    elements.libraryStatus.textContent = "No audio files found";
    return;
  }

  stopAllImmediate();
  const assigned = audioFiles.slice(0, state.pads.length);

  state.pads.forEach((pad, index) => {
    const file = assigned[index];
    pad.fileName = file?.name || "";
    pad.displayName = file ? trimExtension(file.name) : "Empty";
    pad.blob = file || null;
    pad.buffer = null;
  });

  renderPads();
  const saved = await saveLibrary(assigned);
  elements.libraryStatus.textContent = saved
    ? `${assigned.length} 個のファイルが入ったよー！`
    : `${assigned.length} 個のファイルがロードされたよー！`;
}

function getFilePath(file) {
  return file.webkitRelativePath || file.name;
}

function trimExtension(name) {
  return name.replace(/\.[^/.]+$/, "");
}

function renderChannels() {
  elements.channelStrip.replaceChildren();
  channels.forEach((channel, index) => {
    const button = document.createElement("button");
    button.className = "channel-button";
    button.type = "button";
    button.innerHTML = `${channel}<span>${channelKeys[index]}</span>`;
    button.addEventListener("click", () => setChannel(index));
    elements.channelStrip.append(button);
  });
  syncChannelButtons();
}

function renderPads() {
  elements.padGrid.replaceChildren();
  getVisiblePads().forEach(pad => {
    const fragment = elements.padTemplate.content.cloneNode(true);
    const padNode = fragment.querySelector(".pad");
    const trigger = fragment.querySelector(".pad-trigger");
    const stopButton = fragment.querySelector(".stop-button");
    const tapeButton = fragment.querySelector(".tape-button");

    padNode.dataset.padId = pad.id;
    padNode.style.setProperty("--pad-color", pad.color);
    padNode.classList.toggle("loaded", Boolean(pad.blob));
    padNode.classList.toggle("playing", state.activeVoices.has(pad.id));
    padNode.classList.toggle("armed", state.armedPadId === pad.id);
    fragment.querySelector(".pad-key").textContent = pad.key.toUpperCase();
    fragment.querySelector(".pad-name").textContent = pad.displayName;
    fragment.querySelector(".pad-file").textContent = pad.fileName || "No file";
    trigger.addEventListener("click", () => triggerPad(pad.id));
    stopButton.addEventListener("click", event => {
      event.stopPropagation();
      stopPadImmediate(pad.id);
    });
    tapeButton.addEventListener("click", event => {
      event.stopPropagation();
      tapeStopPad(pad.id);
    });

    elements.padGrid.append(fragment);
  });
}

function syncPadState(padId) {
  const padNode = elements.padGrid.querySelector(`[data-pad-id="${padId}"]`);
  if (!padNode) return;
  padNode.classList.toggle("playing", state.activeVoices.has(padId));
  padNode.classList.toggle("armed", state.armedPadId === padId);
}

function getVisiblePads() {
  return state.pads.filter(pad => pad.channelIndex === state.channelIndex);
}

function setChannel(index) {
  state.channelIndex = index;
  syncChannelButtons();
  renderPads();
}

function syncChannelButtons() {
  [...elements.channelStrip.children].forEach((button, index) => {
    button.classList.toggle("active", index === state.channelIndex);
  });
}

async function ensureAudio() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
    state.masterGain = state.audioContext.createGain();
    state.lowEq = createBiquad("lowshelf", 120, 0.7, Number(elements.eqLow.value));
    state.midEq = createBiquad("peaking", 900, 1.1, Number(elements.eqMid.value));
    state.highEq = createBiquad("highshelf", 6200, 0.7, Number(elements.eqHigh.value));
    state.highPass = createBiquad("highpass", Number(elements.highPass.value), 0.72, 0);
    state.lowPass = createBiquad("lowpass", Number(elements.lowPass.value), 0.72, 0);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 4096;
    state.analyser.smoothingTimeConstant = 0.82;
    state.meterData = new Uint8Array(state.analyser.fftSize);
    state.spectrumData = new Uint8Array(state.analyser.frequencyBinCount);

    state.lowEq
      .connect(state.midEq)
      .connect(state.highEq)
      .connect(state.highPass)
      .connect(state.lowPass)
      .connect(state.masterGain)
      .connect(state.analyser)
      .connect(state.audioContext.destination);
    updateMasterGain();
    updateFilter();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
  state.audioReady = true;
}

function createBiquad(type, frequency, q, gain) {
  const filter = state.audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  filter.gain.value = gain;
  return filter;
}

async function triggerPad(padId) {
  const pad = state.pads.find(item => item.id === padId);
  if (!pad?.blob) {
    flashPad(padId);
    return;
  }

  await ensureAudio();
  if (!pad.buffer) {
    const arrayBuffer = await pad.blob.arrayBuffer();
    pad.buffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
  }

  stopPadImmediate(padId, false);
  const source = state.audioContext.createBufferSource();
  const gain = state.audioContext.createGain();
  source.buffer = pad.buffer;
  source.connect(gain).connect(state.lowEq);
  source.start();

  const voice = { source, gain, startedAt: state.audioContext.currentTime };
  state.activeVoices.set(padId, voice);
  state.armedPadId = padId;
  syncPadState(padId);

  source.onended = () => {
    if (state.activeVoices.get(padId) === voice) {
      state.activeVoices.delete(padId);
      syncPadState(padId);
    }
  };
}

function flashPad(padId) {
  state.armedPadId = padId;
  syncPadState(padId);
  window.setTimeout(() => {
    if (state.armedPadId === padId) {
      state.armedPadId = null;
      syncPadState(padId);
    }
  }, 140);
}

function stopPadImmediate(padId, sync = true) {
  const voice = state.activeVoices.get(padId);
  if (!voice) return;
  try {
    voice.source.stop();
  } catch {
    // Already stopped.
  }
  state.activeVoices.delete(padId);
  if (sync) syncPadState(padId);
}

function tapeStopPad(padId) {
  const voice = state.activeVoices.get(padId);
  if (!voice || !state.audioContext) return;
  const now = state.audioContext.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
  voice.source.playbackRate.cancelScheduledValues(now);
  voice.source.playbackRate.setValueAtTime(voice.source.playbackRate.value, now);
  voice.source.playbackRate.exponentialRampToValueAtTime(0.05, now + 1.1);
  window.setTimeout(() => stopPadImmediate(padId), 1120);
}

function stopAllImmediate() {
  [...state.activeVoices.keys()].forEach(padId => stopPadImmediate(padId));
}

function updateMasterGain() {
  const db = Number(elements.masterGain.value);
  elements.masterValue.textContent = `${formatSigned(db)} dB`;
  setKnobValue(elements.masterGain, -48, 6);
  if (state.masterGain) {
    state.masterGain.gain.value = dbToGain(db);
  }
}

function updateEq() {
  const low = Number(elements.eqLow.value);
  const mid = Number(elements.eqMid.value);
  const high = Number(elements.eqHigh.value);
  elements.eqLowValue.textContent = formatSigned(low);
  elements.eqMidValue.textContent = formatSigned(mid);
  elements.eqHighValue.textContent = formatSigned(high);
  if (state.lowEq) state.lowEq.gain.value = low;
  if (state.midEq) state.midEq.gain.value = mid;
  if (state.highEq) state.highEq.gain.value = high;
}

function resetEq() {
  elements.eqLow.value = "0";
  elements.eqMid.value = "0";
  elements.eqHigh.value = "0";
  updateEq();
}

function updateFilter() {
  const highPass = Number(elements.highPass.value);
  const lowPass = Math.max(Number(elements.lowPass.value), highPass + 80);
  if (lowPass !== Number(elements.lowPass.value)) {
    elements.lowPass.value = String(lowPass);
  }
  elements.filterValue.textContent = `${formatHz(highPass)} - ${formatHz(lowPass)}`;
  setKnobValue(elements.lowPass, 200, 20000, true);
  setKnobValue(elements.highPass, 20, 8000, true);
  if (state.highPass) state.highPass.frequency.value = highPass;
  if (state.lowPass) state.lowPass.frequency.value = lowPass;
  drawFilterCurve();
}

function updateKnobs() {
  updateMasterGain();
  updateEq();
  updateFilter();
}

function setKnobValue(input, min, max, logarithmic = false) {
  const value = Number(input.value);
  const ratio = logarithmic
    ? (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
    : (value - min) / (max - min);
  const clamped = Math.max(0, Math.min(1, ratio));
  const angle = -135 + clamped * 270;
  const knob = input.closest(".knob-control")?.querySelector(".knob");
  if (knob) {
    knob.style.setProperty("--needle", `${angle}deg`);
    knob.style.setProperty("--angle", `${clamped * 270}deg`);
  }
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function gainToDb(value) {
  if (value <= 0.00001) return -Infinity;
  return 20 * Math.log10(value);
}

function formatSigned(value) {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatHz(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function drawAnalyzer() {
  const canvas = elements.analyzerCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  drawAnalyzerGrid(ctx, width, height);

  if (state.analyser) {
    state.analyser.getByteFrequencyData(state.spectrumData);
    state.analyser.getByteTimeDomainData(state.meterData);
    drawSpectrum(ctx, width, height);
    updateMeter();
  } else {
    drawIdleSpectrum(ctx, width, height);
  }

  requestAnimationFrame(drawAnalyzer);
}

function drawAnalyzerGrid(ctx, width, height) {
  ctx.fillStyle = "#06090b";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 7; i += 1) {
    const y = (height / 7) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let i = 0; i < 10; i += 1) {
    const x = (width / 9) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.23)";
  ctx.font = "24px Segoe UI";
  ["0", "-12", "-24", "-36", "-48", "-60"].forEach((label, index) => {
    ctx.fillText(`${label} dB`, 16, 34 + index * 45);
  });
}

function drawSpectrum(ctx, width, height) {
  const nyquist = state.audioContext.sampleRate / 2;
  const points = [];
  for (let x = 0; x < width; x += 1) {
    const frequency = xToFrequency(x, width);
    const index = Math.min(state.spectrumData.length - 1, Math.round((frequency / nyquist) * state.spectrumData.length));
    const magnitude = state.spectrumData[index] / 255;
    const y = height - magnitude * height * 0.94;
    points.push([x, y]);
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(224,43,78,0.88)");
  gradient.addColorStop(0.45, "rgba(245,182,66,0.46)");
  gradient.addColorStop(1, "rgba(57,230,124,0.05)");

  ctx.beginPath();
  ctx.moveTo(0, height);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#f03d60";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawIdleSpectrum(ctx, width, height) {
  ctx.beginPath();
  for (let x = 0; x < width; x += 16) {
    const y = height * 0.72 + Math.sin(x / 45) * 15 + Math.sin(x / 150) * 18;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(22,185,224,0.38)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updateMeter() {
  let peak = 0;
  let squareSum = 0;
  for (const sample of state.meterData) {
    const centered = (sample - 128) / 128;
    peak = Math.max(peak, Math.abs(centered));
    squareSum += centered * centered;
  }
  const rms = Math.sqrt(squareSum / state.meterData.length);
  const peakDb = gainToDb(peak);
  const rmsDb = gainToDb(rms);
  elements.peakDb.textContent = Number.isFinite(peakDb) ? `${peakDb.toFixed(1)} dB` : "-inf dB";
  elements.rmsDb.textContent = Number.isFinite(rmsDb) ? `${rmsDb.toFixed(1)} dB` : "-inf dB";
  elements.masterMeter.style.height = `${Math.min(100, Math.max(0, (peakDb + 60) / 60 * 100))}%`;
}

function xToFrequency(x, width) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return Math.pow(10, min + (x / width) * (max - min));
}

function drawFilterCurve() {
  const canvas = elements.filterCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const lowPass = Number(elements.lowPass.value);
  const highPass = Number(elements.highPass.value);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#050806";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(57,230,124,0.12)";
  for (let i = 1; i < 6; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (height / 6) * i);
    ctx.lineTo(width, (height / 6) * i);
    ctx.stroke();
  }

  const hpX = frequencyToX(highPass, width);
  const lpX = frequencyToX(lowPass, width);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(57,230,124,0.52)");
  gradient.addColorStop(1, "rgba(57,230,124,0.03)");

  ctx.beginPath();
  ctx.moveTo(0, height - 12);
  for (let x = 0; x <= width; x += 2) {
    const hp = 1 / (1 + Math.exp(-(x - hpX) / 13));
    const lp = 1 / (1 + Math.exp((x - lpX) / 13));
    const amount = hp * lp;
    const y = height - 12 - amount * (height - 42);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height - 12);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  for (let x = 0; x <= width; x += 2) {
    const hp = 1 / (1 + Math.exp(-(x - hpX) / 13));
    const lp = 1 / (1 + Math.exp((x - lpX) / 13));
    const y = height - 12 - hp * lp * (height - 42);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#39e67c";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "20px Segoe UI";
  ctx.fillText("HP", Math.max(8, hpX - 18), height - 18);
  ctx.fillText("LP", Math.min(width - 38, lpX + 10), height - 18);
}

function frequencyToX(value, width) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return ((Math.log10(value) - min) / (max - min)) * width;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "index" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLibrary(files) {
  if (!("indexedDB" in window)) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();
      files.forEach((file, index) => {
        store.put({ index, name: file.name, type: file.type, blob: file });
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function restoreLibrary() {
  if (!("indexedDB" in window)) return;
  try {
    const db = await openDb();
    const records = await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();

    if (!records.length) return;
    records.sort((a, b) => a.index - b.index);
    records.forEach(record => {
      const pad = state.pads[record.index];
      if (!pad) return;
      pad.fileName = record.name;
      pad.displayName = trimExtension(record.name);
      pad.blob = record.blob;
      pad.buffer = null;
    });
    elements.libraryStatus.textContent = `${records.length} 個のファイルがあるよー！`;
    renderPads();
  } catch {
    elements.libraryStatus.textContent = "Library restore unavailable";
  }
}
