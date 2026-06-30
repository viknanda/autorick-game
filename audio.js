/* ==========================================
   AutoRick Tour of India - Procedural Audio
   ========================================== */

class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineStarted = false;
    this.music = null;
    this.musicPlaying = false;
    this.musicTheme = 'OFF'; // 'OFF' or 'CYBER DESI'

    // Engine Nodes
    this.engineOsc = null;
    this.engineLfo = null;
    this.engineLfoGain = null;
    this.engineGain = null;
    this.engineFilter = null;

    // Master Volume
    this.masterGain = null;
    this.audioState = 0; // 0 = FX & Music, 1 = FX Only, 2 = Muted
  }

  // Initialize Audio Context on first interaction (required by browsers)
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') {
          p.catch(e => console.warn("Failed to resume Web Audio context:", e));
        }
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') {
          p.catch(e => console.warn("Failed to resume Web Audio context on creation:", e));
        }
      }

      // Play a short silent buffer to unlock Web Audio on iOS Safari
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.ctx.destination);
      source.start(0);
      
      // Silent Switch Bypass Hack for iOS Safari (forces Web Audio to hardware media channel)
      try {
        const unlockAudio = document.createElement('audio');
        unlockAudio.setAttribute('playsinline', '');
        unlockAudio.setAttribute('webkit-playsinline', '');
        unlockAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
        unlockAudio.loop = true;
        unlockAudio.volume = 0.01;
        const playPromise = unlockAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => console.warn("Silent audio tag play blocked:", e));
        }
      } catch (e) {
        console.warn("Failed to play silent audio element:", e);
      }
      
      // Master Gain for easy muting/volume control
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 2.5, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Initialize Desi Beats Music player
      this.music = new DesiMusic(this.ctx, this.masterGain);

      this.setupEngine();

      // Pre-warm Web Speech API on user gesture to unlock speech synthesis
      if ('speechSynthesis' in window) {
        try {
          const warmUp = new SpeechSynthesisUtterance("");
          warmUp.volume = 0;
          window.speechSynthesis.speak(warmUp);
        } catch (e) {
          console.warn("Speech pre-warming failed:", e);
        }
      }

      if (this.audioState === 0) {
        this.musicTheme = 'CYBER DESI';
        this.music.start();
        this.musicPlaying = true;
      }
    } catch (e) {
      console.warn("Web Audio API not supported:", e);
    }
  }

  cycleAudioState() {
    this.init();
    if (!this.ctx) return 'ALL_ON';
    
    this.audioState = (this.audioState + 1) % 3;
    
    if (this.audioState === 0) {
      // State 0: All Audio ON
      this.muted = false;
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(2.5, this.ctx.currentTime);
      }
      // Start music if not playing
      if (this.music && !this.musicPlaying) {
        this.musicTheme = 'CYBER DESI';
        this.music.start();
        this.musicPlaying = true;
      }
      return 'ALL_ON';
    } else if (this.audioState === 1) {
      // State 1: FX Only (Music OFF)
      this.muted = false;
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(2.5, this.ctx.currentTime);
      }
      // Stop music
      if (this.music && this.musicPlaying) {
        this.musicTheme = 'OFF';
        this.music.stop();
        this.musicPlaying = false;
      }
      return 'FX_ONLY';
    } else {
      // State 2: Muted (All OFF)
      this.muted = true;
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      }
      // Stop music if playing
      if (this.music && this.musicPlaying) {
        this.musicTheme = 'OFF';
        this.music.stop();
        this.musicPlaying = false;
      }
      return 'MUTED';
    }
  }

  // ==========================================
  // PROCEDURAL ENGINE SOUND ("TUK-TUK")
  // ==========================================
  setupEngine() {
    if (!this.ctx) return;

    // Engine sound is composed of a low frequency oscillator (the cylinder strokes)
    // modulating the amplitude of a resonant bandpass filtered wave.
    
    // 1. Core combustion oscillator
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.setValueAtTime(45, this.ctx.currentTime); // Idle Hz (low rumble)

    // 2. Bandpass filter to model the hollow exhaust pipes
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'bandpass';
    this.engineFilter.frequency.setValueAtTime(140, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    // 3. Gain node for the engine output
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.0, this.ctx.currentTime); // Start silent

    // 4. Amplitude Modulation (LFO) to create the "tuk-tuk-tuk" sputtering
    this.engineLfo = this.ctx.createOscillator();
    this.engineLfo.type = 'triangle';
    this.engineLfo.frequency.setValueAtTime(7, this.ctx.currentTime); // Idle cylinder stroke rate (7 Hz)

    this.engineLfoGain = this.ctx.createGain();
    this.engineLfoGain.gain.setValueAtTime(0.7, this.ctx.currentTime); // Depth of modulation

    // Connect LFO to engine volume modulation
    // Modulation shifts gain up and down rapidly to sound like individual engine strokes
    const lfoInverter = this.ctx.createGain();
    lfoInverter.gain.setValueAtTime(0.3, this.ctx.currentTime); // DC offset
    
    this.engineLfo.connect(this.engineLfoGain);
    
    // Wire up engine components
    this.engineOsc.connect(this.engineFilter);
    
    // Create custom gain modulation
    const modGain = this.ctx.createGain();
    modGain.gain.setValueAtTime(0.15, this.ctx.currentTime); // Idle base level
    
    this.engineLfoGain.connect(modGain.gain);
    this.engineFilter.connect(modGain);
    modGain.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    // Start oscillators
    this.engineOsc.start(0);
    this.engineLfo.start(0);
    this.engineStarted = true;
  }

  // Dynamically scale engine sound speed and pitch
  // speedRatio goes from 0.0 (stopped) to 1.0 (top speed)
  setEngineSpeed(speedRatio) {
    if (!this.ctx || !this.engineStarted || this.muted) return;

    const t = this.ctx.currentTime;
    
    // Map speed ratio to parameters:
    // Engine pitch: 45Hz (idle) to 110Hz (screaming 2-stroke)
    const baseFreq = 45 + (speedRatio * 65);
    this.engineOsc.frequency.setTargetAtTime(baseFreq, t, 0.15);

    // Sputter rate (LFO): 7Hz (idle) to 22Hz (high RPM)
    const lfoFreq = 7 + (speedRatio * 15);
    this.engineLfo.frequency.setTargetAtTime(lfoFreq, t, 0.1);

    // Exhaust resonance shift: 140Hz to 280Hz
    const filterFreq = 140 + (speedRatio * 140);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.2);

    // Engine volume: slightly louder when driving fast
    const engineVol = 0.45 + (speedRatio * 0.3);
    this.engineGain.gain.setTargetAtTime(engineVol, t, 0.1);
  }

  stopEngine() {
    if (!this.ctx || !this.engineStarted) return;
    this.engineGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.1);
  }

  startEngine() {
    this.init();
    if (!this.ctx || !this.engineStarted) return;
    
    const setVolume = () => {
      if (this.engineGain && this.ctx) {
        this.engineGain.gain.setTargetAtTime(0.45, this.ctx.currentTime, 0.2);
      }
    };

    if (typeof this.ctx.resume === 'function') {
      const p = this.ctx.resume();
      if (p && typeof p.then === 'function') {
        p.then(setVolume).catch(setVolume);
      } else {
        setVolume();
      }
    } else {
      setVolume();
    }
  }

  // ==========================================
  // PROCEDURAL GAME SOUND EFFECTS
  // ==========================================

  // Classic Rickshaw Double Horn "Poop-Poop!"
  playHorn() {
    this.init();
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    
    const playBeep = (startTime, duration) => {
      // High-pitched square waves to get that buzzy/nasal metallic honk
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const hornGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc1.type = 'square';
      osc1.frequency.setValueAtTime(680, startTime); // Main note

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(698, startTime); // Buzzy interval (tritone-ish)

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1000, startTime);
      filter.Q.setValueAtTime(1.0, startTime);

      hornGain.gain.setValueAtTime(0, startTime);
      hornGain.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
      hornGain.gain.setValueAtTime(0.25, startTime + duration - 0.02);
      hornGain.gain.linearRampToValueAtTime(0, startTime + duration);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(hornGain);
      hornGain.connect(this.masterGain);

      osc1.start(startTime);
      osc2.start(startTime);
      
      osc1.stop(startTime + duration);
      osc2.stop(startTime + duration);
    };

    // Make the double beep sound
    playBeep(t, 0.12);
    playBeep(t + 0.18, 0.12);
  }

  // Coin Collection Chime (Retro arcade bell)
  playCoin() {
    this.init();
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Arpeggiating upwards quickly
    osc.frequency.setValueAtTime(988, t); // B5
    osc.frequency.setValueAtTime(1318, t + 0.07); // E6

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.26);
  }

  // Cutting Chai Turbo Power-up sound
  playPowerUp() {
    this.init();
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(261, t); // C4
    // Smooth upward slide to C6
    osc.frequency.exponentialRampToValueAtTime(1046, t + 0.4);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.46);
  }

  // Health restoration / Samosa pickup
  playHeal() {
    this.init();
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, t); // C5
    osc.frequency.setValueAtTime(659, t + 0.08); // E5
    osc.frequency.setValueAtTime(784, t + 0.16); // G5

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setValueAtTime(0.15, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.36);
  }

  // Heavy Collision Crash (White noise + low thud)
  playCrash() {
    this.init();
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    const duration = 0.6;

    // 1. Generate a small noise buffer
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = this.ctx.createBufferSource();
    noiseNode.buffer = buffer;

    // 2. Filter the noise to sound crunchy/heavy
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + duration);

    // 3. Noise Volume Envelope
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noiseNode.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    // 4. Low bass frequency oscillator for a deep impact thud
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    
    bassOsc.type = 'triangle';
    bassOsc.frequency.setValueAtTime(100, t);
    bassOsc.frequency.linearRampToValueAtTime(20, t + 0.2); // Pitch sweep down

    bassGain.gain.setValueAtTime(0.4, t);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    bassOsc.connect(bassGain);
    bassGain.connect(this.masterGain);

    // Start crash elements
    noiseNode.start(t);
    bassOsc.start(t);
    
    noiseNode.stop(t + duration);
    bassOsc.stop(t + duration);
  }
}

// ==========================================
// PROCEDURAL DESI MUSIC PLAYER
// ==========================================

const NOTES = {
  C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, G3: 196.00, Ab3: 207.65, A3: 220.00, Bb3: 233.08, B3: 246.94,
  C4: 261.63, Cs4: 277.18, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, Gs4: 415.30, A4: 440.00, Bb4: 466.16, B4: 493.88,
  C5: 523.25, Cs5: 554.37, D5: 587.33, Eb5: 622.25, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, Gs5: 830.61, A5: 880.00, Bb5: 932.33, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98
};

class DesiMusic {
  constructor(audioContext, destination) {
    this.ctx = audioContext;
    this.dest = destination;
    this.playing = false;
    this.bpm = 142; // Fast tempo Slope.io cyber speed
    this.stepDuration = 60 / this.bpm / 4; // 16th note step in seconds
    this.nextNoteTime = 0.0;
    this.currentStep = 0;
    this.timerId = null;
    this.lookahead = 25.0;
    this.scheduleAheadTime = 0.1;
    
    // High-tempo Cyber Sitar lead melody scale
    this.melodyCyberDesi = [
      NOTES.C5, 0, NOTES.C5, NOTES.Eb5, NOTES.F5, 0, NOTES.G5, 0,
      NOTES.F5, NOTES.Eb5, NOTES.C5, 0, NOTES.Bb4, NOTES.C5, 0, 0,
      NOTES.C5, 0, NOTES.C5, NOTES.Eb5, NOTES.F5, 0, NOTES.G5, 0,
      NOTES.Bb5, 0, NOTES.G5, NOTES.F5, NOTES.G5, 0, 0, 0,
      NOTES.Eb5, NOTES.Eb5, NOTES.Eb5, 0, NOTES.D5, NOTES.Eb5, NOTES.D5, NOTES.C5,
      NOTES.D5, NOTES.D5, NOTES.D5, 0, NOTES.C5, NOTES.D5, NOTES.C5, NOTES.Bb4,
      NOTES.C5, 0, NOTES.C5, NOTES.Eb5, NOTES.F5, 0, NOTES.G5, 0,
      NOTES.Bb4, NOTES.Bb4, NOTES.Ab4, NOTES.G4, NOTES.C5, 0, 0, 0
    ];
    
    // Rolling Cyber Bass notes
    this.bassCyberDesi = [
      NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3,
      NOTES.Eb3, NOTES.Eb3, NOTES.Eb3, NOTES.Eb3, NOTES.F3, NOTES.F3, NOTES.G3, NOTES.G3,
      NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3, NOTES.C3,
      NOTES.Bb3, NOTES.Bb3, NOTES.Ab3, NOTES.Ab3, NOTES.G3, NOTES.G3, NOTES.C3, NOTES.C3
    ];
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.nextNoteTime = this.ctx.currentTime;
    this.currentStep = 0;
    this.scheduler();
  }

  stop() {
    this.playing = false;
    clearTimeout(this.timerId);
  }

  scheduler() {
    if (!this.playing) return;
    if (this.nextNoteTime < this.ctx.currentTime) {
      this.nextNoteTime = this.ctx.currentTime;
    }
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleStep(this.currentStep, this.nextNoteTime);
      this.advanceStep();
    }
    this.timerId = setTimeout(() => this.scheduler(), this.lookahead);
  }

  advanceStep() {
    this.currentStep = (this.currentStep + 1) % 64; // 64 steps total loop
    this.nextNoteTime += this.stepDuration;
  }

  scheduleStep(step, time) {
    const stepInBar = step % 16;
    
    // 1. Heavy Cyber Kick Drum (Four-on-the-floor EDM beats 1, 2, 3, 4)
    if (stepInBar % 4 === 0) {
      this.playCyberKick(time);
    }
    
    // 2. Open Hi-hats on off-beats (steps 2, 6, 10, 14) and rapid 16th hats elsewhere
    if (stepInBar % 4 === 2) {
      this.playCyberHat(time);
    } else if (stepInBar % 2 === 1) {
      // Closed cyber hat tick
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(14000, time);
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(10000, time);
      gain.gain.setValueAtTime(0.03, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.dest);
      osc.start(time);
      osc.stop(time + 0.04);
    }
    
    // 3. Indian Dhol Bouncy Slap (Syncopated pattern)
    if ([3, 6, 11, 14].includes(stepInBar)) {
      this.playDholSlap(time, stepInBar === 3 || stepInBar === 11 ? 160 : 130);
    }
    
    // 4. Cyber Rolling Bass (8th notes)
    if (step % 2 === 0) {
      const bassFreq = this.bassCyberDesi[Math.floor(step / 2) % this.bassCyberDesi.length];
      if (bassFreq > 0) {
        this.playCyberBass(bassFreq, time);
      }
    }
    
    // 5. Cyber Sitar Lead Melody (high-tempo resonant electronic sweep)
    const leadFreq = this.melodyCyberDesi[step % this.melodyCyberDesi.length];
    if (leadFreq > 0) {
      this.playCyberLead(leadFreq, time);
    }
  }

  // --- CYBER DESI WEB AUDIO SYNTHESIS INSTRUMENTS ---

  playCyberKick(time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    // Deep slope-style fast pitch drop kick
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);
    
    gain.gain.setValueAtTime(0.75, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    
    osc.connect(gain);
    gain.connect(this.dest);
    
    osc.start(time);
    osc.stop(time + 0.16);
  }

  playCyberHat(time) {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(12000, time);
    
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);
    
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.dest);
    
    osc.start(time);
    osc.stop(time + 0.07);
  }

  playDholSlap(time, baseFreq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, time);
    osc.frequency.exponentialRampToValueAtTime(125, time + 0.08);
    
    gain.gain.setValueAtTime(0.28, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    
    osc.connect(gain);
    gain.connect(this.dest);
    
    osc.start(time);
    osc.stop(time + 0.14);
  }

  playCyberBass(freq, time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth'; // Pounding techno bass tone
    osc.frequency.setValueAtTime(freq, time);
    
    // Quick filter slide for squelch
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, time);
    filter.frequency.exponentialRampToValueAtTime(130, time + 0.1);
    
    gain.gain.setValueAtTime(0.24, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.dest);
    
    osc.start(time);
    osc.stop(time + 0.14);
  }

  playCyberLead(freq, time) {
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'bandpass';
    // Resonant sweeps to make it sound cybernetic
    filter.frequency.setValueAtTime(freq * 1.6, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.75, time + 0.15);
    filter.Q.setValueAtTime(3.8, time);

    gain.gain.setValueAtTime(0.14, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.dest);

    osc.start(time);
    osc.stop(time + 0.22);
  }
}

// Global Audio Instance
const gameAudio = new GameAudio();
