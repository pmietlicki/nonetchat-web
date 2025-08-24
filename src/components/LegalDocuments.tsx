import React, { useState } from 'react';
import { X, Shield, FileText, Scale, Mail, MapPin, Clock, Users, Lock } from 'lucide-react';
import { t } from '../i18n';

interface LegalDocumentsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'privacy' | 'terms' | 'legal';
}

const LegalDocuments: React.FC<LegalDocumentsProps> = ({ isOpen, onClose, initialTab = 'privacy' }) => {
  const [activeTab, setActiveTab] = useState<'privacy' | 'terms' | 'legal'>(initialTab);

  if (!isOpen) return null;

  const PrivacyPolicy = () => (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" />
          {t('legal.privacy_policy.title')}
        </h2>
        <p className="text-sm text-gray-600 mt-2">
          {t('legal.privacy_policy.last_updated')}: {new Date().toLocaleDateString()}
        </p>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          {t('legal.privacy_policy.controller.title')}
        </h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.privacy_policy.controller.name')}:</strong> NoNetChat
          </p>
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.privacy_policy.controller.contact')}:</strong> 
            <a href="mailto:privacy@nonetchat.com" className="text-blue-600 hover:text-blue-800 ml-1">
              privacy@nonetchat.com
            </a>
          </p>
          <p className="text-gray-700">
            <strong>{t('legal.privacy_policy.controller.dpo')}:</strong> dpo@nonetchat.com
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <MapPin className="w-5 h-5" />
          {t('legal.privacy_policy.data_collected.title')}
        </h3>
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">{t('legal.privacy_policy.data_collected.geolocation.title')}</h4>
            <ul className="text-sm text-gray-700 space-y-1 ml-4">
              <li>• {t('legal.privacy_policy.data_collected.geolocation.coordinates')}</li>
              <li>• {t('legal.privacy_policy.data_collected.geolocation.city_country')}</li>
              <li>• {t('legal.privacy_policy.data_collected.geolocation.accuracy')}</li>
            </ul>
            <p className="text-xs text-gray-600 mt-2">
              <strong>{t('legal.privacy_policy.data_collected.legal_basis')}:</strong> {t('legal.privacy_policy.data_collected.geolocation.legal_basis')}
            </p>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">{t('legal.privacy_policy.data_collected.profile.title')}</h4>
            <ul className="text-sm text-gray-700 space-y-1 ml-4">
              <li>• {t('legal.privacy_policy.data_collected.profile.display_name')}</li>
              <li>• {t('legal.privacy_policy.data_collected.profile.age_gender')}</li>
              <li>• {t('legal.privacy_policy.data_collected.profile.avatar')}</li>
              <li>• {t('legal.privacy_policy.data_collected.profile.device_id')}</li>
            </ul>
            <p className="text-xs text-gray-600 mt-2">
              <strong>{t('legal.privacy_policy.data_collected.legal_basis')}:</strong> {t('legal.privacy_policy.data_collected.profile.legal_basis')}
            </p>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">{t('legal.privacy_policy.data_collected.messages.title')}</h4>
            <ul className="text-sm text-gray-700 space-y-1 ml-4">
              <li>• {t('legal.privacy_policy.data_collected.messages.encrypted')}</li>
              <li>• {t('legal.privacy_policy.data_collected.messages.local_only')}</li>
              <li>• {t('legal.privacy_policy.data_collected.messages.metadata')}</li>
            </ul>
            <p className="text-xs text-gray-600 mt-2">
              <strong>{t('legal.privacy_policy.data_collected.legal_basis')}:</strong> {t('legal.privacy_policy.data_collected.messages.legal_basis')}
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          {t('legal.privacy_policy.retention.title')}
        </h3>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• <strong>{t('legal.privacy_policy.retention.geolocation')}:</strong> {t('legal.privacy_policy.retention.geolocation_duration')}</li>
            <li>• <strong>{t('legal.privacy_policy.retention.profile')}:</strong> {t('legal.privacy_policy.retention.profile_duration')}</li>
            <li>• <strong>{t('legal.privacy_policy.retention.messages')}:</strong> {t('legal.privacy_policy.retention.messages_duration')}</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Users className="w-5 h-5" />
          {t('legal.privacy_policy.rights.title')}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.access')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.access_desc')}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.rectification')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.rectification_desc')}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.erasure')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.erasure_desc')}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.portability')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.portability_desc')}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.withdraw_consent')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.withdraw_consent_desc')}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-3">
            <h4 className="font-medium text-gray-900 text-sm">{t('legal.privacy_policy.rights.complaint')}</h4>
            <p className="text-xs text-gray-600 mt-1">{t('legal.privacy_policy.rights.complaint_desc')}</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Lock className="w-5 h-5" />
          {t('legal.privacy_policy.security.title')}
        </h3>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <ul className="text-sm text-green-800 space-y-2">
            <li>• {t('legal.privacy_policy.security.encryption')}</li>
            <li>• {t('legal.privacy_policy.security.local_storage')}</li>
            <li>• {t('legal.privacy_policy.security.p2p')}</li>
            <li>• {t('legal.privacy_policy.security.no_central_server')}</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.privacy_policy.contact.title')}</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-700 mb-2">
            {t('legal.privacy_policy.contact.description')}
          </p>
          <p className="text-gray-700">
            <Mail className="w-4 h-4 inline mr-2" />
            <a href="mailto:privacy@nonetchat.com" className="text-blue-600 hover:text-blue-800">
              privacy@nonetchat.com
            </a>
          </p>
        </div>
      </section>
    </div>
  );

  const TermsOfService = () => (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-600" />
          {t('legal.terms.title')}
        </h2>
        <p className="text-sm text-gray-600 mt-2">
          {t('legal.terms.last_updated')}: {new Date().toLocaleDateString()}
        </p>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.acceptance.title')}</h3>
        <p className="text-gray-700">{t('legal.terms.acceptance.content')}</p>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.service_description.title')}</h3>
        <p className="text-gray-700 mb-3">{t('legal.terms.service_description.content')}</p>
        <ul className="text-gray-700 space-y-1 ml-4">
          <li>• {t('legal.terms.service_description.feature1')}</li>
          <li>• {t('legal.terms.service_description.feature2')}</li>
          <li>• {t('legal.terms.service_description.feature3')}</li>
          <li>• {t('legal.terms.service_description.feature4')}</li>
        </ul>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.user_obligations.title')}</h3>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <ul className="text-yellow-800 space-y-2">
            <li>• {t('legal.terms.user_obligations.respect_laws')}</li>
            <li>• {t('legal.terms.user_obligations.no_harassment')}</li>
            <li>• {t('legal.terms.user_obligations.no_illegal_content')}</li>
            <li>• {t('legal.terms.user_obligations.respect_others')}</li>
            <li>• {t('legal.terms.user_obligations.accurate_info')}</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.prohibited_uses.title')}</h3>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <ul className="text-red-800 space-y-2">
            <li>• {t('legal.terms.prohibited_uses.spam')}</li>
            <li>• {t('legal.terms.prohibited_uses.malware')}</li>
            <li>• {t('legal.terms.prohibited_uses.impersonation')}</li>
            <li>• {t('legal.terms.prohibited_uses.copyright')}</li>
            <li>• {t('legal.terms.prohibited_uses.reverse_engineering')}</li>
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.liability.title')}</h3>
        <p className="text-gray-700 mb-3">{t('legal.terms.liability.content')}</p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            {t('legal.terms.liability.disclaimer')}
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.modifications.title')}</h3>
        <p className="text-gray-700">{t('legal.terms.modifications.content')}</p>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.termination.title')}</h3>
        <p className="text-gray-700">{t('legal.terms.termination.content')}</p>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.terms.governing_law.title')}</h3>
        <p className="text-gray-700">{t('legal.terms.governing_law.content')}</p>
      </section>
    </div>
  );

  const LegalNotices = () => (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale className="w-6 h-6 text-blue-600" />
          {t('legal.notices.title')}
        </h2>
      </div>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.notices.publisher.title')}</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.notices.publisher.name')}:</strong> NoNetChat
          </p>
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.notices.publisher.type')}:</strong> {t('legal.notices.publisher.type_value')}
          </p>
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.notices.publisher.contact')}:</strong> contact@nonetchat.com
          </p>
          <p className="text-gray-700">
            <strong>{t('legal.notices.publisher.website')}:</strong> 
            <a href="https://nonetchat.com" className="text-blue-600 hover:text-blue-800 ml-1">
              https://nonetchat.com
            </a>
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.notices.hosting.title')}</h3>
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-700 mb-2">
            <strong>{t('legal.notices.hosting.provider')}:</strong> {t('legal.notices.hosting.provider_value')}
          </p>
          <p className="text-gray-700">
            <strong>{t('legal.notices.hosting.note')}:</strong> {t('legal.notices.hosting.note_value')}
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.notices.intellectual_property.title')}</h3>
        <p className="text-gray-700">{t('legal.notices.intellectual_property.content')}</p>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('legal.notices.open_source.title')}</h3>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 mb-2">{t('legal.notices.open_source.content')}</p>
          <p className="text-green-800">
            <strong>{t('legal.notices.open_source.repository')}:</strong> 
            <a href="https://github.com/nonetchat/nonetchat-web" className="text-green-600 hover:text-green-800 ml-1 underline">
              https://github.com/nonetchat/nonetchat-web
            </a>
          </p>
        </div>
      </section>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('privacy')}
              className={`w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg transition-colors text-center font-medium ${
                activeTab === 'privacy'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t('legal.tabs.privacy')}
            </button>
            <button
              onClick={() => setActiveTab('terms')}
              className={`w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg transition-colors text-center font-medium ${
                activeTab === 'terms'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t('legal.tabs.terms')}
            </button>
            <button
              onClick={() => setActiveTab('legal')}
              className={`w-full sm:w-auto px-4 py-3 sm:py-2 rounded-lg transition-colors text-center font-medium ${
                activeTab === 'legal'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t('legal.tabs.legal_notices')}
            </button>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'privacy' && <PrivacyPolicy />}
          {activeTab === 'terms' && <TermsOfService />}
          {activeTab === 'legal' && <LegalNotices />}
        </div>
      </div>
    </div>
  );
};

export default LegalDocuments;