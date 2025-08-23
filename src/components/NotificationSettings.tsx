import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Volume2, VolumeX, Settings, X } from 'lucide-react';
import NotificationService from '../services/NotificationService';
import { t } from '../i18n';

interface NotificationSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState(NotificationService.getInstance().getSettings());
  const notificationService = NotificationService.getInstance();

  useEffect(() => {
    if (isOpen) {
      setSettings(notificationService.getSettings());
    }
  }, [isOpen]);

  const updateGlobalSetting = (key: keyof typeof settings, value: boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    notificationService.updateSettings(newSettings);
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        updateGlobalSetting('systemNotificationsEnabled', true);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Settings size={20} />
            {t('notificationSettings.title')}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Notifications globales */}
          <div className="space-y-4">
            <h3 className="font-medium text-gray-900">{t('notificationSettings.general')}</h3>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.globalEnabled ? <Bell size={20} className="text-blue-500" /> : <BellOff size={20} className="text-gray-400" />}
                <div>
                  <div className="font-medium text-gray-900">{t('notificationSettings.enable_notifications')}</div>
                  <div className="text-sm text-gray-500">{t('notificationSettings.enable_notifications_description')}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.globalEnabled}
                  onChange={(e) => updateGlobalSetting('globalEnabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.soundEnabled ? <Volume2 size={20} className="text-green-500" /> : <VolumeX size={20} className="text-gray-400" />}
                <div>
                  <div className="font-medium text-gray-900">{t('notificationSettings.sound')}</div>
                  <div className="text-sm text-gray-500">{t('notificationSettings.sound_description')}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.soundEnabled && settings.globalEnabled}
                  onChange={(e) => updateGlobalSetting('soundEnabled', e.target.checked)}
                  disabled={!settings.globalEnabled}
                  className="sr-only peer"
                />
                <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 ${!settings.globalEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center">
                  <span className="text-white text-xs font-bold">!</span>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{t('notificationSettings.system')}</div>
                  <div className="text-sm text-gray-500">{t('notificationSettings.system_description')}</div>
                </div>
              </div>
              {Notification.permission === 'granted' ? (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.systemNotificationsEnabled && settings.globalEnabled}
                    onChange={(e) => updateGlobalSetting('systemNotificationsEnabled', e.target.checked)}
                    disabled={!settings.globalEnabled}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 ${!settings.globalEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
                </label>
              ) : (
                <button
                  onClick={requestNotificationPermission}
                  className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
                  disabled={!settings.globalEnabled}
                >
                  {t('notificationSettings.authorize')}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs">🌙</span>
                </div>
                <div>
                  <div className="font-medium text-gray-900">{t('notificationSettings.dnd')}</div>
                  <div className="text-sm text-gray-500">{t('notificationSettings.dnd_description')}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.doNotDisturb}
                  onChange={(e) => updateGlobalSetting('doNotDisturb', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>
          </div>

          {/* Informations */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm text-blue-800">
              <div className="font-medium mb-1">{t('notificationSettings.tips_title')}</div>
              <ul className="space-y-1 text-xs">
                <li>{t('notificationSettings.tip1')}</li>
                <li>{t('notificationSettings.tip2')}</li>
                <li>{t('notificationSettings.tip3')}</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            {t('notificationSettings.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettings;