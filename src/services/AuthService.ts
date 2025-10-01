class AuthService {
  private static instance: AuthService;
  private readonly secretStorageKey = 'device-auth-secret';
  private deviceSecret: string | null = null;
  private sessionToken: string | null = null;
  private sessionExpiresAt: number | null = null;

  private constructor() {
    this.deviceSecret = this.loadOrCreateSecret();
  }

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private loadOrCreateSecret(): string {
    try {
      const existing = localStorage.getItem(this.secretStorageKey);
      if (existing && existing.length > 0) {
        return existing;
      }
    } catch {
      // ignore storage access issues – we'll generate a transient secret
    }

    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const secret = this.toBase64Url(randomBytes);
    try {
      localStorage.setItem(this.secretStorageKey, secret);
    } catch {
      // ignore persistence errors; secret will live in memory only
    }
    return secret;
  }

  private toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private async computeAuthKey(deviceId: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${deviceId}:${this.deviceSecret}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this.toBase64Url(digest);
  }

  private isSessionValid(): boolean {
    if (!this.sessionToken || !this.sessionExpiresAt) return false;
    const safetyMarginMs = 30_000; // refresh a little before actual expiry
    return Date.now() + safetyMarginMs < this.sessionExpiresAt;
  }

  async ensureSession(apiBaseUrl: string, deviceId: string): Promise<string> {
    if (this.isSessionValid()) {
      return this.sessionToken as string;
    }

    return this.requestNewSession(apiBaseUrl, deviceId);
  }

  private async requestNewSession(apiBaseUrl: string, deviceId: string): Promise<string> {
    const authKey = await this.computeAuthKey(deviceId);
    const response = await fetch(`${apiBaseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ deviceId, authKey }),
    });

    if (!response.ok) {
      throw new Error(`Auth session request failed: HTTP ${response.status}`);
    }

    const json = await response.json();
    const token = json?.sessionToken;
    const expiresAt = json?.expiresAt;
    if (!token || typeof token !== 'string') {
      throw new Error('Auth session response missing token');
    }

    this.sessionToken = token;
    this.sessionExpiresAt = typeof expiresAt === 'number' ? expiresAt : null;
    return token;
  }

  async getSessionToken(apiBaseUrl: string, deviceId: string): Promise<string> {
    return this.ensureSession(apiBaseUrl, deviceId);
  }

  getCachedSessionToken(): string | null {
    return this.sessionToken;
  }
}

export default AuthService;
