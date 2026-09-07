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

  public play() {
    if (this.isPlaying || typeof window === 'undefined') return;

    try {
      this.initContext();
      if (!this.audioCtx) return;

      this.oscillator = this.audioCtx.createOscillator();
      this.gainNode = this.audioCtx.createGain();

      this.oscillator.type = 'sawtooth';
      this.oscillator.frequency.setValueAtTime(600, this.audioCtx.currentTime);

      // Smooth ramping gain to avoid clipping
      this.gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);

      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.oscillator.start();
      this.isPlaying = true;

      // Two-tone European / industrial emergency sweep (600Hz <-> 950Hz)
      let highTone = true;
      this.intervalId = setInterval(() => {
        if (!this.audioCtx || !this.oscillator) return;
        const targetFreq = highTone ? 950 : 600;
        this.oscillator.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.15);
        highTone = !highTone;
      }, 450);
    } catch (err) {
      console.warn('Failed to start siren audio:', err);
    }
  }

  public stop() {
    if (!this.isPlaying) return;

    try {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      if (this.oscillator) {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.oscillator = null;
      }

      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
    } catch (err) {
      console.warn('Failed to stop siren audio:', err);
    } finally {
      this.isPlaying = false;
    }
  }

  public getStatus() {
    return this.isPlaying;
  }
}

export const sirenPlayer = new EmergencySirenPlayer();
