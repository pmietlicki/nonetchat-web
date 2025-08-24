import React, { useState, useEffect } from 'react';
import { Shield, Download, Trash2, Eye, Settings, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { t } from '../i18n';
import IndexedDBService from '../services/IndexedDBService';
import ProfileService from '../services/ProfileService';

interface PrivacySettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onShowLegalDocuments: (tab?: 'privacy' | 'terms' | 'legal') => void;
}

const PrivacySettings: React.FC<PrivacySettingsProps> = ({ isOpen, onClose, onShowLegalDocuments }) => {
  const [geolocationConsent, setGeolocationConsent] = useState<string | null>(null);
  const [consentDate, setConsentDate] = useState<string | null>(null);
  const [dataStats, setDataStats] = useState({
    messages: 0,
    conversations: 0,
    avatars: 0,
    profileSize: 0
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const dbService = IndexedDBService.getInstance();
  const profileService = ProfileService.getInstance();

  useEffect(() => {
    if (isOpen) {
      loadPrivacyData();
    }
  }, [isOpen]);

  const loadPrivacyData = async () => {
    // Charger le statut du consentement
    const consent = localStorage.getItem('geolocation-consent');
    const date = localStorage.getItem('geolocation-consent-date');
    setGeolocationConsent(consent);
    setConsentDate(date);

    // Calculer les statistiques des données
    try {
      // Note: IndexedDBService n'a pas de getAllMessages() ou getAllAvatars()
      // On utilise les méthodes disponibles ou on estime
      const conversations = await dbService.getAllConversations();
      const profile = await profileService.getProfile();
      
      setDataStats({
        messages: 0, // Pas de méthode pour compter tous les messages
        conversations: conversations.length,
        avatars: 0, // Pas de méthode pour compter tous les avatars
        profileSize: JSON.stringify(profile).length
      });
    } catch (error) {
      console.error('Error loading privacy data:', error);
    }
  };

  const handleWithdrawConsent = () => {
    localStorage.setItem('geolocation-consent', 'declined');
    localStorage.setItem('geolocation-consent-date', new Date().toISOString());
    setGeolocationConsent('declined');
    setConsentDate(new Date().toISOString());
    setActionResult({ type: 'success', message: t('privacy_settings.consent_withdrawn') });
  };

  const handleGrantConsent = () => {
    localStorage.setItem('geolocation-consent', 'accepted');
    localStorage.setItem('geolocation-consent-date', new Date().toISOString());
    setGeolocationConsent('accepted');
    setConsentDate(new Date().toISOString());
    setActionResult({ type: 'success', message: t('privacy_settings.consent_granted') });
  };

  const exportPersonalData = async () => {
    setIsExporting(true);
    try {
      const data = {
        exportDate: new Date().toISOString(),
        profile: await profileService.getProfile(),
        messages: [], // getAllMessages() n'existe pas dans IndexedDBService
        conversations: await dbService.getAllConversations(),
        settings: {
          geolocationConsent,
          consentDate,
          language: localStorage.getItem('preferredLanguage'),
          signalingUrl: localStorage.getItem('signalingUrl'),
          searchRadius: localStorage.getItem('searchRadius')
        },
        metadata: {
          version: '1.0',
          format: 'JSON',
          description: 'Personal data export from NoNetChat'
        }
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nonetchat-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setActionResult({ type: 'success', message: t('privacy_settings.export_success') });
    } catch (error) {
      console.error('Error exporting data:', error);
      setActionResult({ type: 'error', message: t('privacy_settings.export_error') });
    } finally {
      setIsExporting(false);
    }
  };

  const deleteAllPersonalData = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setActionResult({ type: 'error', message: t('privacy_settings.delete_confirm_error') });
      return;
    }

    setIsDeleting(true);
    try {
      // Supprimer toutes les données IndexedDB
      await dbService.clearAllData();
      
      // Supprimer les données localStorage
      const keysToRemove = [
        'geolocation-consent',
        'geolocation-consent-date',
        'preferredLanguage',
        'signalingUrl',
        'searchRadius',
        'deviceId'
      ];
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Supprimer l'avatar personnalisé (pas de clearProfile() disponible)
      await profileService.deleteCustomAvatar();
      
      setActionResult({ type: 'success', message: t('privacy_settings.delete_success') });
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      
      // Recharger les données après suppression
      setTimeout(() => {
        loadPrivacyData();
      }, 1000);
    } catch (error) {
      console.error('Error deleting data:', error);
      setActionResult({ type: 'error', message: t('privacy_settings.delete_error') });
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('privacy_settings.never');
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-600" />
              {t('privacy_settings.title')}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {actionResult && (
            <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
              actionResult.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {actionResult.type === 'success' ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
              <span>{actionResult.message}</span>
              <button
                onClick={() => setActionResult(null)}
                className="ml-auto text-gray-500 hover:text-gray-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Consentement à la géolocalisation */}
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" />
              {t('privacy_settings.geolocation_consent.title')}
            </h3>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {t('privacy_settings.geolocation_consent.status')}: 
                    <span className={`ml-2 px-2 py-1 rounded-full text-xs ${
                      geolocationConsent === 'accepted' 
                        ? 'bg-green-100 text-green-800'
                        : geolocationConsent === 'declined'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {geolocationConsent === 'accepted' 
                        ? t('privacy_settings.geolocation_consent.granted')
                        : geolocationConsent === 'declined'
                        ? t('privacy_settings.geolocation_consent.declined')
                        : t('privacy_settings.geolocation_consent.not_set')
                      }
                    </span>
                  </p>
                  <p className="text-sm text-gray-600">
                    {t('privacy_settings.geolocation_consent.date')}: {formatDate(consentDate)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {geolocationConsent !== 'accepted' && (
                  <button
                    onClick={handleGrantConsent}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                  >
                    {t('privacy_settings.geolocation_consent.grant')}
                  </button>
                )}
                {geolocationConsent === 'accepted' && (
                  <button
                    onClick={handleWithdrawConsent}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                  >
                    {t('privacy_settings.geolocation_consent.withdraw')}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Aperçu des données */}
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Eye className="w-5 h-5" />
              {t('privacy_settings.data_overview.title')}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900">{t('privacy_settings.data_overview.messages')}</h4>
                <p className="text-2xl font-bold text-blue-600">{dataStats.messages}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-900">{t('privacy_settings.data_overview.conversations')}</h4>
                <p className="text-2xl font-bold text-green-600">{dataStats.conversations}</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-medium text-purple-900">{t('privacy_settings.data_overview.avatars')}</h4>
                <p className="text-2xl font-bold text-purple-600">{dataStats.avatars}</p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-medium text-orange-900">{t('privacy_settings.data_overview.profile_size')}</h4>
                <p className="text-2xl font-bold text-orange-600">{formatFileSize(dataStats.profileSize)}</p>
              </div>
            </div>
          </section>

          {/* Actions sur les données */}
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('privacy_settings.data_actions.title')}
            </h3>
            <div className="space-y-4">
              {/* Export des données */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 flex items-center gap-2">
                      <Download className="w-4 h-4" />
                      {t('privacy_settings.data_actions.export.title')}
                    </h4>
                    <p className="text-sm text-gray-600">
                      {t('privacy_settings.data_actions.export.description')}
                    </p>
                  </div>
                  <button
                    onClick={exportPersonalData}
                    disabled={isExporting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isExporting ? t('privacy_settings.data_actions.export.exporting') : t('privacy_settings.data_actions.export.button')}
                  </button>
                </div>
              </div>

              {/* Suppression des données */}
              <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-red-900 flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      {t('privacy_settings.data_actions.delete.title')}
                    </h4>
                    <p className="text-sm text-red-700">
                      {t('privacy_settings.data_actions.delete.description')}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    {t('privacy_settings.data_actions.delete.button')}
                  </button>
                </div>

                {showDeleteConfirm && (
                  <div className="mt-4 p-4 bg-red-100 border border-red-300 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      <h5 className="font-medium text-red-900">
                        {t('privacy_settings.data_actions.delete.confirm_title')}
                      </h5>
                    </div>
                    <p className="text-sm text-red-800 mb-3">
                      {t('privacy_settings.data_actions.delete.confirm_description')}
                    </p>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-red-900 mb-1">
                        {t('privacy_settings.data_actions.delete.type_delete')}
                      </label>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        className="w-full px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="DELETE"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmText('');
                        }}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        onClick={deleteAllPersonalData}
                        disabled={isDeleting || deleteConfirmText !== 'DELETE'}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isDeleting ? t('privacy_settings.data_actions.delete.deleting') : t('privacy_settings.data_actions.delete.confirm_button')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Liens vers les documents légaux */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('privacy_settings.legal_documents.title')}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onShowLegalDocuments('privacy')}
                className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
              >
                {t('privacy_settings.legal_documents.privacy_policy')}
              </button>
              <button
                onClick={() => onShowLegalDocuments('terms')}
                className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
              >
                {t('privacy_settings.legal_documents.terms_of_service')}
              </button>
              <button
                onClick={() => onShowLegalDocuments('legal')}
                className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
              >
                {t('privacy_settings.legal_documents.legal_notices')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacySettings;