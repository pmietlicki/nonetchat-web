import React from 'react';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { t } from '../i18n';

interface MessageStatusIndicatorProps {
  status: 'sending' | 'sent' | 'delivered' | 'read';
  className?: string;
}

const MessageStatusIndicator: React.FC<MessageStatusIndicatorProps> = ({ status, className = '' }) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'sending':
        return <Clock className={`w-4 h-4 text-gray-400 ${className}`} />;
      case 'sent':
        return <Check className={`w-4 h-4 text-gray-400 ${className}`} />;
      case 'delivered':
        return <CheckCheck className={`w-4 h-4 text-gray-500 ${className}`} />;
      case 'read':
        return <CheckCheck className={`w-4 h-4 text-blue-500 ${className}`} />;
      default:
        return <AlertCircle className={`w-4 h-4 text-red-400 ${className}`} />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'sending':
        return t('messageStatus.sending');
      case 'sent':
        return t('messageStatus.sent');
      case 'delivered':
        return t('messageStatus.delivered');
      case 'read':
        return t('messageStatus.read');
      default:
        return t('messageStatus.error');
    }
  };

  return (
    <div className="flex items-center gap-1" title={getStatusText()}>
      {getStatusIcon()}
    </div>
  );
};

export default MessageStatusIndicator;
