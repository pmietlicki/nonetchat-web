// src/components/PeerList.tsx
import React, { useMemo, useState } from 'react';
import { User } from '../types';
import { Users, Circle, Wifi, MessageSquare, Info, X, MapPin } from 'lucide-react';
import { t } from '../i18n';

type GenderFilter = 'all' | 'male' | 'female' | 'other';
type SortMode = 'distanceAsc' | 'distanceDesc' | 'ageAsc' | 'ageDesc';

interface PeerListProps {
  peers: User[];
  onSelectPeer: (peerId: string) => void;
  selectedPeerId?: string;
  isConnected: boolean;
}

interface ProfileDetailModalProps {
  peer: User | null;
  isOpen: boolean;
  onClose: () => void;
}

const safeAvatar = (peer: User) => {
  const ver = (peer as any).avatarVersion || 1;
  return peer.avatar?.trim()
    ? peer.avatar
    : `https://i.pravatar.cc/150?u=${encodeURIComponent(`${peer.id}:${ver}`)}`;
};

const formatJoinTime = (joinedAt: string) => {
  const date = new Date(joinedAt);
  if (isNaN(date.getTime())) return t('peerList.join_time.unknown');
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) return t('peerList.join_time.now');
  if (diffInMinutes < 60) return t('peerList.join_time.minutes_ago', { count: diffInMinutes });
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return t('peerList.join_time.hours_ago', { count: diffInHours });
  return date.toLocaleDateString();
};

interface ProfileTooltipProps {
  peer: User;
  children: React.ReactNode;
}

const ProfileTooltip: React.FC<ProfileTooltipProps> = ({ peer, children }) => {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div className="absolute left-full ml-2 top-0 z-50 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="flex items-center gap-3 mb-3">
            <img
              src={safeAvatar(peer)}
              alt={peer.name || t('peerList.user_default_name')}
              className="w-10 h-10 rounded-full object-cover"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = `https://i.pravatar.cc/150?u=${encodeURIComponent(peer.id)}&d=identicon`;
              }}
            />
            <div>
              <h4 className="font-semibold text-gray-900">{peer.name || t('peerList.user_default_name')}</h4>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">{t('peerList.tooltip.status')}</span>
              <span
                className={`capitalize font-medium ${
                  peer.status === 'online' ? 'text-green-600' : peer.status === 'busy' ? 'text-yellow-600' : 'text-gray-400'
                }`}
              >
                {peer.status}
              </span>
            </div>

            {typeof peer.age === 'number' && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('peerList.tooltip.age')}</span>
                <span className="font-medium">{peer.age} {t('peerList.age_suffix')}</span>
              </div>
            )}

            {peer.gender && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('peerList.tooltip.gender')}</span>
                <div className="flex items-center gap-2">
                  <span
                    className="text-lg"
                    style={{
                      color: peer.gender === 'female' ? '#ec4899' : peer.gender === 'male' ? '#3b82f6' : '#6b7280',
                    }}
                  >
                    {peer.gender === 'male' ? '♂' : peer.gender === 'female' ? '♀' : '⚧'}
                  </span>
                  <span className="font-medium capitalize">
                    {peer.gender === 'male'
                      ? t('profileModal.gender_male')
                      : peer.gender === 'female'
                      ? t('profileModal.gender_female')
                      : peer.gender === 'other'
                      ? t('profileModal.gender_other')
                      : peer.gender}
                  </span>
                </div>
              </div>
            )}

            {peer.distanceLabel && (
              <div className="flex justify-between">
                <span className="text-gray-600">{t('peerList.tooltip.distance')}</span>
                <span className="font-medium flex items-center gap-1">
                  <MapPin size={14} className="text-blue-600" />
                  {peer.distanceLabel}
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-gray-600">{t('peerList.tooltip.connected')}</span>
              <span className="font-medium">{formatJoinTime(peer.joinedAt)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ProfileDetailModal: React.FC<ProfileDetailModalProps> = ({ peer, isOpen, onClose }) => {
  if (!isOpen || !peer) return null;
  return (
    <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">{t('peerList.modal.title', { name: peer.name || t('peerList.user_default_name') })}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('peerList.modal.close')}>
            <X size={24} />
          </button>
        </div>

        <div className="flex flex-col items-center mb-6">
          <img
            src={safeAvatar(peer)}
            alt={peer.name || t('peerList.user_default_name')}
            className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 mb-4"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = `https://i.pravatar.cc/150?u=${encodeURIComponent(peer.id)}&d=identicon`;
            }}
          />
          <h4 className="text-lg font-semibold">{peer.name || t('peerList.user_default_name')}</h4>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600">{t('peerList.tooltip.status')}</span>
            <span
              className={`capitalize font-medium ${
                peer.status === 'online' ? 'text-green-600' : peer.status === 'busy' ? 'text-yellow-600' : 'text-gray-400'
              }`}
            >
              {peer.status}
            </span>
          </div>

          {typeof peer.age === 'number' && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t('peerList.tooltip.age')}</span>
              <span className="font-medium">{peer.age} {t('peerList.age_suffix')}</span>
            </div>
          )}

          {peer.gender && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t('peerList.tooltip.gender')}</span>
              <div className="flex items-center gap-2">
                <span
                  className="text-lg"
                  style={{
                    color: peer.gender === 'female' ? '#ec4899' : peer.gender === 'male' ? '#3b82f6' : '#6b7280',
                  }}
                >
                  {peer.gender === 'male' ? '♂' : peer.gender === 'female' ? '♀' : '⚧'}
                </span>
                <span className="font-medium capitalize">
                  {peer.gender === 'male'
                    ? t('profileModal.gender_male')
                    : peer.gender === 'female'
                    ? t('profileModal.gender_female')
                    : peer.gender === 'other'
                    ? t('profileModal.gender_other')
                    : peer.gender}
                </span>
              </div>
            </div>
          )}

          {peer.distanceLabel && (
            <div className="flex justify-between">
              <span className="text-gray-600">{t('peerList.tooltip.distance')}</span>
              <span className="font-medium flex items-center gap-1">
                <MapPin size={14} className="text-blue-600" />
                {peer.distanceLabel}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-gray-600">{t('peerList.modal.connected_since')}</span>
            <span className="font-medium">
              {isNaN(new Date(peer.joinedAt).getTime())
                ? t('peerList.join_time.unknown')
                : new Date(peer.joinedAt).toLocaleString()}
            </span>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
            {t('peerList.modal.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

const PeerList: React.FC<PeerListProps> = ({ peers, onSelectPeer, selectedPeerId, isConnected }) => {
  const [selectedProfilePeer, setSelectedProfilePeer] = useState<User | null>(null);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('distanceAsc');

  const onlinePeers = useMemo(
    () => peers.filter((peer) => peer.status === 'online'),
    [peers]
  );

  const filteredAndSorted = useMemo(() => {
    let list = onlinePeers;

    if (genderFilter !== 'all') {
      list = list.filter(p => (p.gender || 'other') === genderFilter);
    }

    const byAgeAsc = (a?: number, b?: number) => {
      const A = typeof a === 'number' ? a : Number.POSITIVE_INFINITY;
      const B = typeof b === 'number' ? b : Number.POSITIVE_INFINITY;
      return A - B;
    };

    const byDistanceAsc = (a?: number, b?: number) => {
      const A = typeof a === 'number' ? a : Number.POSITIVE_INFINITY;
      const B = typeof b === 'number' ? b : Number.POSITIVE_INFINITY;
      return A - B;
    };

    const arr = [...list];
    switch (sortMode) {
      case 'ageAsc':
        arr.sort((a, b) => byAgeAsc(a.age, b.age));
        break;
      case 'ageDesc':
        arr.sort((a, b) => byAgeAsc(b.age, a.age));
        break;
      case 'distanceDesc':
        arr.sort((a, b) => byDistanceAsc(b.distanceKm, a.distanceKm));
        break;
      case 'distanceAsc':
      default:
        arr.sort((a, b) => byDistanceAsc(a.distanceKm, b.distanceKm));
        break;
    }
    return arr;
  }, [onlinePeers, genderFilter, sortMode]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-500';
      case 'busy':
        return 'text-yellow-500';
      case 'offline':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="w-full sm:w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          {t('peerList.title', { count: onlinePeers.length })}
        </h2>

        {/* Toolbar responsive : deux selects empilés sur mobile, inline en desktop */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="w-full">
            <span className="sr-only">{t('peerList.filter_by_gender')}</span>
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value as GenderFilter)}
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">{t('peerList.all_genders')}</option>
              <option value="male">{t('peerList.male')}</option>
              <option value="female">{t('peerList.female')}</option>
              <option value="other">{t('peerList.other_gender')}</option>
            </select>
          </label>

          <label className="w-full">
            <span className="sr-only">{t('peerList.sort_by')}</span>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span>{t('peerList.sort_by')}</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="distanceAsc">{t('peerList.distance_asc')}</option>
                <option value="distanceDesc">{t('peerList.distance_desc')}</option>
                <option value="ageAsc">{t('peerList.age_asc')}</option>
                <option value="ageDesc">{t('peerList.age_desc')}</option>
              </select>
            </label>
          </label>
        </div>

        {!isConnected && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-3">
            <div className="flex items-center gap-2 text-yellow-800">
              <Wifi size={16} />
              <span className="text-sm">{t('peerList.connection_required_body')}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" role="list" aria-label={t('peerList.title', { count: filteredAndSorted.length })}>
        {!isConnected ? (
          <div className="p-4 text-center text-gray-500">
            <Wifi size={48} className="mx-auto mb-2 text-gray-300" />
            <p>{t('peerList.connection_required_title')}</p>
            <p className="text-sm">{t('peerList.connection_required_body')}</p>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <Users size={48} className="mx-auto mb-2 text-gray-300" />
            <p>{t('peerList.no_peers_title')}</p>
            <p className="text-sm">{t('peerList.no_peers_body')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredAndSorted.map((peer) => (
              <ProfileTooltip key={`${peer.id}-${peer.joinedAt}`} peer={peer}>
                <div
                  role="listitem"
                  aria-selected={selectedPeerId === peer.id}
                  onClick={() => onSelectPeer(peer.id)}
                  className={`p-3 mx-2 rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedPeerId === peer.id ? 'bg-blue-50 border border-blue-200 shadow-sm' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={safeAvatar(peer)}
                        alt={peer.name || t('peerList.user_default_name')}
                        className="w-12 h-12 rounded-full object-cover"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = `https://i.pravatar.cc/150?u=${encodeURIComponent(peer.id)}&d=identicon`;
                        }}
                      />
                      <Circle
                        size={10}
                        className={`absolute -bottom-0.5 -right-0.5 ${getStatusColor(
                          peer.status
                        )} fill-current bg-white rounded-full`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{peer.name || t('peerList.user_default_name')}</p>

                        {/* Badge distance à droite (mobile aussi) */}
                        {peer.distanceLabel && (
                          <span
                            className={`ml-auto text-[11px] px-1.5 py-0.5 rounded-full border ${
                              peer.distanceKm === 0
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                            title={t('peerList.estimated_distance')}
                          >
                            {peer.distanceLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span className={`capitalize ${getStatusColor(peer.status)}`}>{peer.status}</span>

                        {peer.gender && (
                          <>
                            <span>•</span>
                            <div
                              className="flex items-center gap-1"
                              title={t('peerList.gender_title', {
                                gender:
                                  peer.gender === 'male'
                                    ? t('profileModal.gender_male')
                                    : peer.gender === 'female'
                                    ? t('profileModal.gender_female')
                                    : t('profileModal.gender_other')
                              })}
                            >
                              <span
                                className="text-sm"
                                style={{
                                  color: peer.gender === 'female' ? '#ec4899' : peer.gender === 'male' ? '#3b82f6' : '#6b7280',
                                }}
                              >
                                {peer.gender === 'male' ? '♂' : peer.gender === 'female' ? '♀' : '⚧'}
                              </span>
                              {typeof peer.age === 'number' && <span className="text-xs">{peer.age} {t('peerList.age_suffix')}</span>}
                            </div>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatJoinTime(peer.joinedAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProfilePeer(peer);
                        }}
                        className="text-gray-600 hover:text-gray-700 p-1 rounded hover:bg-gray-50 transition-colors"
                        title={t('peerList.view_profile')}
                        aria-label={t('peerList.view_profile')}
                      >
                        <Info size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPeer(peer.id);
                        }}
                        className="text-blue-600 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition-colors"
                        title={t('peerList.start_conversation')}
                        aria-label={t('peerList.start_conversation')}
                      >
                        <MessageSquare size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </ProfileTooltip>
            ))}
          </div>
        )}
      </div>

      <ProfileDetailModal peer={selectedProfilePeer} isOpen={selectedProfilePeer !== null} onClose={() => setSelectedProfilePeer(null)} />
    </div>
  );
};

export default PeerList;
