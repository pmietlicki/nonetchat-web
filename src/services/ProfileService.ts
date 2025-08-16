import { v4 as uuidv4 } from 'uuid';
import IndexedDBService, { AvatarRecord as IDBAvatarRecord, UserProfileRecord } from './IndexedDBService';

const PROFILE_KEY = 'userProfile';   // legacy localStorage (migration)
const AVATAR_KEY = 'userAvatar';     // legacy avatars store key
const DEVICE_ID_KEY = 'deviceId';

export type PublicProfile = {
  id: string;
  displayName?: string;
  name?: string; // alias compat UI
  avatarHash?: string;
  avatarMime?: string;
  avatarW?: number;
  avatarH?: number;
  avatarVersion?: number;
  age?: number;
  gender?: 'male' | 'female' | 'other';
};

class ProfileService {
  private static instance: ProfileService;
  private db = IndexedDBService.getInstance();

  public static getInstance(): ProfileService {
    if (!ProfileService.instance) {
      ProfileService.instance = new ProfileService();
    }
    return ProfileService.instance;
  }

  // --------------------------- Utils ---------------------------

  private ensureDeviceId(): string {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

  private pravatarUrl(id: string, v: number = 1, size = 150): string {
    return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(id)}&v=${v}`;
  }

  private async blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // toBlob robuste (évite le narrowing "never") + fallback via dataURL
  private async toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
    if (typeof canvas.toBlob === 'function') {
      return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob()), mime, quality);
      });
    }
    try {
      const url = canvas.toDataURL(mime, quality);
      const base64 = url.split(',')[1] || '';
      const bin = atob(base64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch {
      return new Blob();
    }
  }

  private async sha256Hex(ab: ArrayBuffer): Promise<string> {
    const d = await (globalThis.crypto as Crypto).subtle.digest('SHA-256', ab);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Validation/sanitization soft des PII
  private sanitizeAge(v: any): number | undefined {
    if (typeof v !== 'number') return undefined;
    if (!Number.isFinite(v)) return undefined;
    const n = Math.floor(v);
    return n > 0 && n < 120 ? n : undefined;
  }
  private sanitizeGender(g: any): 'male' | 'female' | 'other' | undefined {
    return g === 'male' || g === 'female' || g === 'other' ? g : undefined;
  }

  /**
   * Redimensionne/compresse l’avatar et retourne l’enregistrement prêt pour IndexedDB (hash = id).
   * - maxSide: 256 recommandé pour l’UI, génère typiquement 10–50KB
   */
  async preprocessAvatar(file: File, maxSide = 256, preferredMime = 'image/webp', quality = 0.85): Promise<IDBAvatarRecord> {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);

    const blob = await this.toBlob(canvas, preferredMime, quality);
    const ab = await blob.arrayBuffer();
    const hash = await this.sha256Hex(ab);

    return { hash, blob, mime: blob.type, width: w, height: h };
  }

  /**
   * Produit une miniature encore plus petite (ex. 96px) en dataURL pour transmission ponctuelle (≲ 12KB).
   */
  private async makeTinyThumbDataUrl(srcBlob: Blob, maxSide = 96, mime = 'image/webp', quality = 0.8): Promise<string> {
    const bmp = await createImageBitmap(srcBlob);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const tiny = await this.toBlob(canvas, mime, quality);
    return this.blobToDataURL(tiny);
  }

  // --------------------------- Migration ---------------------------

  /**
   * Migre l’ancien profil (localStorage PROFILE_KEY + avatars store avec AVATAR_KEY)
   * vers la store IndexedDB 'user' + avatars par hash.
   */
  private async migrateIfNeeded(deviceId: string): Promise<UserProfileRecord> {
    // Profil déjà en base ?
    const existing = await this.db.getUserProfile(deviceId);
    if (existing) return existing;

    // Migration depuis localStorage (profil legacy : name/age/gender)
    const legacyProfileRaw = localStorage.getItem(PROFILE_KEY);
    let legacy: any = {};
    try { legacy = legacyProfileRaw ? JSON.parse(legacyProfileRaw) : {}; } catch {}

    const displayName: string | undefined =
      typeof legacy.displayName === 'string' && legacy.displayName.trim()
        ? legacy.displayName.trim()
        : (typeof legacy.name === 'string' && legacy.name.trim() ? legacy.name.trim() : undefined);

    const profile: UserProfileRecord = {
      id: deviceId,
      displayName,
      age: this.sanitizeAge(legacy.age),
      gender: this.sanitizeGender(legacy.gender),
      avatarVersion: 1,
      // avatar* seront définis si on migre un avatar ci-dessous
    };

    // Migration de l’avatar legacy si présent
    const legacyAvatar = await this.db.getAvatar(AVATAR_KEY);
    if (legacyAvatar) {
      const tmpFile = new File([legacyAvatar], 'legacy-avatar', { type: legacyAvatar.type || 'image/webp' });
      const rec = await this.preprocessAvatar(tmpFile, 256);
      await this.db.saveAvatarByHash(rec);
      profile.avatarHash = rec.hash;
      profile.avatarMime = rec.mime;
      profile.avatarW = rec.width;
      profile.avatarH = rec.height;
      profile.avatarVersion = 2; // bump pour invalider pravatar distant
      // Optionnel : nettoyage legacy
      // await this.db.deleteAvatar(AVATAR_KEY);
    }

    await this.db.saveUserProfile(profile);
    return profile;
  }

  // --------------------------- API publique ---------------------------

  /**
   * Retourne le profil local (avec un Blob optionnel pour l’affichage local).
   * Structure de retour compatible avec l’existant.
   */
  async getProfile(): Promise<Partial<PublicProfile> & { id: string; avatarBlob?: Blob | null }> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);

    let avatarBlob: Blob | undefined = undefined;
    if (p.avatarHash) {
      avatarBlob = await this.db.getAvatarBlobByHash(p.avatarHash);
    } else {
      // fallback legacy
      const legacy = await this.db.getAvatar(AVATAR_KEY);
      avatarBlob = legacy || undefined;
    }

    return {
      id: p.id,
      displayName: p.displayName,
      name: p.displayName, // alias compat UI
      avatarHash: p.avatarHash,
      avatarMime: p.avatarMime,
      avatarW: p.avatarW,
      avatarH: p.avatarH,
      avatarVersion: p.avatarVersion,
      age: p.age,
      gender: p.gender,
      avatarBlob: avatarBlob ?? null,
    };
  }

  /**
   * Persiste le profil (texte) et, si fourni, un nouvel avatar (compressé + hashé), en bumpant avatarVersion.
   */
  async saveProfile(
    profileData: Partial<{ displayName: string; age: number; gender: 'male' | 'female' | 'other' }>,
    avatarFile?: File
  ): Promise<void> {
    const deviceId = this.ensureDeviceId();
    const current = await this.migrateIfNeeded(deviceId);
    const next: UserProfileRecord = { ...current };

    if ('displayName' in profileData) {
      const dn = (profileData.displayName || '').trim();
      next.displayName = dn || undefined;
    }
    if ('age' in profileData) {
      next.age = this.sanitizeAge(profileData.age);
    }
    if ('gender' in profileData) {
      next.gender = this.sanitizeGender(profileData.gender);
    }

    if (avatarFile) {
      const rec = await this.preprocessAvatar(avatarFile, 256);
      await this.db.saveAvatarByHash(rec);
      next.avatarHash = rec.hash;
      next.avatarMime = rec.mime;
      next.avatarW = rec.width;
      next.avatarH = rec.height;
      next.avatarVersion = (current.avatarVersion || 1) + 1;
    }

    await this.db.saveUserProfile(next);

    // Maintien compat localStorage (utile si d’autres écrans s’y réfèrent encore)
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        displayName: next.displayName ?? '',
        age: typeof next.age === 'number' ? next.age : undefined,
        gender: next.gender ?? undefined,
      })
    );
  }

  /**
   * Donne une URL d’affichage locale :
   * - Si avatarHash présent et blob disponible : ObjectURL du blob local
   * - Sinon : pravatar déterministe invalidé par avatarVersion
   */
  async getDisplayAvatarUrl(): Promise<string> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);

    if (p.avatarHash) {
      const blob = await this.db.getAvatarBlobByHash(p.avatarHash);
      if (blob) return URL.createObjectURL(blob);
    }
    return this.pravatarUrl(p.id, p.avatarVersion || 1, 150);
  }

  /**
   * Retourne un profil “public” à diffuser (métadonnées légères uniquement).
   */
  async getPublicProfile(): Promise<PublicProfile> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);

    return {
      id: p.id,
      displayName: p.displayName,
      name: p.displayName, // alias compat pour consommateurs existants
      avatarHash: p.avatarHash,
      avatarMime: p.avatarMime,
      avatarW: p.avatarW,
      avatarH: p.avatarH,
      avatarVersion: p.avatarVersion,
      age: p.age,
      gender: p.gender,
    };
  }

  /**
   * Convertit l’avatar actuel en Base64 (legacy UI). Préfère getDisplayAvatarUrl() pour l’UI.
   */
  async getAvatarAsBase64(): Promise<string | null> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);

    try {
      if (p.avatarHash) {
        const blob = await this.db.getAvatarBlobByHash(p.avatarHash);
        return blob ? await this.blobToDataURL(blob) : null;
      }
      // fallback legacy
      const legacy = await this.db.getAvatar(AVATAR_KEY);
      return legacy ? await this.blobToDataURL(legacy) : null;
    } catch (error) {
      console.error('Error converting avatar to Base64:', error);
      return null;
    }
  }

  /**
   * Supprime l’avatar personnalisé et bump avatarVersion (pour invalider le cache distant).
   */
  async deleteCustomAvatar(): Promise<void> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);
    const next: UserProfileRecord = { ...p };

    if (p.avatarHash) {
      await this.db.deleteAvatarByHash(p.avatarHash);
    }
    next.avatarHash = undefined;
    next.avatarMime = undefined;
    next.avatarW = undefined;
    next.avatarH = undefined;
    next.avatarVersion = (p.avatarVersion || 1) + 1;

    await this.db.saveUserProfile(next);

    // legacy cleanup (optionnel)
    // await this.db.deleteAvatar(AVATAR_KEY);
  }

  /**
   * Avatar pour transmission réseau : renvoie une *petite miniature* dataURL (≈96px) si avatar custom,
   * sinon renvoie l’URL pravatar. À utiliser de manière parcimonieuse (ne pas l’inclure dans les messages de découverte).
   */
  async getAvatarForTransmission(pravagarUrl?: string): Promise<string | null> {
    const deviceId = this.ensureDeviceId();
    const p = await this.migrateIfNeeded(deviceId);

    try {
      if (p.avatarHash) {
        const blob = await this.db.getAvatarBlobByHash(p.avatarHash);
        if (!blob) return null;
        // Miniature très légère pour limiter la charge réseau
        return await this.makeTinyThumbDataUrl(blob, 96);
      }
      return pravagarUrl ?? this.pravatarUrl(p.id, p.avatarVersion || 1, 96);
    } catch (error) {
      console.error('Error getting avatar for transmission:', error);
      return pravagarUrl ?? this.pravatarUrl(p.id, p.avatarVersion || 1, 96);
    }
  }
}

export default ProfileService;
