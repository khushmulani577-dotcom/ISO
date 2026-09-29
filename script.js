(() => {
  'use strict';
  if (location.protocol === 'file:') {
    location.replace('http://localhost:3000/');
    return;
  }
  const $ = (id) => document.getElementById(id);
  const el = {
    loader: $('loader'), loginScreen: $('loginScreen'), homeScreen: $('homeScreen'), loginForm: $('loginForm'), loginError: $('loginError'),
    mobile: $('mobile'), password: $('password'), reveal: $('revealPassword'), userName: $('userName'), accountName: $('accountName'), avatar: $('avatar'), greeting: $('greeting'),
    core: $('coreWrap'), state: $('stateLabel'), start: $('startButton'), stop: $('stopButton'), hint: $('voiceHint'), typeInstead: $('typeInstead'),
    transcript: $('transcript'), messageForm: $('messageForm'), message: $('messageInput'), newConversation: $('newConversation'), settings: $('settingsPanel'),
    settingsBackdrop: $('settingsBackdrop'), userButton: $('userButton'), closeSettings: $('closeSettings'), logout: $('logoutButton'), micStatus: $('micStatus'), toast: $('toast'),
    voiceSelect: $('voiceSelect'), speed: $('speed'), speedOut: $('speedOut'), volume: $('volume'), volumeOut: $('volumeOut'), sensitivity: $('sensitivity'), sensitivityOut: $('sensitivityOut'),
    noise: $('noiseSuppression'), echo: $('echoCancellation'), gain: $('autoGain')
  };
  const state = { user: null, mode: 'idle', micStream: null, audioContext: null, analyser: null, animationFrame: 0, recognition: null, recognitionSupported: false,
    shouldListen: false, speaking: false, speechGeneration: 0, history: [], requestController: null, threshold: .018, voiceActivityAt: 0, loudSince: 0, toastTimer: 0, voices: [] };

  const setMode = (mode, message) => {
    state.mode = mode;
    el.core.dataset.state = mode;
    el.state.dataset.state = mode;
    const text = message || ({ idle: 'Ready when you are.', listening: 'Listening…', thinking: 'Thinking…', speaking: 'ISO is responding…' }[mode]);
    el.state.querySelector('span').textContent = text;
    el.start.classList.toggle('hidden', mode !== 'idle');
    el.stop.classList.toggle('hidden', mode === 'idle');
  };
  const notify = (message) => {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3300);
  };
  const showHome = (user) => {
    state.user = user;
    el.userName.textContent = user.name;
    el.accountName.textContent = user.name;
    el.avatar.textContent = user.name.replace('User ', '').padStart(2, '0');
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'GOOD MORNING' : hour < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
    el.greeting.textContent = `${greeting}, ${user.name.toUpperCase()}`;
    el.loginScreen.classList.add('hidden');
    el.homeScreen.classList.remove('hidden');
    setMode('idle');
  };
  const showLogin = () => {
    el.homeScreen.classList.add('hidden');
    el.loginScreen.classList.remove('hidden');
    el.settings.classList.remove('open');
    el.settings.setAttribute('aria-hidden', 'true');
    el.settingsBackdrop.classList.add('hidden');
    el.loginError.textContent = '';
  };
  const clearTranscript = () => {
    el.transcript.innerHTML = '<div class="empty-session"><span class="empty-glyph">◌</span><p>Your conversation will appear here.</p><span>Nothing leaves this private session.</span></div>';
  };
  const accessServiceMessage = () => {
    if (location.protocol === 'file:') return 'ISO needs to run from a local server. Start the app with "node backend/server.js" or "npm start", then open http://localhost:3000.';
    if (!navigator.onLine) return 'Please check your internet connection and try again.';
    return 'ISO could not reach its access service. Start the backend with "node backend/server.js" or "npm start" and then try again.';
  };
  const addTurn = (role, content, pending = false) => {
    if (el.transcript.querySelector('.empty-session')) el.transcript.replaceChildren();
    const turn = document.createElement('article');
    turn.className = `turn ${role === 'ISO' ? 'iso-turn' : 'user-turn'}${pending ? ' pending' : ''}`;
    turn.dataset.role = role;
    const label = document.createElement('div'); label.className = 'turn-label';
    const dot = document.createElement('i'); dot.className = 'turn-dot'; label.append(dot, document.createTextNode(role));
    const text = document.createElement('p'); text.textContent = content;
    turn.append(label, text); el.transcript.append(turn); el.transcript.scrollTop = el.transcript.scrollHeight;
    return { turn, text };
  };
  const appendMessage = async (message) => {
    const clean = message.trim();
    if (!clean || state.mode === 'idle' && !state.user) return;
    if (state.requestController) state.requestController.abort();
    state.requestController = new AbortController();
    stopSpeech();
    addTurn('YOU', clean);
    const pending = addTurn('ISO', 'Thinking', true);
    setMode('thinking');
    stopRecognition();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: state.requestController.signal,
        body: JSON.stringify({ message: clean, conversationHistory: state.history.slice(-16) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messageText = response.status === 503 ? 'ISO is temporarily unable to reach its intelligence service. Please try again.' : (data.error || 'ISO is temporarily unable to reach its intelligence service. Please try again.');
        throw new Error(messageText);
      }
      if (!data.reply || typeof data.reply !== 'string') throw new Error('ISO is temporarily unable to reach its intelligence service. Please try again.');
      pending.turn.classList.remove('pending'); pending.text.textContent = data.reply;
      state.history.push({ role: 'user', content: clean }, { role: 'assistant', content: data.reply });
      if (state.history.length > 24) state.history = state.history.slice(-24);
      el.transcript.scrollTop = el.transcript.scrollHeight;
      if (state.shouldListen) speak(data.reply); else setMode('idle');
    } catch (error) {
      if (error.name === 'AbortError') { pending.turn.remove(); return; }
      pending.turn.classList.remove('pending');
      const networkMessage = error.message.includes('Failed to fetch') || !navigator.onLine ? accessServiceMessage() : error.message;
      pending.text.textContent = networkMessage;
      setMode(state.shouldListen ? 'listening' : 'idle');
      if (state.shouldListen) startRecognition();
    } finally { if (state.requestController?.signal.aborted === false) state.requestController = null; }
  };
  const cleanForSpeech = (text) => text.replace(/```[\s\S]*?```/g, ' code omitted ').replace(/`([^`]+)`/g, '$1').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_~>|]/g, ' ').replace(/\s+/g, ' ').trim();
  const selectedVoice = () => state.voices.find((voice) => voice.voiceURI === el.voiceSelect.value) || state.voices.find((voice) => /^en(-|_)/i.test(voice.lang)) || null;
  const speak = (text) => {
    if (!('speechSynthesis' in window)) { setMode(state.shouldListen ? 'listening' : 'idle'); if (state.shouldListen) startRecognition(); return; }
    stopRecognition();
    const spoken = cleanForSpeech(text);
    if (!spoken) { setMode(state.shouldListen ? 'listening' : 'idle'); if (state.shouldListen) startRecognition(); return; }
    state.speaking = true; state.speechGeneration += 1; const generation = state.speechGeneration;
    const utterance = new SpeechSynthesisUtterance(spoken); const voice = selectedVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-US'; utterance.rate = Number(el.speed.value); utterance.volume = Number(el.volume.value);
    utterance.onstart = () => { if (generation === state.speechGeneration) setMode('speaking'); };
    utterance.onend = () => { if (generation !== state.speechGeneration) return; state.speaking = false; if (state.shouldListen) { setMode('listening'); startRecognition(); } else setMode('idle'); };
    utterance.onerror = () => { if (generation !== state.speechGeneration) return; state.speaking = false; if (state.shouldListen) { setMode('listening'); startRecognition(); } else setMode('idle'); };
    window.speechSynthesis.speak(utterance);
  };
  const stopSpeech = () => { state.speechGeneration += 1; state.speaking = false; if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.recognitionSupported = Boolean(Recognition);
  if (Recognition) {
    state.recognition = new Recognition();
    state.recognition.continuous = true; state.recognition.interimResults = true; state.recognition.lang = 'en-US'; state.recognition.maxAlternatives = 1;
    state.recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && result[0]?.confidence >= .18) finalText += result[0].transcript + ' ';
      }
      finalText = finalText.trim();
      if (finalText && state.shouldListen) {
        if (state.speaking) stopSpeech();
        if (finalText.replace(/[^a-zA-Z0-9]/g, '').length >= 2) appendMessage(finalText);
      }
    };
    state.recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { state.shouldListen = false; setMode('idle'); notify('Microphone access is required to use ISO Voice.'); releaseAudio(); }
      else if (event.error === 'language-not-supported') notify('ISO currently communicates in English only.');
    };
    state.recognition.onend = () => { if (state.shouldListen && !state.speaking && state.mode === 'listening') startRecognition(); };
  }
  const startRecognition = () => { if (!state.recognition || !state.shouldListen || state.speaking) return; try { state.recognition.start(); } catch (_) { /* already active; onend will restart */ } };
  const stopRecognition = () => { if (state.recognition) { try { state.recognition.stop(); } catch (_) {} } };
  const analyserLoop = () => {
    if (!state.analyser) return;
    const samples = new Uint8Array(state.analyser.fftSize); state.analyser.getByteTimeDomainData(samples);
    let sum = 0; for (const sample of samples) { const v = (sample - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / samples.length);
    const reactive = Math.min(1, Math.max(0, (rms - .005) / .08));
    el.core.style.setProperty('--react', reactive.toFixed(2));
    const now = performance.now();
    if (rms > state.threshold) state.voiceActivityAt = now;
    if (rms > Math.max(.03, state.threshold * 3.2)) {
      if (!state.loudSince) state.loudSince = now;
      if (state.speaking && now - state.loudSince > 380) { stopSpeech(); state.loudSince = 0; setMode('listening'); startRecognition(); }
    } else state.loudSince = 0;
    state.animationFrame = requestAnimationFrame(analyserLoop);
  };
  const initAudio = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is required to use ISO Voice.');
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: el.echo.checked, noiseSuppression: el.noise.checked, autoGainControl: el.gain.checked } });
    el.micStatus.textContent = 'On';
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      state.audioContext = new AudioContextClass();
      const source = state.audioContext.createMediaStreamSource(state.micStream);
      state.analyser = state.audioContext.createAnalyser(); state.analyser.fftSize = 512; source.connect(state.analyser);
      state.threshold = [.035, .018, .009][Number(el.sensitivity.value) - 1];
      analyserLoop();
    }
  };
  const releaseAudio = () => {
    cancelAnimationFrame(state.animationFrame); state.animationFrame = 0; state.analyser = null;
    if (state.micStream) { state.micStream.getTracks().forEach((track) => track.stop()); state.micStream = null; }
    if (state.audioContext) { state.audioContext.close().catch(() => {}); state.audioContext = null; }
    el.core.style.setProperty('--react', '0'); el.micStatus.textContent = 'Off';
  };
  const startISO = async () => {
    if (!state.recognitionSupported) { notify("Voice recognition isn't supported in this browser. You can continue using text input."); el.message.focus(); return; }
    if (!navigator.onLine) { notify('Please check your internet connection and try again.'); return; }
    try {
      await initAudio();
      state.shouldListen = true; el.hint.textContent = 'Speak naturally. ISO is listening.'; setMode('listening'); startRecognition();
    } catch (error) {
      state.shouldListen = false; releaseAudio(); setMode('idle');
      notify(error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'Microphone access is required to use ISO Voice.' : error.message || 'Microphone access is required to use ISO Voice.');
    }
  };
  const stopISO = () => {
    state.shouldListen = false; stopRecognition(); stopSpeech();
    if (state.requestController) { state.requestController.abort(); state.requestController = null; }
    releaseAudio(); setMode('idle'); el.hint.textContent = 'A private conversation, at your pace.';
  };
  const loadVoices = () => {
    if (!('speechSynthesis' in window)) return;
    state.voices = window.speechSynthesis.getVoices().filter((voice) => /^en(-|_)/i.test(voice.lang));
    const previous = el.voiceSelect.value; el.voiceSelect.replaceChildren(new Option('System default', ''));
    for (const voice of state.voices) el.voiceSelect.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI));
    if (previous) el.voiceSelect.value = previous;
  };

  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); el.loginError.textContent = '';
    try {
      const response = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: el.mobile.value.trim(), password: el.password.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { el.loginError.textContent = 'Access denied.'; return; }
      el.password.value = ''; showHome(data.user);
    } catch (_) { el.loginError.textContent = accessServiceMessage(); }
  });
  el.reveal.addEventListener('click', () => { const show = el.password.type === 'password'; el.password.type = show ? 'text' : 'password'; el.reveal.textContent = show ? 'HIDE' : 'SHOW'; el.reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); });
  el.start.addEventListener('click', startISO); el.stop.addEventListener('click', stopISO);
  el.typeInstead.addEventListener('click', () => { el.message.focus(); el.message.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  el.messageForm.addEventListener('submit', (event) => { event.preventDefault(); const text = el.message.value; if (!text.trim()) return; el.message.value = ''; appendMessage(text); });
  el.newConversation.addEventListener('click', () => { stopISO(); state.history = []; clearTranscript(); notify('New conversation ready.'); });
  const openSettings = () => { el.settingsBackdrop.classList.remove('hidden'); requestAnimationFrame(() => el.settingsBackdrop.classList.add('open')); el.settings.classList.add('open'); el.settings.setAttribute('aria-hidden', 'false'); };
  const closeSettings = () => { el.settings.classList.remove('open'); el.settings.setAttribute('aria-hidden', 'true'); el.settingsBackdrop.classList.remove('open'); setTimeout(() => { if (!el.settingsBackdrop.classList.contains('open')) el.settingsBackdrop.classList.add('hidden'); }, 260); };
  el.userButton.addEventListener('click', openSettings); el.closeSettings.addEventListener('click', closeSettings); el.settingsBackdrop.addEventListener('click', closeSettings);
  el.logout.addEventListener('click', async () => { stopISO(); state.history = []; clearTranscript(); try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (_) {} closeSettings(); showLogin(); el.mobile.value = ''; el.password.value = ''; });
  el.speed.addEventListener('input', () => { el.speedOut.value = `${Number(el.speed.value).toFixed(2).replace(/0$/, '')}×`; });
  el.volume.addEventListener('input', () => { el.volumeOut.value = `${Math.round(Number(el.volume.value) * 100)}%`; });
  el.sensitivity.addEventListener('input', () => { const labels = ['Low', 'Medium', 'High']; el.sensitivityOut.value = labels[Number(el.sensitivity.value) - 1]; state.threshold = [.035, .018, .009][Number(el.sensitivity.value) - 1]; });
  el.noise.addEventListener('change', () => notify('Audio preferences apply next time you start ISO Voice.'));
  el.echo.addEventListener('change', () => notify('Audio preferences apply next time you start ISO Voice.'));
  el.gain.addEventListener('change', () => notify('Audio preferences apply next time you start ISO Voice.'));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSettings(); });
  window.addEventListener('offline', () => { if (state.shouldListen) notify('Please check your internet connection and try again.'); });
  if ('speechSynthesis' in window) { loadVoices(); window.speechSynthesis.addEventListener('voiceschanged', loadVoices); }
  setTimeout(async () => {
    el.loader.classList.add('done');
    try { const response = await fetch('/api/session', { credentials: 'same-origin' }); if (response.ok) { const data = await response.json(); if (data.user) showHome(data.user); } } catch (_) { /* login remains available; backend will explain on submit */ }
    setTimeout(() => el.loader.remove(), 750);
  }, 900);
})();
