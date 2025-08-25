'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as React from 'react';

interface Doc {
  pageContent?: string;
  metdata?: {
    loc?: {
      pageNumber?: number;
    };
    source?: string;
  };
}
interface IMessage {
  role: 'assistant' | 'user';
  content?: string;
  documents?: Doc[];
}

const ChatComponent: React.FC = () => {
  const [message, setMessage] = React.useState<string>('');
  const [messages, setMessages] = React.useState<IMessage[]>([]);

  const handleSendChatMessage = async () => {
    if (!message.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setMessage('');

    const res = await fetch(`http://localhost:8000/chat?message=${message}`);
    const data = await res.json();

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: data?.message,
        documents: data?.docs,
      },
    ]);
  };

return (
  <div className="p-4 h-screen flex flex-col">
    {/* Chat Messages */}
    <div className="flex-1 overflow-y-auto space-y-3 pb-20">
      {messages.map((msg, index) => (
        <div
          key={index}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl shadow 
              ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-900 rounded-bl-none'
              }`}
          >
            {msg.content}

            {/* Document References */}
            {msg.documents && msg.documents.length > 0 && (
              <div className="mt-2 text-xs text-gray-700 space-y-1">
                {msg.documents.map((doc, i) => {
                  const source = doc.metadata?.source || "Unknown file";
                  const page = doc.metadata?.loc?.pageNumber || "N/A";
                  return (
                    <div key={i} className="truncate">
                      📄 <span className="font-medium">{source}</span> (Page {page})
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>

    {/* Input Box (sticky inside chat column) */}
    <div className="sticky bottom-0 left-0 w-full flex gap-3 bg-white p-3 border-t">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message here"
        className="flex-1"
        onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
      />
      <Button onClick={handleSendChatMessage} disabled={!message.trim()}>
        Send
      </Button>
    </div>
  </div>
);
};

export default ChatComponent;

