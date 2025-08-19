// src/components/FilePreview.tsx
import React, { useEffect, useRef, useState } from 'react';
import IndexedDBService from '../services/IndexedDBService';

type MsgLike = {
  id: string;
  fileData?: { name?: string; size?: number; type?: string };
};

const db = IndexedDBService.getInstance();

async function safeGetBlob(messageId: string): Promise<Blob | null> {
  try {
    return await db.getFileBlob(messageId);
  } catch (e: any) {
    if (String(e?.message || '').includes('Database not initialized')) {
      await IndexedDBService.getInstance().initialize();
      return await db.getFileBlob(messageId);
    }
    throw e;
  }
}

export default function FilePreview({ msg }: { msg: MsgLike }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [displayType, setDisplayType] = useState<string>('application/octet-stream');
  const [textSample, setTextSample] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
      if (objUrl) {
        try { URL.revokeObjectURL(objUrl); } catch {}
      }
    };
  }, [objUrl]);

  const load = async () => {
    if (loading || objUrl) return;
    setLoading(true);
    try {
      const blob = await safeGetBlob(msg.id);
      if (!blob) {
        alert('Fichier introuvable dans la base locale.');
        setLoading(false);
        return;
      }
      const type = msg.fileData?.type || blob.type || 'application/octet-stream';
      setDisplayType(type);

      // text-like: on extrait un aperçu (8 KB)
      if (/^(text\/|application\/(json|xml))/.test(type)) {
        const slice = blob.slice(0, 8192);
        const text = await slice.text();
        if (!mounted.current) return;
        setTextSample(text);
      }

      // pour image/video/audio/pdf on crée l’URL
      if (/^(image|video|audio)\//.test(type) || type === 'application/pdf') {
        const url = URL.createObjectURL(blob);
        if (!mounted.current) {
          try { URL.revokeObjectURL(url); } catch {}
          return;
        }
        setObjUrl(url);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const toggle = async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (!open) {
      await load();
      setOpen(true);
    } else {
      setOpen(false);
      if (objUrl) {
        try { URL.revokeObjectURL(objUrl); } catch {}
        setObjUrl(null);
      }
      setTextSample(null);
    }
  };

  const fileName = msg.fileData?.name || 'fichier';

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggle}
          className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
          aria-label={open ? 'Masquer l’aperçu' : 'Afficher l’aperçu'}
        >
          {open ? 'Masquer l’aperçu' : loading ? 'Chargement…' : 'Afficher l’aperçu'}
        </button>
        <span className="text-[11px] text-gray-500">
          {msg.fileData?.type || 'type inconnu'} • {msg.fileData?.size ? `${(msg.fileData.size/1024).toFixed(1)} KB` : 'taille inconnue'}
        </span>
      </div>

      {open && (
        <div className="mt-2 rounded overflow-hidden bg-white">
          {/* Images */}
          {/^image\//.test(displayType) && objUrl && (
            <img
              src={objUrl}
              alt={fileName}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="max-h-72 rounded object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}

          {/* Vidéos */}
          {/^video\//.test(displayType) && objUrl && (
            <video
              src={objUrl}
              controls
              preload="metadata"
              playsInline
              className="max-h-72 rounded"
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}

          {/* Audio */}
          {/^audio\//.test(displayType) && objUrl && (
            <audio
              src={objUrl}
              controls
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}

          {/* PDF */}
          {displayType === 'application/pdf' && (
            <div className="p-2 text-sm">
              {objUrl ? (
                <a
                  href={objUrl}
                  target="_blank"
                  rel="noopener"
                  className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  Ouvrir le PDF
                </a>
              ) : (
                <span className="text-gray-500">Aperçu PDF non disponible</span>
              )}
              <div className="text-[11px] text-gray-500 mt-1">Sur iOS, l’aperçu peut s’ouvrir dans un onglet.</div>
            </div>
          )}

          {/* Texte / JSON / XML */}
          {textSample !== null && (
            <pre
              className="max-h-72 overflow-auto bg-gray-50 p-2 text-xs rounded whitespace-pre-wrap break-words"
              onPointerDown={(e) => e.stopPropagation()}
            >
{String(textSample)}
            </pre>
          )}

          {/* Type inconnu */}
          {open && !objUrl && textSample === null && (
            <div className="p-2 text-sm text-gray-500">Aperçu indisponible pour ce type de fichier.</div>
          )}
        </div>
      )}
    </div>
  );
}
