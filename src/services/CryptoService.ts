import IndexedDBService from './IndexedDBService';

// Récupère une implémentation de WebCrypto valide :
// - Browser: globalThis.crypto / window.crypto
// - Tests Node: require('node:crypto').webcrypto (sans casser le bundling navigateur)
function getCrypto(): Crypto {
  const existing =
    (globalThis as any).crypto ??
    (typeof window !== 'undefined' ? (window as any).crypto : undefined);

  if (existing) return existing as Crypto;

  // Fallback Node (Vitest / Node >= 16.5)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webcrypto } = require('node:crypto');
    // Expose pour éviter de refaire la résolution
    (globalThis as any).crypto = webcrypto;
    return webcrypto as unknown as Crypto;
  } catch {
    throw new Error('WebCrypto API is not available in this environment.');
  }
}

const cryptoAPI = getCrypto();
const subtle = cryptoAPI.subtle;

class CryptoService {
  private static instance: CryptoService;
  private dbService: IndexedDBService;
  private keyPair: CryptoKeyPair | null = null;
  private sharedSecrets: Map<string, CryptoKey> = new Map();

  private constructor() {
    this.dbService = IndexedDBService.getInstance();
  }

  public static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  async initialize(): Promise<void> {
    const storedKeys = await this.dbService.getCryptoKeys();
    if (storedKeys) {
      const publicKey = await subtle.importKey(
        'jwk',
        storedKeys.publicKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      const privateKey = await subtle.importKey(
        'jwk',
        storedKeys.privateKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
      );
      this.keyPair = { publicKey, privateKey };
    } else {
      await this.generateKeys();
    }
  }

  private async generateKeys(): Promise<void> {
    this.keyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );

    const publicKeyJwk = await subtle.exportKey('jwk', this.keyPair.publicKey!);
    const privateKeyJwk = await subtle.exportKey('jwk', this.keyPair.privateKey!);

    await this.dbService.saveCryptoKeys({ publicKey: publicKeyJwk, privateKey: privateKeyJwk });
  }

  async getPublicKeyJwk(): Promise<JsonWebKey | null> {
    if (!this.keyPair) return null;
    return await subtle.exportKey('jwk', this.keyPair.publicKey!);
  }

  async deriveSharedSecret(peerId: string, peerPublicKeyJwk: JsonWebKey): Promise<void> {
    const peerPublicKey = await subtle.importKey(
      'jwk',
      peerPublicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    const sharedSecret = await subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      this.keyPair!.privateKey!,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    this.sharedSecrets.set(peerId, sharedSecret);
  }

  async encryptMessage(peerId: string, message: string): Promise<string> {
    const secretKey = this.sharedSecrets.get(peerId);
    if (!secretKey) throw new Error('Shared secret not derived for this peer');

    const iv = cryptoAPI.getRandomValues(new Uint8Array(12));
    const encodedMessage = new TextEncoder().encode(message);

    const encryptedData = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      secretKey,
      encodedMessage
    );

    const bufferToBase64 = (buffer: ArrayBuffer | Uint8Array) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer as ArrayBuffer)));

    return JSON.stringify({
      iv: bufferToBase64(iv),
      data: bufferToBase64(encryptedData),
    });
  }

  async decryptMessage(peerId: string, jsonPayload: string): Promise<string> {
    const secretKey = this.sharedSecrets.get(peerId);
    if (!secretKey) throw new Error('Shared secret not derived for this peer');

    try {
      const payload = JSON.parse(jsonPayload);
      const base64ToBuffer = (base64: string) =>
        Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const iv = base64ToBuffer(payload.iv);
      const data = base64ToBuffer(payload.data);

      const decryptedData = await subtle.decrypt(
        { name: 'AES-GCM', iv },
        secretKey,
        data
      );

      return new TextDecoder().decode(decryptedData);
    } catch (error) {
      console.error('Decryption failed:', error);
      return 'Failed to decrypt message';
    }
  }

  // Compresser un fichier avec gzip
  private async compressFile(file: Blob): Promise<Blob> {
    if (typeof (globalThis as any).CompressionStream === 'undefined' || !file.stream) {
      console.warn('CompressionStream API not supported, skipping compression.');
      return file;
    }
    try {
      const stream = new (globalThis as any).CompressionStream('gzip');
      const compressedStream = (file as any).stream().pipeThrough(stream);
      return new Response(compressedStream).blob();
    } catch (error) {
      console.warn('Compression non supportée, fichier non compressé:', error);
      return file;
    }
  }

  // Décompresser un fichier avec gzip
  private async decompressFile(compressedBlob: Blob): Promise<Blob> {
    if (typeof (globalThis as any).DecompressionStream === 'undefined' || !compressedBlob.stream) {
      console.warn('DecompressionStream API not supported, skipping decompression.');
      return compressedBlob;
    }
    try {
      const stream = new (globalThis as any).DecompressionStream('gzip');
      const decompressedStream = (compressedBlob as any).stream().pipeThrough(stream);
      return new Response(decompressedStream).blob();
    } catch (error) {
      console.warn('Décompression échouée, retour du fichier original:', error);
      return compressedBlob;
    }
  }

  async encryptFile(file: File): Promise<Blob> {
    try {
      const compressedFile = await this.compressFile(file);

      console.log(
        `Compression: ${file.size} bytes -> ${compressedFile.size} bytes (${Math.round(
          (1 - compressedFile.size / file.size) * 100
        )}% de réduction)`
      );

      const key = await subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const iv = cryptoAPI.getRandomValues(new Uint8Array(12));

      const fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(compressedFile);
      });

      const dataToEncrypt = new Uint8Array(fileBuffer);

      const encryptedData = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataToEncrypt
      );

      const exportedKey = await subtle.exportKey('raw', key);

      const originalSize = new Uint8Array(4);
      new DataView(originalSize.buffer).setUint32(0, file.size, true);

      const header = new Uint8Array(12 + 32 + 4); // 12 IV + 32 key + 4 size
      header.set(iv, 0);
      header.set(new Uint8Array(exportedKey), 12);
      header.set(originalSize, 44);

      const result = new Uint8Array(header.length + encryptedData.byteLength);
      result.set(header, 0);
      result.set(new Uint8Array(encryptedData), header.length);

      return new Blob([result]);
    } catch (error) {
      console.error('Erreur lors du chiffrement du fichier:', error);
      throw error;
    }
  }

  async decryptFile(encryptedBlob: Blob): Promise<Blob> {
    try {
      const encryptedBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(encryptedBlob);
      });
      const encryptedArray = new Uint8Array(encryptedBuffer);

      const iv = encryptedArray.slice(0, 12);
      const keyData = encryptedArray.slice(12, 44);
      const originalSizeData = encryptedArray.slice(44, 48);
      // originalSize est disponible si besoin
      const _originalSize = new DataView(originalSizeData.buffer).getUint32(0, true);

      const encryptedData = encryptedArray.slice(48);

      const key = await subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decryptedData = await subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedData
      );

      const compressedBlob = new Blob([decryptedData]);
      const decompressedBlob = await this.decompressFile(compressedBlob);

      console.log(`Décompression: ${compressedBlob.size} bytes -> ${decompressedBlob.size} bytes`);

      return decompressedBlob;
    } catch (error) {
      console.error('Erreur lors du déchiffrement du fichier:', error);
      throw error;
    }
  }
}

export default CryptoService;
