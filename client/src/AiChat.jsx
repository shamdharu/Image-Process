import { useState } from "react";
import {
  Bot,
  ChevronDown,
  LoaderCircle,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import "./AiChat.css";

const apiFetch = (path, options = {}) =>
  fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}${path}`, { credentials: "include", ...options });

function formatInline(text) {
  const pieces = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**"))
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`"))
      return <code key={index}>{piece.slice(1, -1)}</code>;
    return <span key={index}>{piece}</span>;
  });
}

function FormattedReply({ text }) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      blocks.push(
        <h3 key={`heading-${index}`}>
          {formatInline(line.replace(/^#{1,3}\s+/, ""))}
        </h3>,
      );
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(
          <li key={`bullet-${index}`}>
            {formatInline(lines[index].trim().replace(/^[-*]\s+/, ""))}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(
          <li key={`number-${index}`}>
            {formatInline(lines[index].trim().replace(/^\d+[.)]\s+/, ""))}
          </li>,
        );
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items}</ol>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^#{1,3}\s|^[-*]\s+|^\d+[.)]\s+/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>{formatInline(paragraph.join(" "))}</p>,
    );
  }
  return <div className="ai-formatted-reply">{blocks}</div>;
}

export default function AiChat({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async (event) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || loading) return;
    setDraft("");
    setError("");
    const nextMessages = [...messages, { role: "user", text: message }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const response = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || "The assistant could not respond.");
      setMessages([...nextMessages, { role: "model", text: body.text }]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  return (
    <aside className="ai-chat" aria-label="Imaginary Assistant">
      <header className="ai-chat-header">
        <span className="ai-chat-mark">
          <Sparkles size={16} />
        </span>
        <div>
          <strong>Imaginary Assistant</strong>
          <small>Gemini Flash</small>
        </div>
        <button
          className="ai-chat-icon"
          onClick={onClose}
          aria-label="Close assistant"
        >
          <X size={16} />
        </button>
      </header>
      <div className="ai-chat-body">
        {messages.length === 0 && (
          <div className="ai-chat-welcome">
            <span className="ai-chat-welcome-icon">
              <Bot size={22} />
            </span>
            <h2>How can I help?</h2>
            <p>
              Ask about organizing images, planning folders, or improving your
              creative workflow.
            </p>
            <div className="ai-suggestions">
              <button
                onClick={() => setDraft("Help me organize a new image project")}
              >
                <ChevronDown size={13} /> Organize a project
              </button>
              <button
                onClick={() =>
                  setDraft("Suggest useful metadata for my image library")
                }
              >
                <ChevronDown size={13} /> Suggest metadata
              </button>
            </div>
          </div>
        )}
        {messages.map((item, index) => (
          <div
            className={`ai-message ${item.role}`}
            key={`${item.role}-${index}`}
          >
            {item.role === "model" ? (
              <FormattedReply text={item.text} />
            ) : (
              <span>{item.text}</span>
            )}
          </div>
        ))}
        {loading && (
          <div className="ai-message model ai-thinking">
            <LoaderCircle size={14} /> Thinking...
          </div>
        )}
        {error && <p className="ai-error">{error}</p>}
      </div>
      <form className="ai-chat-form" onSubmit={sendMessage}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask Imaginary Assistant..."
          rows={2}
          disabled={loading}
        />
        <div>
          <span>Gemini Flash</span>
          <button
            type="button"
            onClick={() => setMessages([])}
            aria-label="Clear conversation"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="ai-send"
            type="submit"
            disabled={!draft.trim() || loading}
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </aside>
  );
}
