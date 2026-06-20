import type { TrackId } from "./trackFor";

const TRACK_URLS: Record<TrackId, string> = {
  main: "/assets/bgm/main.mp3",
  hougong: "/assets/bgm/hougong.mp3",
  jiaowai: "/assets/bgm/jiaowai.mp3",
  market: "/assets/bgm/market.mp3",
  wenqing: "/assets/bgm/wenqing.mp3",
};

const VOL_KEY = "bgm.volume";
const MUTE_KEY = "bgm.muted";

class AudioController {
  private audio: HTMLAudioElement | null = null;
  private current: TrackId | null = null;
  private volume = 0.6;
  private muted = false;
  private unlockArmed = false;

  private ensure(): HTMLAudioElement {
    if (!this.audio) {
      const a = new Audio();
      a.loop = true;
      const v = Number(localStorage.getItem(VOL_KEY));
      this.volume = Number.isFinite(v) ? v : 0.6;
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
      a.volume = this.volume;
      a.muted = this.muted;
      this.audio = a;
      this.armUnlock();
    }
    return this.audio;
  }

  /** 浏览器在首次用户手势前会拦截 autoplay；首次 pointerdown/keydown 后补播当前曲目。 */
  private armUnlock(): void {
    if (this.unlockArmed || typeof window === "undefined") return;
    this.unlockArmed = true;
    const resume = () => {
      const a = this.audio;
      if (a && a.paused && a.src) void a.play().catch(() => { /* 仍被拦截则等下次手势 */ });
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  play(track: TrackId): void {
    const a = this.ensure();
    // 切歌：换 src 重播。同曲目但已被 autoplay 拦截而暂停时也需补播一次。
    if (this.current === track) {
      if (a.paused && a.src) void a.play().catch(() => { /* 等用户手势解锁 */ });
      return;
    }
    this.current = track;
    a.src = TRACK_URLS[track];
    void a.play().catch(() => { /* 自动播放被拦截：首次用户交互后的 resume 会补播 */ });
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    localStorage.setItem(VOL_KEY, String(this.volume));
    if (this.audio) this.audio.volume = this.volume;
  }

  setMuted(b: boolean): void {
    this.muted = b;
    localStorage.setItem(MUTE_KEY, b ? "1" : "0");
    if (this.audio) this.audio.muted = b;
  }

  getVolume(): number { return this.volume; }
  isMuted(): boolean { return this.muted; }
}

export const audioController = new AudioController();
