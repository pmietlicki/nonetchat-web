import React, { useState, useEffect } from 'react';
import { X, MapPin, Shield, Info } from 'lucide-react';
import { t } from '../i18n';

interface ConsentBannerProps {
  onAccept: () => void;
  onDecline: () => void;
  onShowPrivacyPolicy: () => void;
}

const ConsentBanner: React.FC<ConsentBannerProps> = ({ onAccept, onDecline, onShowPrivacyPolicy }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // Vérifier si le consentement a déjà été donné
    const consent = localStorage.getItem('geolocation-consent');
    if (!consent) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('geolocation-consent', 'accepted');
    localStorage.setItem('geolocation-consent-date', new Date().toISOString());
    setIsVisible(false);
    onAccept();
  };

  const handleDecline = () => {
    localStorage.setItem('geolocation-consent', 'declined');
    localStorage.setItem('geolocation-consent-date', new Date().toISOString());
    setIsVisible(false);
    onDecline();
  };

  const handleClose = () => {
    setIsVisible(false);
    onDecline();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <MapPin className="w-6 h-6 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">
                {t('consent.geolocation.title')}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mb-6">
            <p className="text-gray-700 mb-4">
              {t('consent.geolocation.description')}
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-medium text-blue-900 mb-2">
                    {t('consent.geolocation.privacy_title')}
                  </h3>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• {t('consent.geolocation.privacy_point1')}</li>
                    <li>• {t('consent.geolocation.privacy_point2')}</li>
                    <li>• {t('consent.geolocation.privacy_point3')}</li>
                    <li>• {t('consent.geolocation.privacy_point4')}</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-colors mb-4"
            >
              <Info className="w-4 h-4" />
              {showDetails ? t('consent.geolocation.hide_details') : t('consent.geolocation.show_details')}
            </button>

            {showDetails && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                <h4 className="font-medium text-gray-900 mb-2">
                  {t('consent.geolocation.technical_details')}
                </h4>
                <ul className="text-sm text-gray-700 space-y-2">
                  <li><strong>{t('consent.geolocation.data_collected')}:</strong> {t('consent.geolocation.data_collected_desc')}</li>
                  <li><strong>{t('consent.geolocation.purpose')}:</strong> {t('consent.geolocation.purpose_desc')}</li>
                  <li><strong>{t('consent.geolocation.retention')}:</strong> {t('consent.geolocation.retention_desc')}</li>
                  <li><strong>{t('consent.geolocation.legal_basis')}:</strong> {t('consent.geolocation.legal_basis_desc')}</li>
                </ul>
              </div>
            )}

            <p className="text-sm text-gray-600 mb-4">
              {t('consent.geolocation.withdrawal_info')}{' '}
              <button
                onClick={onShowPrivacyPolicy}
                className="text-blue-600 hover:text-blue-800 underline"
              >
                {t('consent.geolocation.privacy_policy_link')}
              </button>
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDecline}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('consent.geolocation.decline')}
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('consent.geolocation.accept')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsentBanner;