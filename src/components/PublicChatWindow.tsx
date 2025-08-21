import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import PeerService from '../services/PeerService';
import { Send, ArrowLeft } from 'lucide-react';

interface PublicChatWindowProps {
  roomId: string | null;
  roomName: string;
  myId: string;
  messages: any[];
  onBack: () => void;
  peers: Map<string, User>;
}

const PublicChatWindow: React.FC<PublicChatWindowProps> = ({ roomId, roomName, myId, messages, onBack, peers }) => {
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const peerService = PeerService.getInstance();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setNewMessage('');
  }, [roomId]);

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      peerService.broadcastToPublicRoom(newMessage);
      setNewMessage('');
    }
  };

  return (
       <div className="flex-1 flex flex-col min-h-0" data-room-id={roomId ?? 'public'}>
      <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-800 shrink-0" aria-label="Retour">
            <ArrowLeft size={20} />
          </button>
          <h3 className="font-semibold text-gray-900 truncate">{roomName}</h3>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, index) => {
          const sender = peers.get(msg.origin);
          const isMe = msg.origin === myId;
          return (
            <div key={index} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-xs text-gray-500 ml-2 mb-1">{sender?.name || msg.origin.slice(0, 6)}</span>}
                <div
                  className={`relative max-w-xs md:max-w-md px-4 py-2 rounded-lg ${
                    isMe ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                  <p>{msg.text}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 bg-white sticky bottom-0 z-10">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Message public..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim()}
            className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default PublicChatWindow;