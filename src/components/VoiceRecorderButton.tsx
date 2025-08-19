// src/components/VoiceRecorderButton.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Send, Lock as LockIcon, X, ChevronUp } from 'lucide-react';

type Props = {
  disabled?: boolean;
  maxDurationMs?: number;                 // défaut: 180s
  onRecorded: (file: File, durationSec: number) => void;
  desktopMode?: 'auto' | 'hold' | 'clickToLock'; // voir doc ci-dessous
};

type RecorderState = 'idle' | 'recording' | 'locked' | 'finishing';

const pickBestMime = () => {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2', // Safari (AAC)
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const t of candidates) {
    // @ts-ignore
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
};

const isMousePointer = (e: PointerEvent | React.PointerEvent) =>
  (e as any).pointerType === 'mouse' || ((e as any).pointerType === 'pen' && window.matchMedia?.('(pointer: fine)').matches);

export default function VoiceRecorderButton({
  disabled,
  maxDurationMs = 180_000,
  onRecorded,
  desktopMode = 'auto',
}: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [timer, setTimer] = useState(0);
  const [hint, setHint] = useState<'slide-cancel' | 'slide-lock' | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);

  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const lastPointerWasMouse = useRef(false);

  const lockThresholdPx = 70;
  const cancelThresholdPx = 70;

  const preferClickToLock = (isMouse: boolean) => {
    if (!isMouse) return false;
    if (desktopMode === 'hold') return false;
    if (desktopMode === 'clickToLock') return true;
    return true; // auto: souris => clic = verrouillé
  };

  const cleanup = () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    startTsRef.current = 0;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
      mediaStreamRef.current = null;
    }
    lockedRef.current = false;
    cancelledRef.current = false;
    startPointRef.current = null;
    setHint(null);
    setTimer(0);
  };

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (state === 'idle') return;
    containerRef.current?.focus({ preventScroll: true });
  }, [state]);

  const start = async () => {
    if (disabled || state !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickBestMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };

      rec.onstop = () => {
        const durMs = Date.now() - startTsRef.current;
        const wasCancelled = cancelledRef.current;

        // Annulation / tap trop court -> on nettoie et on revient idle
        if (wasCancelled || durMs < 350) {
          cleanup();
          setState('idle');
          return;
        }

        // OK -> on produit le fichier, puis on nettoie
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const durSec = Math.round(durMs / 1000);
        const nice = `${Math.floor(durSec/60)}:${String(durSec%60).padStart(2,'0')}`;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
        const file = new File([blob], `Note vocale (${nice}) ${ts}.${ext}`, { type: blob.type, lastModified: Date.now() });

        cleanup();
        setState('idle');
        onRecorded(file, durSec);
      };

      rec.start();
      startTsRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startTsRef.current;
        setTimer(ms);
        if (ms >= maxDurationMs && rec.state === 'recording') {
          setState('finishing');
          rec.stop();
        }
      }, 200);

      setState('recording');
      setHint('slide-cancel');
      navigator.vibrate?.(15);
    } catch (e) {
      console.error('[Voice] getUserMedia/MediaRecorder error:', e);
      cleanup();
      setState('idle');
      alert("Impossible d'accéder au micro. Vérifiez les autorisations du navigateur.");
    }
  };

  const stop = (send = true) => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (!send) cancelledRef.current = true;
    if (rec.state === 'recording') {
      setState('finishing');
      rec.stop();
    } else {
      cleanup();
      setState('idle');
    }
  };

  // Gestes
  const onPointerDown = async (e: React.PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    lastPointerWasMouse.current = isMousePointer(e);
    startPointRef.current = { x: e.clientX, y: e.clientY };
    await start();

    if (preferClickToLock(lastPointerWasMouse.current)) {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (state !== 'recording' || !startPointRef.current) return;
    const dx = e.clientX - startPointRef.current.x;
    const dy = e.clientY - startPointRef.current.y;
    if (!lockedRef.current && -dy > lockThresholdPx) {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
      navigator.vibrate?.(10);
      return;
    }
    if (!lockedRef.current) setHint(-dx > cancelThresholdPx ? 'slide-lock' : 'slide-cancel');
  };

  const onPointerUp = () => {
    if (preferClickToLock(lastPointerWasMouse.current)) {
      if (lockedRef.current) return;
      if (Date.now() - startTsRef.current < 200) return;
    }
    if (state === 'recording' && !lockedRef.current) stop(true);
  };

  // Actions / clavier
  const onCancel = () => { cancelledRef.current = true; stop(false); };
  const onLockNow = () => { if (state === 'recording') { lockedRef.current = true; setState('locked'); setHint(null); } };
  const onStopAndSend = () => stop(true);
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (state === 'idle') return;
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter')  { e.preventDefault(); onStopAndSend(); }
  };

  // UI helpers
  const mm = Math.floor(timer / 60000);
  const ss = String(Math.floor((timer % 60000) / 1000)).padStart(2, '0');
  const label = `${mm}:${ss}`;
  const idleTitle = (() => {
    const fine = window.matchMedia?.('(pointer: fine)')?.matches;
    if (fine && desktopMode !== 'hold') return 'Clic : enregistrer (verrouillé) • Entrée: envoyer • Échap: annuler';
    return 'Appui long pour enregistrer • Glissez ← pour annuler • Glissez ↑ pour verrouiller';
  })();

  // Styles utilitaires pour les icônes (touch target >= 44px)
  const iconBtn = "inline-flex items-center justify-center w-11 h-11 rounded-full";
  const ghost = "bg-gray-200 text-gray-700 hover:bg-gray-300";
  const primary = "bg-blue-600 text-white hover:bg-blue-700";

  return (
    <div
      ref={containerRef}
      className="relative outline-none touch-manipulation"
      tabIndex={state === 'idle' ? -1 : 0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state === 'idle' && (
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          disabled={disabled}
          className={`p-2 rounded-lg ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          aria-label="Enregistrer un message vocal"
          title={idleTitle}
        >
          <Mic size={20} />
        </button>
      )}

      {(state === 'recording' || state === 'locked' || state === 'finishing') && (
        <div className="flex items-center gap-2">
          {/* Pastille + chrono (compact) */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-600 text-white shadow">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="font-mono text-sm" aria-live="polite">{label}</span>
          </div>

          {/* Indice gestes (mobile, compact) */}
          {state === 'recording' && (
            <div className="hidden sm:block text-xs text-gray-500 select-none">
              {hint === 'slide-cancel' ? 'Glissez à gauche pour annuler' : 'Glissez vers le haut pour verrouiller'}
            </div>
          )}

          {/* === BARRE D’ACTIONS COMPACTE : icônes seules === */}
          {state === 'recording' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className={`${iconBtn} ${ghost}`}
                aria-label="Annuler l’enregistrement"
                title="Annuler"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                onClick={onLockNow}
                className={`${iconBtn} ${ghost}`}
                aria-label="Verrouiller l’enregistrement"
                title="Verrouiller"
              >
                <LockIcon size={18} />
              </button>
              <button
                type="button"
                onClick={onStopAndSend}
                className={`${iconBtn} ${primary}`}
                aria-label="Envoyer la note vocale"
                title="Envoyer"
              >
                <Send size={18} />
              </button>
            </div>
          )}

          {state === 'locked' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className={`${iconBtn} ${ghost}`}
                aria-label="Annuler l’enregistrement"
                title="Annuler"
              >
                <X size={18} />
              </button>
              <button
                type="button"
                onClick={onStopAndSend}
                className={`${iconBtn} ${primary}`}
                aria-label="Envoyer la note vocale"
                title="Envoyer"
              >
                <Send size={18} />
              </button>
              <span className="text-gray-400 ml-1 flex items-center gap-1 text-xs">
                <LockIcon size={12}/> verrouillé
              </span>
            </div>
          )}
        </div>
      )}

      {/* Aide visuelle mobile */}
      {state === 'recording' && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[11px] text-gray-400 sm:hidden">
          <span className="inline-flex items-center gap-1"><ChevronUp size={12}/> Verrouiller</span>
          <span>•</span>
          <span>Glissez ← pour annuler</span>
        </div>
      )}
    </div>
  );
}
