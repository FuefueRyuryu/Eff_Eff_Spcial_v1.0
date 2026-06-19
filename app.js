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
  selectedPadId: "A-0",
  isSeeking: false,
  librarySaveTimer: null,
  particles: Array.from({ length: 150 }, () => ({
    x: (Math.random() - 0.5) * 800,
    y: (Math.random() - 0.5) * 800,
    z: Math.random() * 800,
    speed: Math.random() * 2 + 1,
  })),
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
  waveformCanvas: document.querySelector("#waveformCanvas"),
  waveformShell: document.querySelector("#waveformShell"),
  playheadHandle: document.querySelector("#playheadHandle"),
  selectedPadName: document.querySelector("#selectedPadName"),
  selectedPadTime: document.querySelector("#selectedPadTime"),
  filterCanvas: document.querySelector("#filterCanvas"),
  peakDb: document.querySelector("#peakDb"),
  rmsDb: document.querySelector("#rmsDb"),
  masterMeter: document.querySelector("#masterMeter"),
  masterGain: document.querySelector("#masterGain"),
  masterValue: document.querySelector("#masterValue"),
  selectedPadGain: document.querySelector("#selectedPadGain"),
  selectedPadGainValue: document.querySelector("#selectedPadGainValue"),
  padGainReset: document.querySelector("#padGainReset"),
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
  visualizerCanvas: document.querySelector("#visualizerCanvas"),
  visualizerShell: document.querySelector("#visualizerShell"),
  gifInput: document.querySelector("#gifInput"),
  customGif: document.querySelector("#customGif"),
};

init();

//根源
function init() {
  state.pads = createPadModels();
  renderChannels();
  renderPads();
  bindEvents();
  restoreLibrary();
  drawAnalyzer();
  drawWaveform();
  drawVisualizer();
  drawFilterCurve();
  updateKnobs();
  updateSelectedPadPanel();
}

//Pad作成だぞごるぁ
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
      gainDb: 0,
      replayLock: false,
      cursorTime: 0,
      color: padColors[(channelIndex + padIndex) % padColors.length],
    }))
  );
}

//イベントバインド
function bindEvents() {
  elements.folderButton.addEventListener("click", chooseFolder);
  elements.folderInput.addEventListener("change", event => importFiles([...event.target.files]));
  elements.stopAllButton.addEventListener("click", stopAllImmediate);
  elements.masterGain.addEventListener("input", updateMasterGain);
  elements.selectedPadGain.addEventListener("input", updateSelectedPadGain);
  elements.padGainReset.addEventListener("click", resetPadVolumes);
  elements.lowPass.addEventListener("input", updateFilter);
  elements.highPass.addEventListener("input", updateFilter);
  elements.eqLow.addEventListener("input", updateEq);
  elements.eqMid.addEventListener("input", updateEq);
  elements.eqHigh.addEventListener("input", updateEq);
  elements.eqReset.addEventListener("click", resetEq);
  elements.waveformShell.addEventListener("pointerdown", beginWaveSeek);
  if (elements.visualizerShell && elements.gifInput) {
    elements.visualizerShell.addEventListener("click", () => elements.gifInput.click());
    elements.gifInput.addEventListener("change", handleGifUpload);
  }
  bindFineKnobs();

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


//フォルダ選択画面じゃけん
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

//ファイルインポートじゃんね♡
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
  selectPad(state.pads[0]?.id || state.selectedPadId);
  const saved = await saveLibrary();
  elements.libraryStatus.textContent = saved
    ? `${assigned.length} files loaded and saved`
    : `${assigned.length} files loaded`;
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

//Pad描画するぞい
function renderPads() {
  elements.padGrid.replaceChildren();
  getVisiblePads().forEach(pad => {
    const fragment = elements.padTemplate.content.cloneNode(true);
    const padNode = fragment.querySelector(".pad");
    const trigger = fragment.querySelector(".pad-trigger");
    const stopButton = fragment.querySelector(".stop-button");
    const tapeButton = fragment.querySelector(".tape-button");
    const lockButton = fragment.querySelector(".lock-button");

    padNode.dataset.padId = pad.id;
    padNode.style.setProperty("--pad-color", pad.color);
    padNode.classList.toggle("loaded", Boolean(pad.blob));
    padNode.classList.toggle("playing", state.activeVoices.has(pad.id));
    padNode.classList.toggle("armed", state.armedPadId === pad.id);
    padNode.classList.toggle("selected", state.selectedPadId === pad.id);
    padNode.classList.toggle("locked", pad.replayLock);
    fragment.querySelector(".pad-key").textContent = pad.key.toUpperCase();
    fragment.querySelector(".pad-name").textContent = pad.displayName;
    fragment.querySelector(".pad-file").textContent = pad.fileName || "No file";
    trigger.addEventListener("click", () => triggerPad(pad.id));
    lockButton.classList.toggle("active", pad.replayLock);
    lockButton.addEventListener("click", event => {
      event.stopPropagation();
      toggleReplayLock(pad.id);
    });
    stopButton.addEventListener("click", event => {
      event.stopPropagation();
      selectPad(pad.id);
      stopPadImmediate(pad.id);
    });
    tapeButton.addEventListener("click", event => {
      event.stopPropagation();
      selectPad(pad.id);
      tapeStopPad(pad.id);
    });

    elements.padGrid.append(fragment);
  });
}

//Pad状態同期
function syncPadState(padId) {
  const padNode = elements.padGrid.querySelector(`[data-pad-id="${padId}"]`);
  if (!padNode) return;
  padNode.classList.toggle("playing", state.activeVoices.has(padId));
  padNode.classList.toggle("armed", state.armedPadId === padId);
  padNode.classList.toggle("selected", state.selectedPadId === padId);
  const pad = state.pads.find(item => item.id === padId);
  if (pad) {
    padNode.classList.toggle("locked", pad.replayLock);
    padNode.querySelector(".lock-button")?.classList.toggle("active", pad.replayLock);
  }
}

function getVisiblePads() {
  return state.pads.filter(pad => pad.channelIndex === state.channelIndex);
}

function setChannel(index) {
  state.channelIndex = index;
  syncChannelButtons();
  renderPads();
}

function selectPad(padId) {
  const previousPadId = state.selectedPadId;
  state.selectedPadId = padId;
  if (previousPadId) syncPadState(previousPadId);
  syncPadState(padId);
  updateSelectedPadPanel();
  prepareSelectedWaveform();
}

function syncChannelButtons() {
  [...elements.channelStrip.children].forEach((button, index) => {
    button.classList.toggle("active", index === state.channelIndex);
  });
}

function getSelectedPad() {
  return state.pads.find(pad => pad.id === state.selectedPadId) || state.pads[0];
}

function updateSelectedPadPanel() {
  const pad = getSelectedPad();
  if (!pad) return;
  elements.selectedPadName.textContent = `${pad.channel}-${pad.padIndex + 1} ${pad.displayName}`;
  elements.selectedPadGain.value = String(pad.gainDb);
  elements.selectedPadTime.textContent = formatTime(getPadPlaybackTime(pad), pad.buffer?.duration || 0);
  updateSelectedPadGain(false);
}

async function prepareSelectedWaveform() {
  const pad = getSelectedPad();
  if (!pad?.blob || pad.buffer) return;
  try {
    await ensureAudio();
    await decodePadBuffer(pad);
  } catch {
    // The waveform stays in its unloaded state if decoding is not available yet.
  }
}

async function decodePadBuffer(pad) {
  if (pad.buffer || !pad.blob) return;
  const arrayBuffer = await pad.blob.arrayBuffer();
  pad.buffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
}

function getPadPlaybackTime(pad) {
  const voice = state.activeVoices.get(pad.id);
  if (voice && state.audioContext) {
    return Math.min(pad.buffer?.duration || 0, voice.offset + state.audioContext.currentTime - voice.startedAt);
  }
  return Math.min(pad.cursorTime || 0, pad.buffer?.duration || 0);
}

function toggleReplayLock(padId) {
  const pad = state.pads.find(item => item.id === padId);
  if (!pad) return;
  selectPad(padId);
  pad.replayLock = !pad.replayLock;
  syncPadState(padId);
  scheduleLibrarySave();
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

async function triggerPad(padId, options = {}) {
  const pad = state.pads.find(item => item.id === padId);
  selectPad(padId);
  if (pad?.replayLock && state.activeVoices.has(padId) && !options.forceRestart) {
    return;
  }
  if (!pad?.blob) {
    flashPad(padId);
    return;
  }

  await ensureAudio();
  await decodePadBuffer(pad);

  stopPadImmediate(padId, false, false);
  const source = state.audioContext.createBufferSource();
  const gain = state.audioContext.createGain();
  const requestedOffset = options.seek ?? pad.cursorTime ?? 0;
  const startOffset = Math.min(requestedOffset, Math.max(0, pad.buffer.duration - 0.01));
  pad.cursorTime = startOffset;
  source.buffer = pad.buffer;
  gain.gain.value = dbToGain(pad.gainDb);
  source.connect(gain).connect(state.lowEq);
  source.start(0, startOffset);

  const voice = { source, gain, startedAt: state.audioContext.currentTime, offset: startOffset };
  state.activeVoices.set(padId, voice);
  state.armedPadId = padId;
  syncPadState(padId);

  source.onended = () => {
    if (state.activeVoices.get(padId) === voice) {
      state.activeVoices.delete(padId);
      pad.cursorTime = 0;
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

//Pad停止
function stopPadImmediate(padId, sync = true, resetCursor = true) {
  const voice = state.activeVoices.get(padId);
  const pad = state.pads.find(item => item.id === padId);
  if (!voice) {
    if (pad && resetCursor) pad.cursorTime = 0;
    return;
  }
  try {
    voice.source.stop();
  } catch {
    // Already stopped.
  }
  state.activeVoices.delete(padId);
  if (pad && resetCursor) pad.cursorTime = 0;
  if (sync) syncPadState(padId);
}

//にゅわーんってとまるやつ
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

//ぶちあげいん
function updateSelectedPadGain(shouldSave = true) {
  const pad = getSelectedPad();
  if (!pad) return;
  const db = Number(elements.selectedPadGain.value);
  pad.gainDb = db;
  elements.selectedPadGainValue.textContent = `${formatSigned(db)} dB`;
  setKnobValue(elements.selectedPadGain, -48, 6);
  const voice = state.activeVoices.get(pad.id);
  if (voice) {
    voice.gain.gain.cancelScheduledValues(state.audioContext.currentTime);
    voice.gain.gain.setValueAtTime(dbToGain(db), state.audioContext.currentTime);
  }
  if (shouldSave) scheduleLibrarySave();
}

function updateEq() {
  const low = Number(elements.eqLow.value);
  const mid = Number(elements.eqMid.value);
  const high = Number(elements.eqHigh.value);
  elements.eqLowValue.textContent = formatSigned(low);
  elements.eqMidValue.textContent = formatSigned(mid);
  elements.eqHighValue.textContent = formatSigned(high);
  setKnobValue(elements.eqLow, -18, 18);
  setKnobValue(elements.eqMid, -18, 18);
  setKnobValue(elements.eqHigh, -18, 18);
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

function resetPadVolumes() {
  state.pads.forEach(pad => {
    pad.gainDb = 0;
    const voice = state.activeVoices.get(pad.id);
    if (voice && state.audioContext) {
      voice.gain.gain.cancelScheduledValues(state.audioContext.currentTime);
      voice.gain.gain.setValueAtTime(1, state.audioContext.currentTime);
    }
  });
  elements.selectedPadGain.value = "0";
  updateSelectedPadGain(false);
  scheduleLibrarySave();
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
  updateSelectedPadGain(false);
  updateEq();
  updateFilter();
}

function bindFineKnobs() {
  document.querySelectorAll(".fine-knob").forEach(control => {
    const input = control.querySelector("input");
    const knob = control.querySelector(".knob");
    if (!input || !knob) return;

    knob.addEventListener("pointerdown", event => {
      event.preventDefault();
      knob.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startValue = Number(input.value);
      const min = Number(input.min);
      const max = Number(input.max);
      const sensitivity = input.id === "lowPass" || input.id === "highPass" ? 0.0012 : 0.0024;

      const move = moveEvent => {
        const range = max - min;
        const nextValue = startValue - (moveEvent.clientY - startY) * range * sensitivity;
        input.value = clampToStep(nextValue, min, max, Number(input.step) || 0.1);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };

      const end = endEvent => {
        knob.releasePointerCapture(endEvent.pointerId);
        knob.removeEventListener("pointermove", move);
      };

      knob.addEventListener("pointermove", move);
      knob.addEventListener("pointerup", end, { once: true });
      knob.addEventListener("pointercancel", end, { once: true });
    });

    knob.addEventListener("wheel", event => {
      event.preventDefault();
      const min = Number(input.min);
      const max = Number(input.max);
      const step = Number(input.step) || 0.1;
      const multiplier = input.id === "lowPass" || input.id === "highPass" ? 8 : 1;
      const direction = event.deltaY > 0 ? -1 : 1;
      input.value = clampToStep(Number(input.value) + direction * step * multiplier, min, max, step);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, { passive: false });
  });
}

function clampToStep(value, min, max, step) {
  const clamped = Math.max(min, Math.min(max, value));
  const stepped = Math.round(clamped / step) * step;
  return stepped.toFixed(step < 1 ? 1 : 0);
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

function formatTime(current, duration) {
  const currentText = formatSingleTime(current);
  if (!duration) return currentText;
  return `${currentText} / ${formatSingleTime(duration)}`;
}

function formatSingleTime(value) {
  const safeValue = Math.max(0, value || 0);
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, "0");
  const millis = Math.floor((safeValue % 1) * 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

function beginWaveSeek(event) {
  const pad = getSelectedPad();
  if (!pad?.buffer) return;
  state.isSeeking = true;
  elements.waveformShell.setPointerCapture(event.pointerId);
  seekSelectedPad(event);
  elements.waveformShell.addEventListener("pointermove", seekSelectedPad);
  elements.waveformShell.addEventListener("pointerup", endWaveSeek, { once: true });
  elements.waveformShell.addEventListener("pointercancel", endWaveSeek, { once: true });
}

function seekSelectedPad(event) {
  const pad = getSelectedPad();
  if (!pad?.buffer) return;
  const rect = elements.waveformShell.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  pad.cursorTime = ratio * pad.buffer.duration;
  updatePlayheadPosition(pad);
}

function endWaveSeek(event) {
  elements.waveformShell.releasePointerCapture(event.pointerId);
  elements.waveformShell.removeEventListener("pointermove", seekSelectedPad);
  state.isSeeking = false;
  const pad = getSelectedPad();
  if (pad && state.activeVoices.has(pad.id)) {
    triggerPad(pad.id, { seek: pad.cursorTime, forceRestart: true });
  }
}

function drawWaveform() {
  const canvas = elements.waveformCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = getSelectedPad();

  ctx.clearRect(0, 0, width, height);
  drawWaveGrid(ctx, width, height);

  if (pad?.buffer) {
    drawPadWaveform(ctx, width, height, pad);
    updatePlayheadPosition(pad);
  } else {
    drawEmptyWaveform(ctx, width, height, pad);
    elements.playheadHandle.style.left = "0%";
  }

  requestAnimationFrame(drawWaveform);
}

function drawWaveGrid(ctx, width, height) {
  ctx.fillStyle = "#06090b";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;

  for (let i = 1; i < 6; i += 1) {
    const y = (height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let i = 1; i < 12; i += 1) {
    const x = (width / 12) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawPadWaveform(ctx, width, height, pad) {
  const buffer = pad.buffer;
  const channelData = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));
  const centerY = height / 2;
  const topGradient = ctx.createLinearGradient(0, 0, width, 0);
  topGradient.addColorStop(0, "rgba(22,185,224,0.25)");
  topGradient.addColorStop(0.5, "rgba(224,43,78,0.82)");
  topGradient.addColorStop(1, "rgba(57,230,124,0.4)");

  ctx.strokeStyle = topGradient;
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < width; x += 1) {
    const start = x * samplesPerPixel;
    let min = 1;
    let max = -1;
    for (let i = 0; i < samplesPerPixel; i += 1) {
      const value = channelData[start + i] || 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const y1 = centerY + min * centerY * 0.82;
    const y2 = centerY + max * centerY * 0.82;
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(224,43,78,0.08)";
  const playX = (getPadPlaybackTime(pad) / buffer.duration) * width;
  ctx.fillRect(0, 0, playX, height);
}

function drawEmptyWaveform(ctx, width, height, pad) {
  ctx.strokeStyle = "rgba(22,185,224,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 12) {
    const y = height / 2 + Math.sin(x / 30) * 14 + Math.sin(x / 95) * 9;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.font = "22px Segoe UI";
  ctx.fillText(pad?.blob ? "Waveform will appear after decoding" : "Select a loaded pad", 24, height - 28);
}

function updatePlayheadPosition(pad) {
  const duration = pad.buffer?.duration || 0;
  const current = duration ? getPadPlaybackTime(pad) : 0;
  const ratio = duration ? Math.max(0, Math.min(1, current / duration)) : 0;
  elements.playheadHandle.style.left = `${ratio * 100}%`;
  elements.selectedPadTime.textContent = formatTime(current, duration);
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

function handleGifUpload(event) {
  const file = event.target.files[0];
  if (file && file.type === "image/gif") {
    const reader = new FileReader();
    reader.onload = (e) => {
      elements.customGif.src = e.target.result;
      elements.customGif.style.display = "block";
    };
    reader.readAsDataURL(file);
  }
}

function drawVisualizer() {
  const canvas = elements.visualizerCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  // Clear with trails
  ctx.fillStyle = "rgba(4, 6, 8, 0.4)";
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;

  // React to audio
  let boost = 0;
  if (state.spectrumData) {
    let bassSum = 0;
    for(let i = 0; i < 10; i++) bassSum += state.spectrumData[i];
    boost = bassSum / 10 / 255;
  }

  // Draw 3D particles
  state.particles.forEach(p => {
    // Move particle towards camera based on speed and audio boost
    p.z -= p.speed + (boost * 20);
    
    // Reset if behind camera
    if (p.z <= 0) {
      p.x = (Math.random() - 0.5) * 800;
      p.y = (Math.random() - 0.5) * 800;
      p.z = 800;
      p.speed = Math.random() * 2 + 1;
    }

    // 3D projection
    const perspective = 300 / (p.z || 1);
    const px = cx + p.x * perspective;
    const py = cy + p.y * perspective;
    const size = Math.max(0.1, perspective * (1 + boost * 3));

    if (px >= 0 && px <= width && py >= 0 && py <= height) {
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(57, 230, 124, ${1 - p.z / 800})`; // Greenish neon
      ctx.fill();
    }
  });

  // Draw cyber grid overlay on walls/floor
  ctx.strokeStyle = `rgba(22, 185, 224, ${0.1 + boost * 0.2})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const time = Date.now() / 1000;
  for(let i = 0; i < width; i += 40) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i, height);
  }
  for(let i = 0; i < height; i += 40) {
    const y = (i + (time * 50) % 40);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  requestAnimationFrame(drawVisualizer);
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

function scheduleLibrarySave() {
  window.clearTimeout(state.librarySaveTimer);
  state.librarySaveTimer = window.setTimeout(() => {
    saveLibrary();
  }, 450);
}

async function saveLibrary() {
  if (!("indexedDB" in window)) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();
      state.pads.forEach((pad, index) => {
        if (!pad.blob) return;
        store.put({
          index,
          name: pad.fileName,
          type: pad.blob.type,
          blob: pad.blob,
          gainDb: pad.gainDb,
          replayLock: pad.replayLock,
        });
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
      pad.gainDb = Number(record.gainDb) || 0;
      pad.replayLock = Boolean(record.replayLock);
    });
    const restoredPad = records[0]?.index != null ? state.pads[records[0].index] : null;
    selectPad(restoredPad?.id || state.selectedPadId);
    elements.libraryStatus.textContent = `${records.length} このファイルきたぞぉ`;
    renderPads();
  } catch {
    elements.libraryStatus.textContent = "Library restore unavailable";
  }
}
