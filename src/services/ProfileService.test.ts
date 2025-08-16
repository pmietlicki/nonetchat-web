import { describe, it, expect, beforeEach, vi } from 'vitest';
import ProfileService from './ProfileService';

// --- Mocks ---

const mockDbService = {
  getAvatar: vi.fn(),
  saveAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
};

vi.mock('./IndexedDBService', () => ({
  default: {
    getInstance: () => mockDbService,
  },
}));

const mockLocalStorage = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => delete store[key],
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal('localStorage', mockLocalStorage);

// Mock uuid pour avoir un ID prédictible
vi.mock('uuid', () => ({
  v4: () => 'mock-device-id-12345',
}));

// --- Tests ---

describe('ProfileService', () => {
  let profileService: ProfileService;

  beforeEach(() => {
    // @ts-ignore - Reset singleton instance for test isolation
    ProfileService.instance = null;
    profileService = ProfileService.getInstance();
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  it('devrait générer un nouvel ID et retourner un profil vide au premier lancement', async () => {
    mockDbService.getAvatar.mockResolvedValue(null);

    const profile = await profileService.getProfile();

    expect(profile.id).toBe('mock-device-id-12345');
    expect(profile.name).toBeUndefined();
    expect(profile.avatarBlob).toBeNull();
  });

  it('devrait récupérer un profil existant depuis localStorage et l\'avatar depuis IndexedDB', async () => {
    const storedProfile = { name: 'John Doe', age: 30, gender: 'male' };
    mockLocalStorage.setItem('userProfile', JSON.stringify(storedProfile));
    const mockAvatarBlob = new Blob(['avatar-data'], { type: 'image/png' });
    mockDbService.getAvatar.mockResolvedValue(mockAvatarBlob);

    const profile = await profileService.getProfile();

    expect(profile.name).toBe('John Doe');
    expect(profile.age).toBe(30);
    expect(profile.avatarBlob).toBe(mockAvatarBlob);
  });

  it('devrait sauvegarder les données texte dans localStorage et l\'avatar dans IndexedDB', async () => {
    const profileData = { name: 'Jane Doe', age: 28 };
    const avatarFile = new File(['avatar-file'], 'avatar.png', { type: 'image/png' });

    await profileService.saveProfile(profileData, avatarFile);

    const stored = JSON.parse(mockLocalStorage.getItem('userProfile') || '{}');
    expect(stored.name).toBe('Jane Doe');
    expect(stored.age).toBe(28);

    expect(mockDbService.saveAvatar).toHaveBeenCalledWith('userAvatar', avatarFile);
  });

  it('devrait appeler le dbService pour supprimer l\'avatar personnalisé', async () => {
    await profileService.deleteCustomAvatar();
    expect(mockDbService.deleteAvatar).toHaveBeenCalledWith('userAvatar');
  });

  it('devrait retourner l\'avatar personnalisé en base64 pour la transmission', async () => {
    const mockAvatarBlob = new Blob(['avatar-data'], { type: 'image/png' });
    mockDbService.getAvatar.mockResolvedValue(mockAvatarBlob);

    const transmissionAvatar = await profileService.getAvatarForTransmission('pravatar-url');

    // Le résultat doit être une chaîne de données base64
    expect(transmissionAvatar).toMatch(/^data:image\/png;base64,/);
  });

  it('devrait retourner l\'URL pravatar si aucun avatar personnalisé n\'existe', async () => {
    mockDbService.getAvatar.mockResolvedValue(null);

    const transmissionAvatar = await profileService.getAvatarForTransmission('pravatar-url');

    expect(transmissionAvatar).toBe('pravatar-url');
  });
});