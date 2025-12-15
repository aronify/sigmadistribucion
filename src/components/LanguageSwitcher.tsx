import React from 'react';
import { useTranslation } from 'react-i18next';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const handleSwitch = (lang: 'en' | 'al') => {
    i18n.changeLanguage(lang);
    localStorage.setItem('sigma-lang', lang);
  };
  
  const currentLang = i18n.language === 'al' ? 'al' : 'en';
  
  return (
    <div className="relative inline-flex items-center bg-gray-100 rounded-full p-1">
      <button
        onClick={() => handleSwitch('en')}
        className={`relative px-2.5 py-1 text-xs font-medium rounded-full transition-all duration-200 ${
          currentLang === 'en' 
            ? 'text-gray-900 bg-white shadow-sm' 
            : 'text-gray-500 hover:text-gray-700'
        }`}
        title="English"
      >
        EN
      </button>
      <button
        onClick={() => handleSwitch('al')}
        className={`relative px-2.5 py-1 text-xs font-medium rounded-full transition-all duration-200 ${
          currentLang === 'al' 
            ? 'text-gray-900 bg-white shadow-sm' 
            : 'text-gray-500 hover:text-gray-700'
        }`}
        title="Albanian / Shqip"
      >
        AL
      </button>
    </div>
  );
}
