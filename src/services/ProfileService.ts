import { User } from '../types';
import IndexedDBService from './IndexedDBService';

const PROFILE_KEY = 'userProfile';
const AVATAR_KEY = 'userAvatar';

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
    // Récupérer les données textuelles du localStorage
    const profileData = localStorage.getItem(PROFILE_KEY);
    const profile: Partial<User> = profileData ? JSON.parse(profileData) : {};

    // Récupérer l'avatar depuis IndexedDB
    try {
      const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
      if (avatarBlob) {
        profile.avatar = URL.createObjectURL(avatarBlob);
      }
    } catch (error) {
      console.error('Error loading avatar from IndexedDB:', error);
    }

    return profile;
  }

  async saveProfile(profileData: Partial<User>, avatarFile?: File): Promise<void> {
    // Sauvegarder les données textuelles dans le localStorage
    const { avatar, ...textData } = profileData;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(textData));

    // Sauvegarder le nouveau fichier avatar dans IndexedDB
    if (avatarFile) {
      try {
        await this.dbService.saveAvatar(AVATAR_KEY, avatarFile);
      } catch (error) {
        console.error('Error saving avatar to IndexedDB:', error);
      }
    }
  }

  // Méthode pour convertir une image en Base64 pour l'envoi via WebRTC
  async getAvatarAsBase64(): Promise<string | null> {
    try {
      const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
      if (!avatarBlob) return null;

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(avatarBlob);
      });
    } catch (error) {
      console.error('Error converting avatar to Base64:', error);
      return null;
    }
  }
}

export default ProfileService;
