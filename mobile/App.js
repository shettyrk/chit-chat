import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image as NativeImage,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '@stomp/stompjs';

const DEFAULT_API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
const DEFAULT_WEB_SOCKET_URL = webSocketUrlFromApiBase(DEFAULT_API_BASE_URL);
const STORAGE_KEYS = {
  apiBaseUrl: 'settings:apiBaseUrl',
  webSocketUrl: 'settings:webSocketUrl',
  session: 'session'
};

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function webSocketUrlFromApiBase(apiBaseUrl) {
  const normalized = normalizeUrl(apiBaseUrl);
  try {
    const url = new URL(normalized);
    if (url.port === '8080') url.port = '8083';
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/websocket';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return `${normalized.replace(/^http/i, 'ws')}/ws/websocket`;
  }
}

function normalizeWebSocketUrl(value, apiBaseUrl) {
  const raw = normalizeUrl(value || webSocketUrlFromApiBase(apiBaseUrl));
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!url.pathname || url.pathname === '/') url.pathname = '/ws/websocket';
    if (url.pathname === '/ws') url.pathname = '/ws/websocket';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function absoluteMediaUrl(apiBaseUrl, mediaUrl) {
  if (!mediaUrl) return null;
  if (/^https?:\/\//i.test(mediaUrl)) return mediaUrl;
  return `${apiBaseUrl}${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function chatsKey(userId) {
  return `cache:${userId}:chats`;
}

function usersKey(userId) {
  return `cache:${userId}:users`;
}

function messagesKey(chatId) {
  return `cache:chat:${chatId}:messages`;
}

async function readJson(key, fallback) {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

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

function upsertMessage(messages, message) {
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
}

function fileNameFromUrl(mediaUrl) {
  if (!mediaUrl) return 'Attachment';
  const name = decodeURIComponent(mediaUrl.split('/').pop() || 'Attachment');
  return name.replace(/^[0-9a-f-]+-/i, '') || 'Attachment';
}

function uploadErrorMessage(error) {
  if (error?.response?.status === 413) return 'The selected file is too large for the server.';
  return error?.response?.data?.message || error?.message || 'Message was not sent. Check your connection.';
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [webSocketUrl, setWebSocketUrl] = useState(DEFAULT_WEB_SOCKET_URL);
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.apiBaseUrl),
      AsyncStorage.getItem(STORAGE_KEYS.webSocketUrl),
      readJson(STORAGE_KEYS.session, null)
    ]).then(([storedApiBaseUrl, storedWebSocketUrl, storedSession]) => {
      if (storedApiBaseUrl) setApiBaseUrl(storedApiBaseUrl);
      if (storedWebSocketUrl) setWebSocketUrl(storedWebSocketUrl);
      else if (storedApiBaseUrl) setWebSocketUrl(webSocketUrlFromApiBase(storedApiBaseUrl));
      if (storedSession) setSession(storedSession);
    }).finally(() => setBooting(false));
  }, []);

  const api = useMemo(() => {
    const client = axios.create({ baseURL: apiBaseUrl, timeout: 12000 });
    client.interceptors.request.use((config) => {
      if (session?.token) config.headers.Authorization = `Bearer ${session.token}`;
      return config;
    });
    return client;
  }, [apiBaseUrl, session]);

  const saveServerUrls = async (nextApiBaseUrl, nextWebSocketUrl) => {
    const normalizedApiBaseUrl = normalizeUrl(nextApiBaseUrl);
    const normalizedWebSocketUrl = normalizeWebSocketUrl(nextWebSocketUrl, normalizedApiBaseUrl);
    setApiBaseUrl(normalizedApiBaseUrl);
    setWebSocketUrl(normalizedWebSocketUrl);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalizedApiBaseUrl),
      AsyncStorage.setItem(STORAGE_KEYS.webSocketUrl, normalizedWebSocketUrl)
    ]);
    return { apiBaseUrl: normalizedApiBaseUrl, webSocketUrl: normalizedWebSocketUrl };
  };

  const login = async (phone, password, nextApiBaseUrl = apiBaseUrl) => {
    const normalizedApiBaseUrl = normalizeUrl(nextApiBaseUrl);
    const { data } = await axios.post(`${normalizedApiBaseUrl}/api/users/login`, { phone, password });
    await writeJson(STORAGE_KEYS.session, data);
    setSession(data);
  };

  const register = async (name, phone, password, nextApiBaseUrl = apiBaseUrl) => {
    const normalizedApiBaseUrl = normalizeUrl(nextApiBaseUrl);
    await axios.post(`${normalizedApiBaseUrl}/api/users/register`, { name, phone, password });
    await login(phone, password, normalizedApiBaseUrl);
  };

  const logout = async () => {
    if (session?.user?.id) {
      api.post(`/api/presence/${session.user.id}/offline`).catch(() => {});
    }
    await AsyncStorage.removeItem(STORAGE_KEYS.session);
    setSession(null);
  };

  if (booting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {session ? (
        <ChatApp
          api={api}
          apiBaseUrl={apiBaseUrl}
          webSocketUrl={webSocketUrl}
          session={session}
          onLogout={logout}
        />
      ) : (
        <AuthScreen
          apiBaseUrl={apiBaseUrl}
          webSocketUrl={webSocketUrl}
          onServerUrlsChange={saveServerUrls}
          onLogin={login}
          onRegister={register}
        />
      )}
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

function AuthScreen({ apiBaseUrl, webSocketUrl, onServerUrlsChange, onLogin, onRegister }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(apiBaseUrl);
  const [socketUrl, setSocketUrl] = useState(webSocketUrl);
  const [socketEdited, setSocketEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  const updateServerUrl = (value) => {
    setServerUrl(value);
    if (!socketEdited) setSocketUrl(webSocketUrlFromApiBase(value));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const saved = await onServerUrlsChange(serverUrl, socketUrl);
      if (mode === 'register') await onRegister(name, phone, password, saved.apiBaseUrl);
      else await onLogin(phone, password, saved.apiBaseUrl);
    } catch (error) {
      Alert.alert('Authentication failed', error?.response?.data?.error || 'Check server URLs and credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authScreen}>
      <View style={styles.panel}>
        <Text style={styles.title}>NATS Chat</Text>
        <View style={styles.segmented}>
          <Pressable style={[styles.segment, mode === 'login' && styles.segmentActive]} onPress={() => setMode('login')}>
            <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>Login</Text>
          </Pressable>
          <Pressable style={[styles.segment, mode === 'register' && styles.segmentActive]} onPress={() => setMode('register')}>
            <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>Register</Text>
          </Pressable>
        </View>
        <TextInput style={styles.input} value={serverUrl} onChangeText={updateServerUrl} autoCapitalize="none" placeholder="API server URL" />
        <TextInput
          style={styles.input}
          value={socketUrl}
          onChangeText={(value) => {
            setSocketEdited(true);
            setSocketUrl(value);
          }}
          autoCapitalize="none"
          placeholder="WebSocket URL"
        />
        {mode === 'register' && <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" />}
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone" />
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
        <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} onPress={submit} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Please wait' : mode === 'login' ? 'Login' : 'Create account'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatApp({ api, apiBaseUrl, webSocketUrl, session, onLogout }) {
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presenceByUser, setPresenceByUser] = useState({});
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [socketStatus, setSocketStatus] = useState('Connecting');
  const [socketConnected, setSocketConnected] = useState(false);
  const [typingUserId, setTypingUserId] = useState(null);
  const [groupBuilderOpen, setGroupBuilderOpen] = useState(false);
  const [groupName, setGroupName] = useState('New Group');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);

  const activeChatRef = useRef(null);
  const knownChatIdsRef = useRef(new Set());
  const stompRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    knownChatIdsRef.current = new Set(chats.map((chat) => chat.id));
  }, [chats]);

  const cacheMessages = useCallback((chatId, nextMessages) => {
    writeJson(messagesKey(chatId), nextMessages).catch(() => {});
  }, []);

  const cacheIncomingMessage = useCallback(async (message) => {
    const cached = await readJson(messagesKey(message.chatId), []);
    await writeJson(messagesKey(message.chatId), upsertMessage(cached, message));
  }, []);

  const updateChats = useCallback((updater) => {
    setChats((current) => {
      const nextChats = dedupeChats(typeof updater === 'function' ? updater(current) : updater);
      writeJson(chatsKey(session.user.id), nextChats).catch(() => {});
      return nextChats;
    });
  }, [session.user.id]);

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

  const loadLocalCache = useCallback(async () => {
    const [cachedUsers, cachedChats] = await Promise.all([
      readJson(usersKey(session.user.id), []),
      readJson(chatsKey(session.user.id), [])
    ]);
    setUsers(cachedUsers);
    setChats(dedupeChats(cachedChats));
  }, [session.user.id]);

  const sync = useCallback(async () => {
    setLoading(true);
    try {
      await api.post(`/api/presence/${session.user.id}/online`).catch(() => {});
      const [userResponse, chatResponse] = await Promise.all([
        api.get('/api/users'),
        api.get(`/api/chats/users/${session.user.id}`)
      ]);
      const otherUsers = userResponse.data.filter((user) => user.id !== session.user.id);
      const nextChats = dedupeChats(chatResponse.data);
      setUsers(otherUsers);
      setChats(nextChats);
      await Promise.all([
        writeJson(usersKey(session.user.id), otherUsers),
        writeJson(chatsKey(session.user.id), nextChats)
      ]);
      const presenceResponses = await Promise.all(
        otherUsers.map((user) => api.get(`/api/presence/${user.id}`).catch(() => ({ data: { userId: user.id, status: 'OFFLINE' } })))
      );
      setPresenceByUser(Object.fromEntries(presenceResponses.map(({ data }) => [Number(data.userId), data.status])));
    } catch {
      Alert.alert('Sync failed', 'Showing locally cached data.');
    } finally {
      setLoading(false);
    }
  }, [api, session.user.id]);

  useEffect(() => {
    loadLocalCache().then(sync);
    const heartbeat = setInterval(() => {
      api.post(`/api/presence/${session.user.id}/online`).catch(() => {});
    }, 120000);
    return () => {
      clearInterval(heartbeat);
      api.post(`/api/presence/${session.user.id}/offline`).catch(() => {});
    };
  }, [api, loadLocalCache, session.user.id, sync]);

  useEffect(() => {
    let disposed = false;
    const client = new Client({
      appendMissingNULLonIncoming: true,
      debug: () => {},
      heartbeatIncoming: 0,
      heartbeatOutgoing: 20000,
      reconnectDelay: 3000,
      webSocketFactory: () => new WebSocket(webSocketUrl)
    });

    client.onConnect = () => {
      if (disposed) return;
      setSocketConnected(true);
      setSocketStatus('Live');

      client.subscribe(`/topic/messages/${session.user.id}`, (frame) => {
        const incoming = parseJson(frame.body);
        if (!incoming?.id) return;
        const message = { ...incoming, status: incoming.status || 'SENT' };
        cacheIncomingMessage(message).catch(() => {});
        if (activeChatRef.current?.id === message.chatId) {
          setMessages((current) => {
            const nextMessages = upsertMessage(current, message);
            cacheMessages(message.chatId, nextMessages);
            return nextMessages;
          });
          markMessagesRead(message.chatId, [message]);
        }
        if (!knownChatIdsRef.current.has(message.chatId)) {
          api.get(`/api/chats/${message.chatId}`).then(({ data }) => {
            updateChats((current) => current.some((chat) => chat.id === data.id) ? current : [data, ...current]);
          }).catch(() => {});
        }
      });

      client.subscribe('/topic/presence', (frame) => {
        const event = parseJson(frame.body);
        if (!event?.userId) return;
        setPresenceByUser((current) => ({ ...current, [Number(event.userId)]: event.status }));
      });
    };

    client.onStompError = () => {
      if (!disposed) setSocketStatus('Socket error');
    };
    client.onWebSocketClose = () => {
      if (!disposed) {
        setSocketConnected(false);
        setSocketStatus('Reconnecting');
      }
    };
    client.onWebSocketError = () => {
      if (!disposed) setSocketStatus('Socket error');
    };

    setSocketStatus('Connecting');
    stompRef.current = client;
    client.activate();
    return () => {
      disposed = true;
      setSocketConnected(false);
      stompRef.current = null;
      client.deactivate();
    };
  }, [api, cacheIncomingMessage, cacheMessages, markMessagesRead, session.user.id, updateChats, webSocketUrl]);

  useEffect(() => {
    if (!activeChat || !socketConnected || !stompRef.current?.connected) return undefined;
    const client = stompRef.current;
    const typingSub = client.subscribe(`/topic/typing/${activeChat.id}`, (frame) => {
      const event = parseJson(frame.body);
      if (!event || Number(event.userId) === session.user.id) return;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUserId(event.typing ? Number(event.userId) : null);
      if (event.typing) {
        typingTimeoutRef.current = setTimeout(() => setTypingUserId(null), 1800);
      }
    });
    const readSub = client.subscribe(`/topic/read/${activeChat.id}`, (frame) => {
      const event = parseJson(frame.body);
      if (!event?.messageId) return;
      setMessages((current) => {
        const nextMessages = current.map((message) =>
          message.id === event.messageId ? { ...message, status: event.status } : message
        );
        cacheMessages(activeChat.id, nextMessages);
        return nextMessages;
      });
    });
    return () => {
      typingSub.unsubscribe();
      readSub.unsubscribe();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUserId(null);
    };
  }, [activeChat, cacheMessages, session.user.id, socketConnected]);

  const openChat = async (chat) => {
    setActiveChat(chat);
    setTypingUserId(null);
    const cached = await readJson(messagesKey(chat.id), []);
    setMessages(cached);
    try {
      const { data } = await api.get(`/api/messages/chats/${chat.id}`);
      setMessages(data);
      await writeJson(messagesKey(chat.id), data);
      markMessagesRead(chat.id, data);
    } catch {
      Alert.alert('Offline cache', 'Could not refresh this conversation.');
    }
  };

  const createPrivateChat = async (otherUserId) => {
    const existing = dedupeChats(chats).find((chat) => chat.type === 'PRIVATE' && chat.memberIds.includes(otherUserId));
    if (existing) return openChat(existing);
    const { data } = await api.post('/api/chats', { type: 'PRIVATE', memberIds: [session.user.id, otherUserId] });
    updateChats([data, ...chats]);
    return openChat(data);
  };

  const toggleGroupMember = (userId) => {
    setSelectedMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const createGroup = async () => {
    if (!selectedMemberIds.length) {
      Alert.alert('Select people', 'Choose at least one person for the group.');
      return;
    }
    try {
      const { data } = await api.post('/api/chats', {
        type: 'GROUP',
        name: groupName.trim() || 'New Group',
        memberIds: [session.user.id, ...selectedMemberIds]
      });
      updateChats([data, ...chats]);
      setGroupBuilderOpen(false);
      setGroupName('New Group');
      setSelectedMemberIds([]);
      openChat(data);
    } catch {
      Alert.alert('Group failed', 'The group was not created.');
    }
  };

  const sendTyping = useCallback((typing) => {
    const chat = activeChatRef.current;
    if (!chat) return;
    api.post('/api/presence/typing', { chatId: chat.id, userId: session.user.id, typing }).catch(() => {});
  }, [api, session.user.id]);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos unavailable', 'Photo library access is required to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.85
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setAttachment({
        uri: asset.uri,
        name: asset.fileName || `image-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg'
      });
    }
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setAttachment({
        uri: asset.uri,
        name: asset.name || `file-${Date.now()}`,
        type: asset.mimeType || 'application/octet-stream'
      });
    }
  };

  const uploadAttachment = async (file) => {
    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type
    });
    const { data } = await api.post('/api/messages/media', form, { timeout: 120000 });
    return data.url;
  };

  const send = async () => {
    const content = text.trim();
    if ((!content && !attachment) || !activeChat || sending) return;
    const pendingText = text;
    const pendingAttachment = attachment;
    const recipients = activeChat.memberIds.filter((id) => id !== session.user.id);
    setText('');
    setAttachment(null);
    setSending(true);
    try {
      let mediaUrl = null;
      let type = 'TEXT';
      if (pendingAttachment) {
        mediaUrl = await uploadAttachment(pendingAttachment);
        type = pendingAttachment.type?.startsWith('image/') ? 'IMAGE' : 'FILE';
      }
      const { data } = await api.post('/api/messages', {
        chatId: activeChat.id,
        senderId: session.user.id,
        recipientIds: recipients,
        content,
        type,
        mediaUrl
      });
      const sentMessage = { ...data, status: 'SENT' };
      setMessages((current) => {
        const nextMessages = upsertMessage(current, sentMessage);
        cacheMessages(activeChat.id, nextMessages);
        return nextMessages;
      });
      sendTyping(false);
    } catch (error) {
      setText(pendingText);
      setAttachment(pendingAttachment);
      Alert.alert('Send failed', uploadErrorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const userName = (userId) => users.find((user) => user.id === userId)?.name || 'Someone';

  const titleForChat = (chat) => {
    if (chat.name) return chat.name;
    if (chat.type === 'GROUP') return 'Group chat';
    const otherUserId = chat.memberIds.find((id) => id !== session.user.id);
    return users.find((user) => user.id === otherUserId)?.name || `Private chat #${chat.id}`;
  };

  const subtitleForChat = (chat) => {
    if (chat.type === 'GROUP') return `${chat.memberIds.length} members`;
    const otherUserId = chat.memberIds.find((id) => id !== session.user.id);
    return presenceByUser[otherUserId] || 'OFFLINE';
  };

  const activeSubtitle = activeChat
    ? typingUserId
      ? `${userName(typingUserId)} is typing`
      : subtitleForChat(activeChat)
    : '';

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{session.user.name}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{socketStatus} socket - cache enabled</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={sync} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color="#23313f" /> : <Feather name="refresh-cw" size={18} color="#23313f" />}
          </Pressable>
          <Pressable style={styles.iconButton} onPress={onLogout}>
            <Feather name="log-out" size={18} color="#23313f" />
          </Pressable>
        </View>
      </View>

      {activeChat ? (
        <View style={styles.chatPane}>
          <View style={styles.chatHeader}>
            <Pressable style={styles.backButton} onPress={() => setActiveChat(null)}>
              <Feather name="chevron-left" size={24} color="#0f766e" />
            </Pressable>
            <View style={styles.chatHeaderText}>
              <Text style={styles.chatTitle} numberOfLines={1}>{titleForChat(activeChat)}</Text>
              <Text style={styles.chatSubtitle} numberOfLines={1}>{activeSubtitle}</Text>
            </View>
          </View>
          <FlatList
            data={messages.filter((message) => message.chatId === activeChat.id)}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.emptyText}>No messages yet</Text>}
            renderItem={({ item }) => {
              const own = item.senderId === session.user.id;
              const imageUrl = item.type === 'IMAGE' ? absoluteMediaUrl(apiBaseUrl, item.mediaUrl) : null;
              const fileUrl = item.type === 'FILE' ? absoluteMediaUrl(apiBaseUrl, item.mediaUrl) : null;
              return (
                <View style={[styles.bubble, own && styles.bubbleOwn]}>
                  {imageUrl && (
                    <NativeImage
                      style={styles.messageImage}
                      source={{ uri: imageUrl, headers: { Authorization: `Bearer ${session.token}` } }}
                    />
                  )}
                  {fileUrl && (
                    <Pressable style={styles.fileLink} onPress={() => Linking.openURL(fileUrl).catch(() => Alert.alert('Open failed', 'Could not open this file.'))}>
                      <Feather name="paperclip" size={15} color="#0f5d55" />
                      <Text style={styles.fileLinkText} numberOfLines={1}>{fileNameFromUrl(item.mediaUrl)}</Text>
                    </Pressable>
                  )}
                  {Boolean(item.content) && <Text style={styles.messageText}>{item.content}</Text>}
                  <View style={styles.messageMeta}>
                    <Text style={styles.messageTime}>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    {own && <Text style={styles.messageStatus}>{item.status === 'READ' ? 'Read' : 'Sent'}</Text>}
                  </View>
                </View>
              );
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {attachment && (
              <View style={styles.attachmentBar}>
                <View style={styles.attachmentName}>
                  <Feather name={attachment.type?.startsWith('image/') ? 'image' : 'paperclip'} size={16} color="#0f5d55" />
                  <Text style={styles.attachmentText} numberOfLines={1}>{attachment.name}</Text>
                </View>
                <Pressable style={styles.clearAttachmentButton} onPress={() => setAttachment(null)}>
                  <Feather name="x" size={18} color="#23313f" />
                </Pressable>
              </View>
            )}
            <View style={styles.composer}>
              <Pressable style={styles.toolButton} onPress={pickImage}>
                <Feather name="image" size={19} color="#23313f" />
              </Pressable>
              <Pressable style={styles.toolButton} onPress={pickFile}>
                <Feather name="paperclip" size={19} color="#23313f" />
              </Pressable>
              <TextInput
                style={styles.messageInput}
                value={text}
                onBlur={() => sendTyping(false)}
                onChangeText={setText}
                onFocus={() => sendTyping(true)}
                placeholder={attachment ? attachment.name : 'Message'}
                multiline
              />
              <Pressable style={[styles.sendButton, sending && styles.buttonDisabled]} onPress={send} disabled={sending}>
                {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Feather name="send" size={18} color="#ffffff" />}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      ) : (
        <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent}>
          <Pressable style={styles.groupButton} onPress={() => setGroupBuilderOpen((open) => !open)}>
            <Feather name="users" size={17} color="#0f5d55" />
            <Text style={styles.groupButtonText}>New group</Text>
          </Pressable>

          {groupBuilderOpen && (
            <View style={styles.groupPanel}>
              <TextInput style={styles.input} value={groupName} onChangeText={setGroupName} placeholder="Group name" />
              {users.map((user) => {
                const selected = selectedMemberIds.includes(user.id);
                return (
                  <Pressable key={user.id} style={[styles.memberRow, selected && styles.memberRowSelected]} onPress={() => toggleGroupMember(user.id)}>
                    <View style={[styles.checkBox, selected && styles.checkBoxSelected]}>
                      {selected && <Feather name="check" size={14} color="#ffffff" />}
                    </View>
                    <Text style={styles.memberName} numberOfLines={1}>{user.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable style={styles.primaryButton} onPress={createGroup}>
                <Text style={styles.primaryButtonText}>Create group</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.sectionTitle}>Chats</Text>
          {dedupeChats(chats).map((chat) => (
            <Pressable key={chat.id} style={styles.row} onPress={() => openChat(chat)}>
              <Text style={styles.rowTitle} numberOfLines={1}>{titleForChat(chat)}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitleForChat(chat)}</Text>
            </Pressable>
          ))}
          <Text style={styles.sectionTitle}>People</Text>
          {users.map((user) => (
            <Pressable key={user.id} style={styles.row} onPress={() => createPrivateChat(user.id)}>
              <Text style={styles.rowTitle} numberOfLines={1}>{user.name}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>{presenceByUser[user.id] || 'OFFLINE'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f6f8fa'
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f8fa'
  },
  authScreen: {
    flex: 1,
    justifyContent: 'center',
    padding: 18
  },
  panel: {
    gap: 12,
    padding: 20,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e2ec'
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#17212b'
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5df',
    overflow: 'hidden'
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f7fafc'
  },
  segmentActive: {
    backgroundColor: '#0f766e'
  },
  segmentText: {
    color: '#23313f',
    fontWeight: '600'
  },
  segmentTextActive: {
    color: '#ffffff'
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5df',
    backgroundColor: '#ffffff'
  },
  primaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0f766e'
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  },
  buttonDisabled: {
    opacity: 0.72
  },
  app: {
    flex: 1
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d9e2ec'
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#17212b'
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#627386',
    fontSize: 12
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#edf2f7'
  },
  sidebar: {
    flex: 1
  },
  sidebarContent: {
    padding: 14
  },
  groupButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#e7f5f1'
  },
  groupButtonText: {
    color: '#0f5d55',
    fontWeight: '700'
  },
  groupPanel: {
    gap: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e2ec',
    backgroundColor: '#ffffff'
  },
  memberRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f7fafc'
  },
  memberRowSelected: {
    backgroundColor: '#dff2ee'
  },
  checkBox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#9fb0bf',
    backgroundColor: '#ffffff'
  },
  checkBoxSelected: {
    borderColor: '#0f766e',
    backgroundColor: '#0f766e'
  },
  memberName: {
    flex: 1,
    minWidth: 0,
    color: '#17212b',
    fontWeight: '600'
  },
  sectionTitle: {
    marginTop: 10,
    marginBottom: 8,
    color: '#627386',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  row: {
    gap: 4,
    padding: 13,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  rowTitle: {
    color: '#17212b',
    fontSize: 16,
    fontWeight: '700'
  },
  rowSubtitle: {
    color: '#627386',
    fontSize: 13
  },
  chatPane: {
    flex: 1
  },
  chatHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d9e2ec'
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8
  },
  chatHeaderText: {
    flex: 1,
    minWidth: 0
  },
  chatTitle: {
    color: '#17212b',
    fontSize: 17,
    fontWeight: '700'
  },
  chatSubtitle: {
    color: '#627386',
    fontSize: 12
  },
  messageList: {
    flexGrow: 1,
    padding: 14,
    gap: 8
  },
  emptyText: {
    marginTop: 24,
    textAlign: 'center',
    color: '#627386'
  },
  bubble: {
    maxWidth: '82%',
    alignSelf: 'flex-start',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  bubbleOwn: {
    alignSelf: 'flex-end',
    backgroundColor: '#dff2ee'
  },
  messageImage: {
    width: 220,
    height: 180,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: '#edf2f7'
  },
  fileLink: {
    maxWidth: 240,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e7f5f1'
  },
  fileLinkText: {
    flex: 1,
    minWidth: 0,
    color: '#0f5d55',
    fontWeight: '700'
  },
  messageText: {
    color: '#17212b',
    fontSize: 15
  },
  messageMeta: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 8,
    marginTop: 5
  },
  messageTime: {
    color: '#627386',
    fontSize: 11
  },
  messageStatus: {
    color: '#627386',
    fontSize: 11,
    fontWeight: '600'
  },
  attachmentBar: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f7fafc',
    borderTopWidth: 1,
    borderTopColor: '#d9e2ec'
  },
  attachmentName: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  attachmentText: {
    flex: 1,
    minWidth: 0,
    color: '#23313f',
    fontWeight: '600'
  },
  clearAttachmentButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#edf2f7'
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#d9e2ec'
  },
  toolButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#edf2f7'
  },
  messageInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 104,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5df'
  },
  sendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0f766e'
  }
});
