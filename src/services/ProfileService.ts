import { v4 as uuidv4 } from 'uuid';
import { User } from '../types';
import IndexedDBService from './IndexedDBService';

const PROFILE_KEY = 'userProfile';
const AVATAR_KEY = 'userAvatar';
const DEVICE_ID_KEY = 'deviceId';

class ProfileService {
  private static instance: ProfileService;
  private dbService: IndexedDBService;

  private constructor() {
    this.dbService = IndexedDBService.getInstance();
  }

  public static getInstance(): ProfileService {
    if (!ProfileService.instance) {
      ProfileService.instance = new ProfileService();
    }
    return ProfileService.instance;
  }

  async getProfile(): Promise<Partial<User>> {
    // Get or create stable device ID
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    // Récupérer les données textuelles du localStorage
    const profileData = localStorage.getItem(PROFILE_KEY);
    const profile: Partial<User> = profileData ? JSON.parse(profileData) : {};
    profile.id = deviceId; // Ensure the profile always has the stable ID
    console.log('Profile loaded with stable ID:', profile);

    // Récupérer l'avatar depuis IndexedDB
    try {
      const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
      if (avatarBlob) {
        // Nettoyer l'ancienne URL blob avant d'en créer une nouvelle
        await this.clearAvatarCache();
        this.currentAvatarUrl = URL.createObjectURL(avatarBlob);
        profile.avatar = this.currentAvatarUrl;
        console.log('Avatar loaded from IndexedDB:', avatarBlob.size, 'bytes');
      } else {
        console.log('No avatar found in IndexedDB');
        if (profile.id) {
          // Si aucun avatar personnalisé n'est trouvé, utiliser l'avatar par défaut
          profile.avatar = `https://i.pravatar.cc/150?u=${profile.id}`;
          console.log('Using default avatar:', profile.avatar);
        }
      }
    } catch (error) {
      console.error('Error loading avatar from IndexedDB:', error);
      // En cas d'erreur, utiliser l'avatar par défaut si on a un ID
      if (profile.id) {
        profile.avatar = `https://i.pravatar.cc/150?u=${profile.id}`;
        console.log('Using default avatar after error:', profile.avatar);
      }
    }

    return profile;
  }

  async saveProfile(profileData: Partial<User>, avatarFile?: File): Promise<void> {
    // Sauvegarder les données textuelles dans le localStorage
    const { avatar, ...textData } = profileData;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(textData));
    console.log('Profile data saved to localStorage:', textData);

    // Sauvegarder le nouveau fichier avatar dans IndexedDB seulement si un nouveau fichier est fourni
    if (avatarFile) {
      try {
        // Nettoyer l'ancienne URL blob si elle existe
        await this.clearAvatarCache();
        await this.dbService.saveAvatar(AVATAR_KEY, avatarFile);
        console.log('Avatar saved to IndexedDB:', avatarFile.name, avatarFile.size, 'bytes');
      } catch (error) {
        console.error('Error saving avatar to IndexedDB:', error);
      }
    } else {
      console.log('No new avatar file provided, keeping existing avatar');
    }
    // Note: Si aucun nouveau fichier n'est fourni, l'avatar existant dans IndexedDB est préservé
  }

  private currentAvatarUrl: string | null = null;

  async clearAvatarCache(): Promise<void> {
    // Révoquer l'URL blob actuelle pour libérer la mémoire
    if (this.currentAvatarUrl && this.currentAvatarUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentAvatarUrl);
      this.currentAvatarUrl = null;
      console.log('Avatar blob URL revoked');
    }
  }

  // Méthode pour convertir une image en Base64 pour l'envoi via WebRTC
  async getAvatarAsBase64(): Promise<string | null> {
    try {
      const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
      if (!avatarBlob) {
        console.log('No avatar blob found for Base64 conversion');
        return null;
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          console.log('Avatar converted to Base64:', base64.substring(0, 50) + '...');
          resolve(base64);
        };
        reader.onerror = (error) => {
          console.error('Error reading avatar as Base64:', error);
          reject(error);
        };
        reader.readAsDataURL(avatarBlob);
      });
    } catch (error) {
      console.error('Error converting avatar to Base64:', error);
      return null;
    }
  }
}

export default ProfileService;
