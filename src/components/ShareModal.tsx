import React, { useState } from 'react';
import { X, Facebook, Twitter, Linkedin, MessageCircle, Send, Mail, Share2, Copy, Check } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const appUrl = 'https://web.nonetchat.com';
  const appTitle = 'NoNetChat Web - Messagerie P2P Sécurisée';
  const appDescription = 'Messagerie hyperlocale P2P avec chiffrement de bout en bout. Communiquez en toute sécurité sans serveur central.';

  if (!isOpen) return null;

  const shareToFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(appUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  };

  const shareToTwitter = () => {
    const text = `${appTitle} - ${appDescription}`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(appUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  };

  const shareToLinkedIn = () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(appUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  };

  const shareToWhatsApp = () => {
    const text = `${appTitle} - ${appDescription} ${appUrl}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const shareToTelegram = () => {
    const text = `${appTitle} - ${appDescription}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(appTitle);
    const body = encodeURIComponent(`${appDescription}\n\n${appUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: appTitle,
          text: appDescription,
          url: appUrl,
        });
      } catch (error) {
        console.log('Partage annulé ou échoué:', error);
      }
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Erreur lors de la copie:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Share2 size={20} className="text-blue-600" />
            <span className="font-medium text-gray-900">NoNetChat Web</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Fermer"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-4 gap-3 mb-4">
            {/* Partage natif (si supporté) */}
            {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
              <button
                onClick={shareNative}
                className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
                title="Partager"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-blue-200 transition-colors">
                  <Share2 size={20} className="text-blue-600" />
                </div>
              </button>
            )}

            {/* Facebook */}
            <button
              onClick={shareToFacebook}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="Facebook"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-blue-200 transition-colors">
                <Facebook size={20} className="text-blue-600" />
              </div>
            </button>

            {/* Twitter */}
            <button
              onClick={shareToTwitter}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="Twitter / X"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-blue-200 transition-colors">
                <Twitter size={20} className="text-blue-400" />
              </div>
            </button>

            {/* LinkedIn */}
            <button
              onClick={shareToLinkedIn}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="LinkedIn"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-blue-200 transition-colors">
                <Linkedin size={20} className="text-blue-700" />
              </div>
            </button>

            {/* WhatsApp */}
            <button
              onClick={shareToWhatsApp}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="WhatsApp"
            >
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-green-200 transition-colors">
                <MessageCircle size={20} className="text-green-600" />
              </div>
            </button>

            {/* Telegram */}
            <button
              onClick={shareToTelegram}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="Telegram"
            >
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-blue-200 transition-colors">
                <Send size={20} className="text-blue-500" />
              </div>
            </button>

            {/* Email */}
            <button
              onClick={shareViaEmail}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title="Email"
            >
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-1 group-hover:bg-gray-200 transition-colors">
                <Mail size={20} className="text-gray-600" />
              </div>
            </button>

            {/* Copier le lien */}
            <button
              onClick={copyToClipboard}
              className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors group"
              title={copied ? "Copié !" : "Copier le lien"}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-1 transition-colors ${
                copied 
                  ? 'bg-green-100 group-hover:bg-green-200' 
                  : 'bg-gray-100 group-hover:bg-gray-200'
              }`}>
                {copied ? (
                  <Check size={20} className="text-green-600" />
                ) : (
                  <Copy size={20} className="text-gray-600" />
                )}
              </div>
            </button>
          </div>

          {/* URL display */}
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-sm text-gray-600 font-mono break-all">{appUrl}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;