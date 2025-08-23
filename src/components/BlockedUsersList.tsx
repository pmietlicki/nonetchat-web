import React, { useState, useEffect } from 'react';
import { Ban, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import PeerService from '../services/PeerService';

interface BlockedUsersListProps {
  isOpen: boolean;
  onClose: () => void;
  peerService: PeerService;
}

interface BlockedUser {
  id: string;
  name?: string;
  avatarW?: string;
  blockedAt: number;
}

const BlockedUsersList: React.FC<BlockedUsersListProps> = ({ isOpen, onClose, peerService }) => {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadBlockedUsers();
    }
  }, [isOpen]);

  const loadBlockedUsers = async () => {
    setIsLoading(true);
    try {
      // Récupérer la liste des IDs bloqués depuis PeerService
      const blockList = peerService.getBlockList();
      
      // Pour chaque utilisateur bloqué, essayer de récupérer ses informations
      const users: BlockedUser[] = [];
      for (const userId of blockList) {
        // Essayer de récupérer le profil depuis le cache ou la base de données
        const profile = await peerService.getUserProfile(userId);
        users.push({
          id: userId,
          name: profile?.name || t('blockedUsers.unknown_user'),
          avatarW: profile?.avatarW?.toString(),
          blockedAt: Date.now() // Pour l'instant, on utilise la date actuelle
        });
      }
      
      setBlockedUsers(users);
    } catch (error) {
      console.error('Error loading blocked users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    if (window.confirm(t('blockedUsers.unblock_confirm'))) {
      try {
        await peerService.unblockPeer(userId);
        // Recharger la liste
        await loadBlockedUsers();
      } catch (error) {
        console.error('Error unblocking user:', error);
      }
    }
  };

  const safeAvatar = (user: BlockedUser) => {
    return user.avatarW?.trim()
      ? user.avatarW
      : `https://i.pravatar.cc/150?u=${encodeURIComponent(user.id)}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl p-4 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Ban className="text-red-600" size={20} />
            <h3 className="text-lg font-bold">{t('blockedUsers.title')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label={t('blockedUsers.close')}
          >
            ×
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : blockedUsers.length === 0 ? (
          <div className="text-center py-8">
            <Ban className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">{t('blockedUsers.no_blocked_users')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {blockedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={safeAvatar(user)}
                    alt={user.name}
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = `https://i.pravatar.cc/150?u=${encodeURIComponent(user.id)}`;
                    }}
                  />
                  <div>
                    <div className="font-medium text-gray-900">
                      {user.name || t('blockedUsers.unknown_user')}
                    </div>
                    <div className="text-sm text-gray-500">
                      {t('blockedUsers.blocked_at', {
                        date: new Date(user.blockedAt).toLocaleDateString()
                      })}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleUnblockUser(user.id)}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 flex items-center gap-1"
                  title={t('blockedUsers.unblock_user')}
                >
                  <Trash2 size={14} />
                  {t('blockedUsers.unblock')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            {t('blockedUsers.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BlockedUsersList;