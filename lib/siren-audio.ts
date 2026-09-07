// Web Audio API based Emergency Siren Synthesizer
// Completely self-contained, zero external network dependency, 100% CSP-safe

class EmergencySirenPlayer {
  private audioCtx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private intervalId: any = null;
  private isPlaying = false;

  private initContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  private playChimePulse() {
    if (!this.audioCtx || !this.isPlaying) return;

    try {
      const now = this.audioCtx.currentTime;

      // Tone 1: 587.33 Hz (D5)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);

      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.18, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.36);

      // Tone 2: 880.00 Hz (A5) slightly delayed for modern attention chime
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.0, now + 0.12);

      gain2.gain.setValueAtTime(0, now + 0.12);
      gain2.gain.linearRampToValueAtTime(0.22, now + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.56);
    } catch (err) {
      console.warn('Chime pulse error:', err);
    }
  }

  public play() {
    if (this.isPlaying || typeof window === 'undefined') return;

    try {
      this.initContext();
      if (!this.audioCtx) return;

      this.isPlaying = true;
      this.playChimePulse();

      // Repeat chime pulse every 1.5 seconds while emergency is active
      this.intervalId = setInterval(() => {
        if (!this.isPlaying) return;
        this.playChimePulse();
      }, 1500);
    } catch (err) {
      console.warn('Failed to start alarm chime:', err);
    }
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
  }

  public getStatus() {
    return this.isPlaying;
  }
}

export const sirenPlayer = new EmergencySirenPlayer();
