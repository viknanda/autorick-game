/**
 * AutoRick Tour of India - Unified Portal Ad & Analytics Bridge
 * Supports CrazyGames SDK v3 and Poki SDK with automatic fallback for standalone / GitHub Pages.
 */
class PortalBridge {
  constructor() {
    this.platform = 'standalone'; // 'crazygames' | 'poki' | 'standalone'
    this.initialized = false;
    this.adInProgress = false;
    this.lastMidgameAdTime = 0;
    this.minAdIntervalMs = 85000; // 85-second minimum cooldown between midgame ads (platform policy)
    this.savedAudioMode = null;
  }

  /**
   * Initialize SDKs and detect hosting platform environment
   */
  async init() {
    if (this.initialized) return;

    try {
      // 1. Check CrazyGames SDK v3
      if (typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK) {
        try {
          await window.CrazyGames.SDK.init();
          this.platform = 'crazygames';
          if (window.CrazyGames.SDK.game && typeof window.CrazyGames.SDK.game.loadingStop === 'function') {
            window.CrazyGames.SDK.game.loadingStop();
          }
          console.log('[PortalBridge] CrazyGames SDK v3 initialized successfully.');
          this.initialized = true;
          return;
        } catch (cgErr) {
          console.warn('[PortalBridge] CrazyGames init error:', cgErr);
        }
      }

      // 2. Check Poki SDK
      if (typeof window !== 'undefined' && window.PokiSDK) {
        try {
          await window.PokiSDK.init();
          this.platform = 'poki';
          if (typeof window.PokiSDK.gameLoadingFinished === 'function') {
            window.PokiSDK.gameLoadingFinished();
          }
          console.log('[PortalBridge] Poki SDK initialized successfully.');
          this.initialized = true;
          return;
        } catch (pokiErr) {
          console.warn('[PortalBridge] Poki init error:', pokiErr);
        }
      }
    } catch (e) {
      console.warn('[PortalBridge] Running in standalone fallback mode.', e);
    }

    // Default standalone fallback
    this.platform = 'standalone';
    this.initialized = true;
    console.log('[PortalBridge] Standalone mode active (mock ad responses enabled).');
  }

  /**
   * Signal that gameplay has started/resumed
   */
  gameplayStart() {
    if (this.platform === 'crazygames' && window.CrazyGames?.SDK?.game?.gameplayStart) {
      window.CrazyGames.SDK.game.gameplayStart();
    } else if (this.platform === 'poki' && window.PokiSDK?.gameplayStart) {
      window.PokiSDK.gameplayStart();
    }
  }

  /**
   * Signal that gameplay has stopped (Game Over / Paused)
   */
  gameplayStop() {
    if (this.platform === 'crazygames' && window.CrazyGames?.SDK?.game?.gameplayStop) {
      window.CrazyGames.SDK.game.gameplayStop();
    } else if (this.platform === 'poki' && window.PokiSDK?.gameplayStop) {
      window.PokiSDK.gameplayStop();
    }
  }

  /**
   * Request a Midgame Interstitial Commercial Break (between runs)
   * Enforces platform ad pacing cooldown (85s)
   */
  showMidgameAd(onComplete) {
    const callback = typeof onComplete === 'function' ? onComplete : () => {};
    const now = Date.now();

    // Respect ad frequency guidelines: skip ad if played recently
    if (now - this.lastMidgameAdTime < this.minAdIntervalMs) {
      callback();
      return;
    }

    // Standalone fallback: instantaneous pass-through
    if (this.platform === 'standalone') {
      this.lastMidgameAdTime = now;
      callback();
      return;
    }

    this._beforeAd();

    if (this.platform === 'crazygames' && window.CrazyGames?.SDK?.ad?.requestAd) {
      this.lastMidgameAdTime = now;
      window.CrazyGames.SDK.ad.requestAd('midgame', {
        adStarted: () => {
          this._beforeAd();
        },
        adFinished: () => {
          this._afterAd();
          callback();
        },
        adError: (error) => {
          console.warn('[PortalBridge] CrazyGames midgame ad error:', error);
          this._afterAd();
          callback();
        }
      });
    } else if (this.platform === 'poki' && window.PokiSDK?.commercialBreak) {
      this.lastMidgameAdTime = now;
      window.PokiSDK.commercialBreak(() => {
        this._beforeAd();
      }).then(() => {
        this._afterAd();
        callback();
      }).catch((err) => {
        console.warn('[PortalBridge] Poki commercial break error:', err);
        this._afterAd();
        callback();
      });
    } else {
      this._afterAd();
      callback();
    }
  }

  /**
   * Request a Rewarded Video Ad (e.g. Revive Rickshaw with 100% Health)
   * User must voluntarily opt in.
   */
  showRewardedAd(onRewarded, onDismiss) {
    const successCb = typeof onRewarded === 'function' ? onRewarded : () => {};
    const dismissCb = typeof onDismiss === 'function' ? onDismiss : () => {};

    // Standalone / GitHub Pages fallback: instant reward with brief visual notification
    if (this.platform === 'standalone') {
      console.log('[PortalBridge] Standalone mode: simulated rewarded ad success.');
      successCb();
      return;
    }

    this._beforeAd();

    if (this.platform === 'crazygames' && window.CrazyGames?.SDK?.ad?.requestAd) {
      let rewarded = false;
      window.CrazyGames.SDK.ad.requestAd('rewarded', {
        adStarted: () => {
          this._beforeAd();
        },
        adFinished: () => {
          rewarded = true;
          this._afterAd();
          successCb();
        },
        adError: (error) => {
          console.warn('[PortalBridge] CrazyGames rewarded ad error:', error);
          this._afterAd();
          if (!rewarded) dismissCb();
        }
      });
    } else if (this.platform === 'poki' && window.PokiSDK?.rewardedBreak) {
      window.PokiSDK.rewardedBreak(() => {
        this._beforeAd();
      }).then((success) => {
        this._afterAd();
        if (success) {
          successCb();
        } else {
          dismissCb();
        }
      }).catch((err) => {
        console.warn('[PortalBridge] Poki rewarded break error:', err);
        this._afterAd();
        dismissCb();
      });
    } else {
      this._afterAd();
      successCb();
    }
  }

  _beforeAd() {
    this.adInProgress = true;
    const audio = window.gameAudio || (typeof gameAudio !== 'undefined' ? gameAudio : null);
    if (audio && typeof audio.getAudioStateMode === 'function') {
      this.savedAudioMode = audio.getAudioStateMode();
      // Mute audio during ad
      if (audio.masterGain && audio.ctx) {
        audio.masterGain.gain.setValueAtTime(0.0, audio.ctx.currentTime);
      }
    }
  }

  _afterAd() {
    this.adInProgress = false;
    const audio = window.gameAudio || (typeof gameAudio !== 'undefined' ? gameAudio : null);
    if (audio && this.savedAudioMode) {
      // Restore previous audio mode
      if (this.savedAudioMode === 'ALL_ON' || this.savedAudioMode === 'FX_ONLY') {
        if (audio.masterGain && audio.ctx) {
          audio.masterGain.gain.setValueAtTime(2.5, audio.ctx.currentTime);
        }
      }
      this.savedAudioMode = null;
    }
  }
}

// Global Singleton & Class Export
const portalBridge = new PortalBridge();
if (typeof window !== 'undefined') {
  window.PortalBridge = PortalBridge;
  window.portalBridge = portalBridge;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PortalBridge = PortalBridge;
  globalThis.portalBridge = portalBridge;
}
