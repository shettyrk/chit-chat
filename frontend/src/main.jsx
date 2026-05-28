import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { Check, CheckCheck, Image, LogOut, Paperclip, Send, Users } from 'lucide-react';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:8083/ws';
const ApiContext = createContext(null);

function chatIdentity(chat) {
  if (chat.type === 'PRIVATE') return `PRIVATE:${[...chat.memberIds].sort((a, b) => a - b).join(':')}`;
  return `GROUP:${chat.id}`;
}

function dedupeChats(chats) {
  const byIdentity = new Map();
  chats.forEach((chat) => {
    const key = chatIdentity(chat);
    const existing = byIdentity.get(key);
    if (!existing || chat.id < existing.id) byIdentity.set(key, chat);
  });
  return [...byIdentity.values()].sort((a, b) => b.id - a.id);
}

function ApiProvider({ children }) {
  const [session, setSession] = useState(() => {
    const raw = localStorage.getItem('session');
    return raw ? JSON.parse(raw) : null;
  });

  const api = useMemo(() => {
    const client = axios.create({ baseURL: API_BASE_URL });
    client.interceptors.request.use((config) => {
      if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
      return config;
    });
    return client;
  }, [session]);

  const login = async (phone, password) => {
    const { data } = await axios.post(`${API_BASE_URL}/api/users/login`, { phone, password });
    localStorage.setItem('session', JSON.stringify(data));
    setSession(data);
  };

  const register = async (name, phone, password) => {
    await axios.post(`${API_BASE_URL}/api/users/register`, { name, phone, password });
    await login(phone, password);
  };

  const logout = () => {
    localStorage.removeItem('session');
    setSession(null);
  };

  return <ApiContext.Provider value={{ api, session, login, register, logout }}>{children}</ApiContext.Provider>;
}

function useApi() {
  return useContext(ApiContext);
}

function AuthScreen() {
  const { login, register } = useApi();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      if (mode === 'login') await login(form.phone, form.password);
      else await register(form.name, form.phone, form.password);
    } catch {
      setError('Authentication failed');
    }
  };

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={submit}>
        <h1>NATS Chat</h1>
        <div className="segmented">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>
        {mode === 'register' && (
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        )}
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">{mode === 'login' ? 'Login' : 'Create Account'}</button>
      </form>
    </main>
  );
}

function ChatApp() {
  const { api, session, logout } = useApi();
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presenceByUser, setPresenceByUser] = useState({});
  const [typing, setTyping] = useState(null);
  const stompRef = useRef(null);
  const activeChatRef = useRef(null);
  const knownChatIdsRef = useRef(new Set());

  const markMessagesRead = useCallback((chatId, chatMessages) => {
    chatMessages
      .filter((message) => message.senderId !== session.user.id)
      .forEach((message) => {
        api.patch(`/api/messages/${message.id}/status`, {
          chatId,
          userId: session.user.id,
          status: 'READ'
        }).catch(() => {});
      });
  }, [api, session.user.id]);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    knownChatIdsRef.current = new Set(chats.map((chat) => chat.id));
  }, [chats]);

  useEffect(() => {
    api.post(`/api/presence/${session.user.id}/online`).catch(() => {});
    const heartbeat = setInterval(() => {
      api.post(`/api/presence/${session.user.id}/online`).catch(() => {});
    }, 120000);
    Promise.all([
      api.get('/api/users'),
      api.get(`/api/chats/users/${session.user.id}`).catch(() => ({ data: [] }))
    ]).then(([userResponse, chatResponse]) => {
      const otherUsers = userResponse.data.filter((user) => user.id !== session.user.id);
      setUsers(otherUsers);
      setChats(dedupeChats(chatResponse.data));
      Promise.all(otherUsers.map((user) => api.get(`/api/presence/${user.id}`).catch(() => ({ data: { userId: user.id, status: user.status || 'OFFLINE' } }))))
        .then((responses) => {
          setPresenceByUser(Object.fromEntries(responses.map(({ data }) => [Number(data.userId), data.status])));
        });
    });
    return () => {
      clearInterval(heartbeat);
      api.post(`/api/presence/${session.user.id}/offline`).catch(() => {});
    };
  }, [api, session.user.id]);

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: 3000,
      onConnect: () => {
        client.subscribe(`/topic/messages/${session.user.id}`, (frame) => {
          const message = JSON.parse(frame.body);
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
          if (!knownChatIdsRef.current.has(message.chatId)) {
            api.get(`/api/chats/${message.chatId}`).then(({ data }) => {
              setChats((current) => dedupeChats(current.some((chat) => chat.id === data.id) ? current : [data, ...current]));
            }).catch(() => {});
          }
          if (activeChatRef.current?.id === message.chatId) {
            markMessagesRead(message.chatId, [message]);
          }
        });
        client.subscribe('/topic/presence', (frame) => {
          const event = JSON.parse(frame.body);
          setPresenceByUser((current) => ({ ...current, [event.userId]: event.status }));
        });
      }
    });
    client.activate();
    stompRef.current = client;
    return () => client.deactivate();
  }, [api, markMessagesRead, session.user.id]);

  useEffect(() => {
    if (!activeChat || !stompRef.current?.connected) return;
    const typingSub = stompRef.current.subscribe(`/topic/typing/${activeChat.id}`, (frame) => {
      const event = JSON.parse(frame.body);
      if (event.userId !== session.user.id) {
        setTyping(event.typing ? event.userId : null);
        if (event.typing) setTimeout(() => setTyping(null), 1800);
      }
    });
    const readSub = stompRef.current.subscribe(`/topic/read/${activeChat.id}`, () => {
      setMessages((current) => current.map((message) => message.chatId === activeChat.id ? { ...message, status: 'READ' } : message));
    });
    return () => {
      typingSub.unsubscribe();
      readSub.unsubscribe();
    };
  }, [activeChat, session.user.id]);

  const openChat = async (chat) => {
    setActiveChat(chat);
    const { data } = await api.get(`/api/messages/chats/${chat.id}`);
    setMessages(data);
    markMessagesRead(chat.id, data);
  };

  const chatTitle = (chat) => {
    if (chat.name) return chat.name;
    if (chat.type === 'GROUP') return 'Group chat';
    const otherUserId = chat.memberIds.find((id) => id !== session.user.id);
    return users.find((user) => user.id === otherUserId)?.name || `Private chat #${chat.id}`;
  };

  const chatSubtitle = (chat) => {
    if (chat.type === 'GROUP') return `${chat.memberIds.length} members`;
    const otherUserId = chat.memberIds.find((id) => id !== session.user.id);
    return presenceByUser[otherUserId] || 'OFFLINE';
  };

  const createPrivateChat = async (otherUserId) => {
    const existing = dedupeChats(chats).find((chat) => chat.type === 'PRIVATE' && chat.memberIds.includes(otherUserId));
    if (existing) return openChat(existing);
    const { data } = await api.post('/api/chats', { type: 'PRIVATE', memberIds: [session.user.id, otherUserId] });
    setChats((current) => dedupeChats([data, ...current]));
    openChat(data);
  };

  const createGroup = async () => {
    const selected = users.slice(0, 2).map((user) => user.id);
    if (!selected.length) return;
    const { data } = await api.post('/api/chats', { type: 'GROUP', name: 'New Group', memberIds: [session.user.id, ...selected] });
    setChats((current) => dedupeChats([data, ...current]));
    openChat(data);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="profile-row">
          <div>
            <strong>{session.user.name}</strong>
            <span>Online</span>
          </div>
          <button className="icon-button" onClick={logout} title="Logout"><LogOut size={18} /></button>
        </div>
        <button className="group-button" onClick={createGroup}><Users size={17} /> New group</button>
        <section>
          <h2>Chats</h2>
          {dedupeChats(chats).map((chat) => (
            <button key={chat.id} className={`chat-row ${activeChat?.id === chat.id ? 'active' : ''}`} onClick={() => openChat(chat)}>
              <span>{chatTitle(chat)}</span>
              <small>{chatSubtitle(chat)}</small>
            </button>
          ))}
        </section>
        <section>
          <h2>People</h2>
          {users.map((user) => (
            <button key={user.id} className="chat-row" onClick={() => createPrivateChat(user.id)}>
              <span>{user.name}</span>
              <small>{presenceByUser[user.id] || 'OFFLINE'}</small>
            </button>
          ))}
        </section>
      </aside>
      <ChatWindow
        chat={activeChat}
        messages={messages.filter((message) => message.chatId === activeChat?.id)}
        typing={typing}
        users={users}
        presenceByUser={presenceByUser}
        onSent={(message) => setMessages((current) => [...current, message])}
      />
    </main>
  );
}

function ChatWindow({ chat, messages, typing, users, presenceByUser, onSent }) {
  const { api, session } = useApi();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

  if (!chat) {
    return <section className="empty-state">Select a conversation</section>;
  }

  const recipients = chat.memberIds.filter((id) => id !== session.user.id);
  const otherUserId = chat.type === 'PRIVATE' ? recipients[0] : null;
  const title = chat.name || (chat.type === 'GROUP' ? 'Group chat' : users.find((user) => user.id === otherUserId)?.name || 'Private chat');
  const subtitle = typing
    ? `${users.find((user) => user.id === typing)?.name || 'Someone'} is typing`
    : chat.type === 'PRIVATE'
      ? presenceByUser[otherUserId] || 'OFFLINE'
      : `${chat.memberIds.length} members`;
  const sendTyping = (typingState) => {
    api.post('/api/presence/typing', { chatId: chat.id, userId: session.user.id, typing: typingState }).catch(() => {});
  };

  const send = async (event) => {
    event.preventDefault();
    let mediaUrl = null;
    let type = 'TEXT';
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/api/messages/media', form);
      mediaUrl = data.url;
      type = file.type.startsWith('image/') ? 'IMAGE' : 'FILE';
    }
    if (!text.trim() && !mediaUrl) return;
    const { data } = await api.post('/api/messages', {
      chatId: chat.id,
      senderId: session.user.id,
      recipientIds: recipients,
      content: text,
      type,
      mediaUrl
    });
    onSent({ ...data, status: 'SENT' });
    setText('');
    setFile(null);
    sendTyping(false);
  };

  return (
    <section className="chat-window">
      <header className="chat-header">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="message-list">
        {messages.map((message) => {
          const own = message.senderId === session.user.id;
          return (
            <article key={message.id} className={`bubble ${own ? 'own' : ''}`}>
              {message.type === 'IMAGE' && <img src={`${API_BASE_URL}${message.mediaUrl}`} alt="" />}
              {message.type === 'FILE' && <a href={`${API_BASE_URL}${message.mediaUrl}`}>Attachment</a>}
              {message.content && <p>{message.content}</p>}
              <footer>
                <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                {own && <StatusIcon status={message.status || 'SENT'} />}
              </footer>
            </article>
          );
        })}
      </div>
      <form className="composer" onSubmit={send}>
        <label className="icon-button" title="Attach file">
          <Paperclip size={18} />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <label className="icon-button" title="Attach image">
          <Image size={18} />
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <input
          value={text}
          placeholder={file ? file.name : 'Message'}
          onFocus={() => sendTyping(true)}
          onBlur={() => sendTyping(false)}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="send-button" type="submit" title="Send"><Send size={18} /></button>
      </form>
    </section>
  );
}

function StatusIcon({ status }) {
  if (status === 'READ') return <CheckCheck size={15} className="read" />;
  if (status === 'DELIVERED') return <CheckCheck size={15} />;
  return <Check size={15} />;
}

function Root() {
  const { session } = useApi();
  return session ? <ChatApp /> : <AuthScreen />;
}

createRoot(document.getElementById('root')).render(
  <ApiProvider>
    <Root />
  </ApiProvider>
);
