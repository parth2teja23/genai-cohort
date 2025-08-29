"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Doc {
  pageContent?: string;
  metadata?: {
    loc?: { pageNumber?: number };
    source?: string;
  };
}
interface IMessage {
  role: "assistant" | "user";
  content?: string;
  documents?: Doc[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL as string;

const ChatComponent: React.FC = () => {
  const [message, setMessage] = React.useState("");
  const [messages, setMessages] = React.useState<IMessage[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  // stable session per browser
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let sid = localStorage.getItem("nf_session");
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem("nf_session", sid);
    }
  }, []);

  const handleSendChatMessage = async () => {
    const text = message.trim();
    console.log("API URL:", process.env.NEXT_PUBLIC_API_URL);

    if (!text) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessage("");
    setIsLoading(true);

    try {
      const sessionId = localStorage.getItem("nf_session") || "default";
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Chat failed");
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.message,
          documents: (data?.docs ?? []) as Doc[],
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${e.message || "Something went wrong"}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-3 pb-20">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl shadow
                ${msg.role === "user" ? "bg-blue-500 text-white rounded-br-none" : "bg-gray-200 text-gray-900 rounded-bl-none"}
              `}
            >
              {msg.content}

              {msg.documents && msg.documents.length > 0 && (
                <div className="mt-2 text-xs text-gray-700 space-y-1">
                  {msg.documents.map((doc, i) => {
                    const source = doc.metadata?.source ?? "Unknown file";
                    const page = doc.metadata?.loc?.pageNumber ?? "N/A";
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
        {isLoading && <div className="text-xs text-gray-500 italic">assistant is typing…</div>}
      </div>

      <div className="sticky bottom-0 left-0 w-full flex gap-3 bg-white p-3 border-t">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message here"
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
        />
        <Button onClick={handleSendChatMessage} disabled={!message.trim() || isLoading}>
          Send
        </Button>
      </div>
    </div>
  );
};

export default ChatComponent;
