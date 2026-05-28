import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
const STORAGE_KEYS = {
  apiBaseUrl: 'settings:apiBaseUrl',
  session: 'session'
};

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
  const value = await AsyncStorage.getItem(key);
  return value ? JSON.parse(value) : fallback;
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
  return [...messages, message].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.apiBaseUrl),
      readJson(STORAGE_KEYS.session, null)
    ]).then(([storedApiBaseUrl, storedSession]) => {
      if (storedApiBaseUrl) setApiBaseUrl(storedApiBaseUrl);
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

  const saveApiBaseUrl = async (value) => {
    const normalized = value.trim().replace(/\/$/, '');
    setApiBaseUrl(normalized);
    await AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, normalized);
  };

  const login = async (phone, password) => {
    const { data } = await axios.post(`${apiBaseUrl}/api/users/login`, { phone, password });
    await writeJson(STORAGE_KEYS.session, data);
    setSession(data);
  };

  const register = async (name, phone, password) => {
    await axios.post(`${apiBaseUrl}/api/users/register`, { name, phone, password });
    await login(phone, password);
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
        <ChatApp api={api} session={session} onLogout={logout} />
      ) : (
        <AuthScreen
          apiBaseUrl={apiBaseUrl}
          onApiBaseUrlChange={saveApiBaseUrl}
          onLogin={login}
          onRegister={register}
        />
      )}
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

function AuthScreen({ apiBaseUrl, onApiBaseUrlChange, onLogin, onRegister }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState(apiBaseUrl);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onApiBaseUrlChange(serverUrl);
      if (mode === 'register') await onRegister(name, phone, password);
      else await onLogin(phone, password);
    } catch (error) {
      Alert.alert('Authentication failed', error?.response?.data?.error || 'Check server URL and credentials.');
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
        <TextInput style={styles.input} value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" placeholder="API server URL" />
        {mode === 'register' && <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" />}
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone" />
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" />
        <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Please wait' : mode === 'login' ? 'Login' : 'Create account'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatApp({ api, session, onLogout }) {
  const [users, setUsers] = useState([]);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [presenceByUser, setPresenceByUser] = useState({});
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

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
    } catch (error) {
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
    return () => clearInterval(heartbeat);
  }, [api, loadLocalCache, session.user.id, sync]);

  const openChat = async (chat) => {
    setActiveChat(chat);
    const cached = await readJson(messagesKey(chat.id), []);
    setMessages(cached);
    try {
      const { data } = await api.get(`/api/messages/chats/${chat.id}`);
      setMessages(data);
      await writeJson(messagesKey(chat.id), data);
      data.filter((message) => message.senderId !== session.user.id).forEach((message) => {
        api.patch(`/api/messages/${message.id}/status`, {
          chatId: chat.id,
          userId: session.user.id,
          status: 'READ'
        }).catch(() => {});
      });
    } catch {
      Alert.alert('Offline cache', 'Could not refresh this conversation.');
    }
  };

  const createPrivateChat = async (otherUserId) => {
    const existing = dedupeChats(chats).find((chat) => chat.type === 'PRIVATE' && chat.memberIds.includes(otherUserId));
    if (existing) return openChat(existing);
    const { data } = await api.post('/api/chats', { type: 'PRIVATE', memberIds: [session.user.id, otherUserId] });
    const nextChats = dedupeChats([data, ...chats]);
    setChats(nextChats);
    await writeJson(chatsKey(session.user.id), nextChats);
    openChat(data);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || !activeChat) return;
    setText('');
    const recipientIds = activeChat.memberIds.filter((id) => id !== session.user.id);
    try {
      const { data } = await api.post('/api/messages', {
        chatId: activeChat.id,
        senderId: session.user.id,
        recipientIds,
        content,
        type: 'TEXT',
        mediaUrl: null
      });
      const nextMessages = upsertMessage(messages, { ...data, status: 'SENT' });
      setMessages(nextMessages);
      await writeJson(messagesKey(activeChat.id), nextMessages);
    } catch {
      setText(content);
      Alert.alert('Send failed', 'Message was not sent. Check your connection.');
    }
  };

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

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{session.user.name}</Text>
          <Text style={styles.headerSubtitle}>Mobile cache enabled</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.secondaryButton} onPress={sync}>
            <Text style={styles.secondaryButtonText}>{loading ? 'Syncing' : 'Sync'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onLogout}>
            <Text style={styles.secondaryButtonText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {activeChat ? (
        <View style={styles.chatPane}>
          <View style={styles.chatHeader}>
            <Pressable onPress={() => setActiveChat(null)}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <View style={styles.chatHeaderText}>
              <Text style={styles.chatTitle}>{titleForChat(activeChat)}</Text>
              <Text style={styles.chatSubtitle}>{subtitleForChat(activeChat)}</Text>
            </View>
          </View>
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => {
              const own = item.senderId === session.user.id;
              return (
                <View style={[styles.bubble, own && styles.bubbleOwn]}>
                  <Text style={styles.messageText}>{item.content}</Text>
                  <Text style={styles.messageTime}>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              );
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.composer}>
              <TextInput style={styles.messageInput} value={text} onChangeText={setText} placeholder="Message" />
              <Pressable style={styles.sendButton} onPress={send}>
                <Text style={styles.sendButtonText}>Send</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      ) : (
        <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent}>
          <Text style={styles.sectionTitle}>Chats</Text>
          {dedupeChats(chats).map((chat) => (
            <Pressable key={chat.id} style={styles.row} onPress={() => openChat(chat)}>
              <Text style={styles.rowTitle}>{titleForChat(chat)}</Text>
              <Text style={styles.rowSubtitle}>{subtitleForChat(chat)}</Text>
            </Pressable>
          ))}
          <Text style={styles.sectionTitle}>People</Text>
          {users.map((user) => (
            <Pressable key={user.id} style={styles.row} onPress={() => createPrivateChat(user.id)}>
              <Text style={styles.rowTitle}>{user.name}</Text>
              <Text style={styles.rowSubtitle}>{presenceByUser[user.id] || 'OFFLINE'}</Text>
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
  secondaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#edf2f7'
  },
  secondaryButtonText: {
    color: '#23313f',
    fontWeight: '600'
  },
  sidebar: {
    flex: 1
  },
  sidebarContent: {
    padding: 14
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
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d9e2ec'
  },
  backText: {
    color: '#0f766e',
    fontWeight: '700'
  },
  chatHeaderText: {
    flex: 1
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
    padding: 14,
    gap: 8
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
  messageText: {
    color: '#17212b',
    fontSize: 15
  },
  messageTime: {
    alignSelf: 'flex-end',
    marginTop: 5,
    color: '#627386',
    fontSize: 11
  },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#d9e2ec'
  },
  messageInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5df'
  },
  sendButton: {
    minWidth: 70,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0f766e'
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700'
  }
});
