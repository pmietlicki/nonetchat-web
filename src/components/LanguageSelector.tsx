import React, { useState } from 'react';
import { SUPPORTED_LANGUAGES, setLanguage } from '../i18n';
import { t } from '../i18n';

interface LanguageSelectorProps {
  currentLanguage: string;
  onLanguageChange?: (language: string) => void;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ 
  currentLanguage, 
  onLanguageChange 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  const handleLanguageChange = async (langCode: string) => {
    if (langCode === currentLanguage) {
      setIsOpen(false);
      return;
    }

    setIsChanging(true);
    try {
      await setLanguage(langCode);
      onLanguageChange?.(langCode);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to change language:', error);
    } finally {
      setIsChanging(false);
    }
  };

  const currentLangData = SUPPORTED_LANGUAGES.find(lang => lang.code === currentLanguage);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {t('languageSelector.label')}
      </label>
      
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isChanging}
        className="w-full px-3 py-2 text-left bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center justify-between">
          <span className="text-gray-900 dark:text-gray-100">
            {currentLangData ? currentLangData.nativeName : currentLanguage}
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'transform rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language.code}
              onClick={() => handleLanguageChange(language.code)}
              disabled={isChanging}
              className={`w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed ${
                language.code === currentLanguage
                  ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{language.nativeName}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {language.name}
                  </div>
                </div>
                {language.code === currentLanguage && (
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {isChanging && (
        <div className="absolute inset-0 bg-white dark:bg-gray-700 bg-opacity-75 flex items-center justify-center rounded-md">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      )}
    </div>
  );
};

export default LanguageSelector;