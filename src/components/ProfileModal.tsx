import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { X, Camera, RefreshCw } from 'lucide-react';
import ProfileService from '../services/ProfileService';
import { t } from '../i18n';

type Gender = '' | 'male' | 'female' | 'other';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profileData: Partial<User>, avatarFile?: File) => void;
  initialProfile: Partial<User> & { displayName?: string };
  displayAvatarUrl: string | null;
  onRefreshAvatar: () => void;
}

const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialProfile,
  displayAvatarUrl,
  onRefreshAvatar,
}) => {
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [gender, setGender] = useState<Gender>('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileSvc = ProfileService.getInstance();

  useEffect(() => {
    if (isOpen) {
      // Préremplit d'abord avec displayName si dispo, sinon fallback sur name
      setName((initialProfile as any).displayName ?? initialProfile.name ?? '');
      setAge((initialProfile as any).age ?? '');
      setGender(((initialProfile as any).gender as Gender) ?? '');
      setAvatarFile(undefined);

      // Nettoie l’ancienne preview si présente
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
      setAvatarPreview(null);
    }
    // cleanup on unmount
    return () => {
      if (avatarPreview && avatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialProfile]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      alert(t('profileModal.username_cannot_be_empty'));
      return;
    }
    const genderToSave = (gender === '' ? undefined : gender) as User['gender'] | undefined;
    const ageToSave = age === '' ? undefined : Number(age);

    // On reste strictement dans Partial<User> (App.tsx fera le pont vers ProfileService)
    onSave({ name: trimmed, age: ageToSave, gender: genderToSave } as Partial<User>, avatarFile);
    onClose();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert(t('profileModal.select_valid_image'));
      return;
    }
    setAvatarFile(file);

    // Libère l’ancienne preview si nécessaire
    if (avatarPreview && avatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreview);
    }

    // Génère une preview optimisée (redimensionnée/encodée) pour éviter d’afficher des fichiers massifs
    try {
      setIsProcessing(true);
      const rec = await profileSvc.preprocessAvatar(file, 256); // 256px max
      const url = URL.createObjectURL(rec.blob);
      setAvatarPreview(url);
    } catch {
      // fallback: simple ObjectURL direct si preprocess échoue
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreview(previewUrl);
    } finally {
      setIsProcessing(false);
    }
  };

  const version = ((initialProfile as any).avatarVersion || 1);
  const fallback = `https://i.pravatar.cc/150?u=${encodeURIComponent(`${initialProfile.id || 'user'}:${version}`)}`;

  const currentAvatar = avatarPreview || displayAvatarUrl || fallback;

  return (
    <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">{t('profileModal.title')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('profileModal.close_aria')}>
            <X size={24} />
          </button>
        </div>

        <div className="flex flex-col items-center mb-6">
          <div className="relative">
            <img
              key={currentAvatar}
              src={currentAvatar}
              alt={t('profileModal.avatar_alt')}
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                // Ne bascule sur le fallback que si ce n’est PAS un blob (ex: pravatar cassé)
                if (!img.src.startsWith('blob:')) {
                  img.src = fallback;
                }
              }}
              className="w-24 h-24 rounded-full object-cover border-2 border-gray-200"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 border-2 border-white disabled:opacity-60"
              title={t('profileModal.change_avatar_title')}
              aria-label={t('profileModal.change_avatar_title')}
              disabled={isProcessing}
            >
              <Camera size={16} />
            </button>
            {!avatarFile && (
              <button
                onClick={onRefreshAvatar}
                className="absolute -bottom-1 -left-1 bg-green-600 text-white p-2 rounded-full hover:bg-green-700 border-2 border-white"
                title={t('profileModal.refresh_avatar_title')}
                aria-label={t('profileModal.refresh_avatar_title')}
              >
                <RefreshCw size={16} />
              </button>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarChange}
              className="hidden"
              accept="image/png, image/jpeg, image/webp, image/avif, image/*"
            />
          </div>
          {isProcessing && (
            <p className="mt-2 text-xs text-gray-500">{t('profileModal.optimizing_image')}</p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              {t('profileModal.username_label')}
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="age" className="block text-sm font-medium text-gray-700 mb-1">
                {t('profileModal.age_label')}
              </label>
              <input
                type="number"
                id="age"
                value={age}
                onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                min={1}
                max={119}
              />
            </div>
            <div>
              <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
                {t('profileModal.gender_label')}
              </label>
              <select
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
              >
                <option value="">{t('profileModal.gender_unspecified')}</option>
                <option value="male">{t('profileModal.gender_male')}</option>
                <option value="female">{t('profileModal.gender_female')}</option>
                <option value="other">{t('profileModal.gender_other')}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            {t('profileModal.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isProcessing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
          >
            {t('profileModal.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
