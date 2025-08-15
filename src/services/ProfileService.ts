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

  async getProfile(): Promise<Partial<User> & { avatarBlob?: Blob | null }> {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    const profileData = localStorage.getItem(PROFILE_KEY);
    const profile: Partial<User> = profileData ? JSON.parse(profileData) : {};
    profile.id = deviceId;

    const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
    
    return { ...profile, avatarBlob };
  }

  async saveProfile(profileData: Partial<User>, avatarFile?: File): Promise<void> {
    const { avatar, ...textData } = profileData;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(textData));

    if (avatarFile) {
      await this.dbService.saveAvatar(AVATAR_KEY, avatarFile);
    }
  }

  async getAvatarAsBase64(): Promise<string | null> {
    try {
      const avatarBlob = await this.dbService.getAvatar(AVATAR_KEY);
      if (!avatarBlob) {
        return null;
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.onerror = (error) => {
          reject(error);
        };
        reader.readAsDataURL(avatarBlob);
      });
    } catch (error) {
      console.error('Error converting avatar to Base64:', error);
      return null;
    }
  }

  async deleteCustomAvatar(): Promise<void> {
    await this.dbService.deleteAvatar(AVATAR_KEY);
  }
}

export default ProfileService;
