// src/components/VoiceRecorderButton.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Lock, ChevronUp, X } from 'lucide-react';

type Props = {
  disabled?: boolean;
  maxDurationMs?: number;          // par défaut 180 s
  onRecorded: (file: File, durationSec: number) => void;
};

type RecorderState = 'idle' | 'recording' | 'locked' | 'finishing';

const pickBestMime = () => {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mpeg'
  ];
  for (const t of candidates) {
    // @ts-ignore
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return ''; // laisser le browser décider
};

export default function VoiceRecorderButton({ disabled, maxDurationMs = 180_000, onRecorded }: Props) {
  const [state, setState] = useState<RecorderState>('idle');
  const [timer, setTimer] = useState(0); // ms
  const [hint, setHint] = useState<'slide-cancel' | 'slide-lock' | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);
  const lockThresholdPx = 70;     // slide vers le haut
  const cancelThresholdPx = 70;   // slide vers la gauche
  const startPointRef = useRef<{x: number; y: number} | null>(null);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);

  // clear all resources
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

  const start = async () => {
    if (disabled || state !== 'idle') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickBestMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        if (cancelledRef.current) return;
        const durMs = Date.now() - startTsRef.current;
        if (durMs < 350) { // anti clic accidentel
          cleanup();
          setState('idle');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext = blob.type.includes('mp4') ? 'm4a' :
                    blob.type.includes('mpeg') ? 'mp3' :
                    blob.type.includes('ogg') ? 'ogg' : 'webm';
        const durSec = Math.round(durMs / 1000);
        const nice = `${Math.floor(durSec/60)}:${String(durSec%60).padStart(2,'0')}`;
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
        const fname = `Note vocale (${nice}) ${ts}.${ext}`;
        const file = new File([blob], fname, { type: blob.type, lastModified: Date.now() });

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
      if (navigator.vibrate) navigator.vibrate(15);
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

  // pointer gestures
  const onPointerDown = async (e: React.PointerEvent) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startPointRef.current = { x: e.clientX, y: e.clientY };
    await start();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (state !== 'recording' || !startPointRef.current) return;
    const dx = e.clientX - startPointRef.current.x;
    const dy = e.clientY - startPointRef.current.y;

    if (!lockedRef.current && -dy > lockThresholdPx) {
      lockedRef.current = true;
      setState('locked');
      setHint(null);
      if (navigator.vibrate) navigator.vibrate(10);
      return;
    }
    if (!lockedRef.current) {
      if (-dx > cancelThresholdPx) {
        setHint('slide-lock'); // juste pour changer l’indication
      } else {
        setHint('slide-cancel');
      }
    }
  };

  const onPointerUp = () => {
    if (state === 'recording' && !lockedRef.current) {
      // relâcher = envoyer
      stop(true);
    }
  };

  // locked state controls
  const onCancel = () => {
    cancelledRef.current = true;
    stop(false);
  };
  const onStopAndSend = () => stop(true);

  const mm = Math.floor(timer / 60000);
  const ss = String(Math.floor((timer % 60000) / 1000)).padStart(2, '0');
  const label = `${mm}:${ss}`;

  return (
    <div className="relative">
      {state === 'idle' && (
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          disabled={disabled}
          className={`p-2 rounded-lg ${disabled ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          aria-label="Appui long pour enregistrer"
          title="Appui long pour enregistrer"
        >
          <Mic size={20} />
        </button>
      )}

      {(state === 'recording' || state === 'locked' || state === 'finishing') && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-600 text-white shadow">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="font-mono text-sm">{label}</span>
          </div>

          {state === 'recording' && (
            <div className="text-xs text-gray-500 select-none">
              {hint === 'slide-cancel' ? 'Glissez à gauche pour annuler' : 'Glissez vers le haut pour verrouiller'}
            </div>
          )}

          {state === 'locked' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCancel}
                className="px-2 py-1 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 flex items-center gap-1"
                title="Annuler"
              >
                <X size={14} /> Annuler
              </button>
              <button
                type="button"
                onClick={onStopAndSend}
                className="px-2 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
                title="Envoyer"
              >
                <Square size={14} /> Envoyer
              </button>
              <span className="text-gray-400 ml-2 flex items-center gap-1 text-xs"><Lock size={12}/> verrouillé</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
