import { describe, it, expect, beforeEach, vi } from 'vitest';
import ProfileService from './ProfileService';
import { UserProfileRecord } from './IndexedDBService';

// --- Mocks ---

// Mock de la base de données en mémoire pour simuler IndexedDB
const mockDbStore: {
  user: UserProfileRecord | null;
  avatars: Map<string, any>;
} = {
  user: null,
  avatars: new Map(),
};

const mockDbService = {
  getUserProfile: vi.fn(async (id: string) => mockDbStore.user && mockDbStore.user.id === id ? mockDbStore.user : null),
  saveUserProfile: vi.fn(async (profile: UserProfileRecord) => { mockDbStore.user = profile; }),
  getAvatarBlobByHash: vi.fn(async (hash: string) => mockDbStore.avatars.get(hash)?.blob),
  saveAvatarByHash: vi.fn(async (rec: any) => { mockDbStore.avatars.set(rec.hash, rec); }),
  deleteAvatarByHash: vi.fn(async (hash: string) => { mockDbStore.avatars.delete(hash); }),
  // Mock des fonctions legacy pour les tests de migration (si nécessaire)
  getAvatar: vi.fn().mockResolvedValue(null),
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
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => delete store[key],
    clear: () => { store = {}; },
  };
})();

vi.stubGlobal('localStorage', mockLocalStorage);
vi.mock('uuid', () => ({ v4: () => 'mock-device-id-12345' }));

// --- Tests ---

describe('ProfileService', () => {
  let profileService: ProfileService;

  beforeEach(() => {
    // @ts-ignore - Reset singleton
    ProfileService.instance = null;
    profileService = ProfileService.getInstance();
    // Nettoyage des mocks avant chaque test
    mockLocalStorage.clear();
    vi.clearAllMocks();
    mockDbStore.user = null;
    mockDbStore.avatars.clear();
  });

  it('devrait créer un profil vide avec un ID au premier lancement', async () => {
    const profile = await profileService.getProfile();

    expect(profile.id).toBe('mock-device-id-12345');
    expect(profile.displayName).toBeUndefined();
    expect(profile.age).toBeUndefined();
    expect(profile.gender).toBeUndefined();
    expect(mockDbService.saveUserProfile).toHaveBeenCalled();
  });

  it('devrait sauvegarder et récupérer un profil complet avec nom, âge et genre', async () => {
    const profileData = {
      displayName: 'Jane Doe',
      age: 28,
      gender: 'female',
    };

    // 1. Sauvegarder le profil
    await profileService.saveProfile(profileData);

    // Vérifier que la sauvegarde a été appelée avec les bonnes données
    expect(mockDbService.saveUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mock-device-id-12345',
        displayName: 'Jane Doe',
        age: 28,
        gender: 'female',
      })
    );

    // 2. Récupérer le profil
    const retrievedProfile = await profileService.getProfile();

    // Vérifier les données récupérées
    expect(retrievedProfile.displayName).toBe('Jane Doe');
    expect(retrievedProfile.age).toBe(28);
    expect(retrievedProfile.gender).toBe('female');
  });

  it('devrait mettre à jour un profil existant sans écraser les champs non fournis', async () => {
    // Profil initial
    mockDbStore.user = {
      id: 'mock-device-id-12345',
      displayName: 'Old Name',
      age: 30,
      gender: 'male',
      avatarVersion: 1,
    };

    // Mise à jour partielle (juste le nom)
    await profileService.saveProfile({ displayName: 'New Name' });

    const updatedProfile = await profileService.getProfile();

    expect(updatedProfile.displayName).toBe('New Name');
    expect(updatedProfile.age).toBe(30); // L'âge ne doit pas avoir changé
    expect(updatedProfile.gender).toBe('male'); // Le genre ne doit pas avoir changé
  });

  it('devrait retourner un PublicProfile avec tous les champs', async () => {
    mockDbStore.user = {
      id: 'mock-device-id-12345',
      displayName: 'Public Person',
      age: 42,
      gender: 'other',
      avatarHash: 'hash123',
      avatarVersion: 3,
    };

    const publicProfile = await profileService.getPublicProfile();

    expect(publicProfile.displayName).toBe('Public Person');
    expect(publicProfile.age).toBe(42);
    expect(publicProfile.gender).toBe('other');
    expect(publicProfile.avatarHash).toBe('hash123');
  });

  it('devrait supprimer l\'avatar et incrémenter la version', async () => {
    mockDbStore.user = {
      id: 'mock-device-id-12345',
      displayName: 'Test',
      avatarHash: 'hash-to-delete',
      avatarVersion: 2,
    };

    await profileService.deleteCustomAvatar();

    expect(mockDbService.deleteAvatarByHash).toHaveBeenCalledWith('hash-to-delete');
    
    const updatedProfile = await profileService.getProfile();
    expect(updatedProfile.avatarHash).toBeUndefined();
    expect(updatedProfile.avatarVersion).toBe(3);
  });
});
