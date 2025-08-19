// src/components/FilePreview.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import IndexedDBService from '../services/IndexedDBService';

type MsgLike = {
  id: string;
  fileData?: { name?: string; size?: number; type?: string };
};

type Props = {
  msg: MsgLike;
  /** Précharger l’aperçu image quand la bulle entre dans le viewport (sinon uniquement sur clic). */
  autoPreviewImagesOnVisible?: boolean;
  /** Reprendre la position audio au ré-écoute. */
  resumeAudio?: boolean;
  /** Utiliser Media Session API pour affichage écran verrouillé (Android) + contrôle basique. */
  enableMediaSession?: boolean;
};

/* ---------- Utils ---------- */
const fmtBytes = (n?: number) => {
  if (!n && n !== 0) return 'taille inconnue';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtTime = (s: number) => {
  if (!isFinite(s)) return '–:–';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
};

// Lazy helper pour éviter tout appel singleton au module load
async function safeGetBlob(messageId: string): Promise<Blob | null> {
  const db = IndexedDBService.getInstance();
  try {
    // @ts-ignore - selon ton service, getFileBlob peut être async
    return await db.getFileBlob(messageId);
  } catch (e: any) {
    if (String(e?.message || '').includes('Database not initialized')) {
      const db2 = IndexedDBService.getInstance();
      // @ts-ignore - initialize peut ne pas exister dans le mock
      if (typeof db2.initialize === 'function') {
        await db2.initialize();
      }
      // @ts-ignore
      return await db2.getFileBlob(messageId);
    }
    throw e;
  }
}

/* ---------- Component ---------- */
export default function FilePreview({
  msg,
  autoPreviewImagesOnVisible = false,
  resumeAudio = true,
  enableMediaSession = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [displayType, setDisplayType] = useState<string>('application/octet-stream');
  const [textSample, setTextSample] = useState<string | null>(null);

  // Audio state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number>(NaN);
  const [current, setCurrent] = useState<number>(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const [audioErr, setAudioErr] = useState<string | null>(null);

  const fileName = msg.fileData?.name || 'fichier';
  const fileType = useMemo(
    () => (msg.fileData?.type ? msg.fileData.type.split(';')[0].trim() : 'application/octet-stream'),
    [msg.fileData?.type]
  );

  const isImage = /^image\//.test(fileType);
  const isVideo = /^video\//.test(fileType);
  const isAudio = /^audio\//.test(fileType);
  const isPDF = fileType === 'application/pdf';
  const isTextLike = /^(text\/|application\/(json|xml))/.test(fileType);

  const audioPlayable = useMemo(() => {
    if (!isAudio) return false;
    const test = typeof document !== 'undefined' ? document.createElement('audio') : null;
    return !!test?.canPlayType && !!test.canPlayType(fileType);
  }, [isAudio, fileType]);

  /* ---------- Lifecycle & cleanup ---------- */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (objUrl) {
        try { URL.revokeObjectURL(objUrl); } catch {}
      }
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && enableMediaSession) {
        try {
          // @ts-ignore
          navigator.mediaSession.metadata = null;
          // @ts-ignore
          navigator.mediaSession.playbackState = 'none';
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver: détecte l’entrée dans le viewport
  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') return;
    const el = containerRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        const ent = entries[0];
        if (ent && ent.isIntersecting) setVisible(true);
      },
      { rootMargin: '100px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Auto-preview images au scroll si demandé (sans ouvrir la section)
  useEffect(() => {
    if (!autoPreviewImagesOnVisible || !visible || !isImage || objUrl || loading) return;
    void prefetchImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPreviewImagesOnVisible, visible, isImage]);

  /* ---------- Loaders ---------- */
  const loadBlob = async (): Promise<Blob | null> => {
    const blob = await safeGetBlob(msg.id);
    if (!blob) {
      alert('Fichier introuvable dans la base locale.');
      return null;
    }
    setDisplayType(msg.fileData?.type || blob.type || 'application/octet-stream');
    return blob;
  };

  const load = async () => {
    if (loading || objUrl || textSample !== null) return;
    setLoading(true);
    try {
      const blob = await loadBlob();
      if (!blob || !mounted.current) return;

      if (isTextLike) {
        const slice = blob.slice(0, 8192);
        const text = await slice.text();
        if (!mounted.current) return;
        setTextSample(text);
      }

      if (isImage || isVideo || isAudio || isPDF) {
        let finalBlob = blob;
        if (isPDF && blob.type !== 'application/pdf') {
          // On force le type MIME à PDF pour que le navigateur déclenche bien son viewer
          finalBlob = new Blob([blob], { type: 'application/pdf' });
        }
        const url = URL.createObjectURL(finalBlob);
        if (!mounted.current) { try { URL.revokeObjectURL(url); } catch {} return; }
        setObjUrl(url);
      }

    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const prefetchImage = async () => {
    try {
      const blob = await loadBlob();
      if (!blob || !mounted.current) return;
      if (!/^image\//.test(displayType)) return;
      const url = URL.createObjectURL(blob);
      if (!mounted.current) { try { URL.revokeObjectURL(url); } catch {} return; }
      setObjUrl(url);
    } catch {
      // silencieux
    }
  };

  const closePreview = () => {
    setOpen(false);
    if (objUrl) {
      try { URL.revokeObjectURL(objUrl); } catch {}
      setObjUrl(null);
    }
    setTextSample(null);
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
  };

  const toggle = async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!open) { await load(); setOpen(true); }
    else { closePreview(); }
  };

  /* ---------- Clipboard ---------- */
  const copyText = async () => {
    if (!textSample || typeof navigator === 'undefined') return;
    try { await navigator.clipboard.writeText(textSample); }
    catch { alert('Impossible de copier le texte dans le presse-papiers.'); }
  };

  /* ---------- Audio helpers ---------- */
  const audioKey = useMemo(() => `audioProgress:${msg.id}`, [msg.id]);

  useEffect(() => {
    if (!open || !isAudio || !resumeAudio) return;
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => {
      const p = Number(localStorage.getItem(audioKey));
      if (isFinite(p) && p > 0 && p < (a.duration || 9e9)) a.currentTime = p;
    };
    a.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => { a.removeEventListener('loadedmetadata', onLoaded); };
  }, [open, isAudio, resumeAudio, audioKey]);

  useEffect(() => {
    if (!open || !isAudio) return;
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => {
      setCurrent(a.currentTime || 0);
      if (resumeAudio) localStorage.setItem(audioKey, String(a.currentTime || 0));
    };
    const onLoadedMeta = () => setDuration(a.duration ?? NaN);
    const onRate = () => setRate(((a.playbackRate as 1 | 1.5 | 2) ?? 1));
    const onError = () => setAudioErr('Impossible de lire ce fichier audio.');

    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onLoadedMeta);
    a.addEventListener('ratechange', onRate);
    a.addEventListener('error', onError);

    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onLoadedMeta);
      a.removeEventListener('ratechange', onRate);
      a.removeEventListener('error', onError);
    };
  }, [open, isAudio, resumeAudio, audioKey]);

  // Media Session (Android/Chrome) pour audio/vidéo
  useEffect(() => {
    if (!enableMediaSession || !open || (!isAudio && !isVideo)) return;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const title = fileName;
    // @ts-ignore
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title,
      artist: 'NoNetChat',
      album: 'Pièces jointes',
      artwork: [],
    });
    // @ts-ignore
    navigator.mediaSession.playbackState = 'playing';

    // @ts-ignore
    navigator.mediaSession.setActionHandler?.('seekbackward', (details: any) => {
      const delta = details?.seekOffset || 10;
      const el = isAudio ? audioRef.current : null;
      if (el) el.currentTime = Math.max(0, el.currentTime - delta);
    });
    // @ts-ignore
    navigator.mediaSession.setActionHandler?.('seekforward', (details: any) => {
      const delta = details?.seekOffset || 10;
      const el = isAudio ? audioRef.current : null;
      if (el && isFinite(el.duration)) el.currentTime = Math.min(el.duration, el.currentTime + delta);
    });

    return () => {
      try {
        // @ts-ignore
        navigator.mediaSession.metadata = null;
        // @ts-ignore
        navigator.mediaSession.playbackState = 'none';
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableMediaSession, open, isAudio, isVideo, fileName]);

  /* ---------- Render ---------- */
  return (
    <div ref={containerRef} className="mt-2 select-text" onPointerDown={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggle}
          className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
          aria-label={open ? 'Masquer l’aperçu' : 'Afficher l’aperçu'}
        >
          {open ? 'Masquer l’aperçu' : loading ? 'Chargement…' : 'Afficher l’aperçu'}
        </button>
        <span className="text-[11px] text-gray-500">
          {fileType || 'type inconnu'} • {fmtBytes(msg.fileData?.size)}
        </span>
        {objUrl && (
          <a
            href={objUrl}
            download={fileName}
            className="ml-auto px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={(e) => e.stopPropagation()}
          >
            Télécharger
          </a>
        )}
      </div>

      {/* Body */}
      {open && (
        <div className="mt-2 rounded bg-white border border-gray-100 p-2">
          {/* Images */}
          {isImage && objUrl && (
            <img
              src={objUrl}
              alt={fileName}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="max-h-80 w-full object-contain rounded"
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* Vidéos */}
          {isVideo && objUrl && (
            <video
              src={objUrl}
              controls
              preload="metadata"
              playsInline
              className="max-h-80 w-full rounded bg-black"
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}

          {/* Audio amélioré */}
          {isAudio && (
            <div className="p-1">
              {!audioPlayable && (
                <div className="text-sm text-amber-600 mb-2">
                  Ce format audio n’est peut-être pas lisible dans ce navigateur. Vous pouvez le télécharger ci-dessus.
                </div>
              )}
              {objUrl && audioPlayable && (
                <>
                  <audio
                    ref={audioRef}
                    src={objUrl}
                    controls
                    preload="metadata"
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span>
                      {fmtTime(current)} / {fmtTime(duration)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = audioRef.current; if (!a) return;
                        a.currentTime = Math.max(0, (a.currentTime || 0) - 10);
                      }}
                      className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300"
                    >
                      ⟲ 10s
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = audioRef.current; if (!a) return;
                        const end = isFinite(a.duration) ? a.duration : a.currentTime + 10;
                        a.currentTime = Math.min(end, (a.currentTime || 0) + 10);
                      }}
                      className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300"
                    >
                      ⟳ 10s
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = audioRef.current; if (!a) return;
                        const next: 1 | 1.5 | 2 = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
                        a.playbackRate = next;
                        setRate(next);
                      }}
                      className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300"
                      aria-label="Changer la vitesse"
                    >
                      {rate}×
                    </button>
                  </div>
                </>
              )}
              {audioErr && <div className="text-sm text-red-600 mt-1">{audioErr}</div>}
            </div>
          )}

          {/* PDF */}
          {isPDF && objUrl && (
            <div className="space-y-2">
              <iframe
                src={objUrl}
                title={fileName}
                className="w-full h-80 border rounded"
              />
              <a
                href={objUrl}
                target="_blank"
                rel="noopener"
                className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Ouvrir dans un onglet
              </a>
            </div>
          )}


          {/* Texte / JSON / XML */}
          {textSample !== null && (
            <div className="relative">
              <pre className="max-h-80 overflow-auto bg-gray-50 p-2 text-xs rounded whitespace-pre-wrap break-words">
                {String(textSample)}
              </pre>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); void copyText(); }}
                  className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
                >
                  Copier le texte
                </button>
              </div>
            </div>
          )}

          {/* Type inconnu */}
          {!isImage && !isVideo && !isAudio && !isPDF && textSample === null && (
            <div className="p-2 text-sm text-gray-500">Aperçu indisponible pour ce type de fichier.</div>
          )}
        </div>
      )}
    </div>
  );
}
