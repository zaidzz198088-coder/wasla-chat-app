// client.js -- منطق الواجهة الأمامية
let me = null;
let socket = null;
let currentChatId = null;
let currentChat = null;
let friendsCache = [];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ============== أدوات مساعدة ==============
async function api(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
}

// ============== بدء التشغيل ==============
init();

async function init() {
  const { user } = await api('/api/me');
  if (user) {
    me = user;
    enterApp();
  } else {
    setupAuthScreen();
  }
}

// ============== شاشة الدخول / التسجيل ==============
function setupAuthScreen() {
  $$('.eye-toggle').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById(btn.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
    };
  });

  $$('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      $('#loginForm').classList.toggle('hidden', which !== 'login');
      $('#registerForm').classList.toggle('hidden', which !== 'register');
    };
  });

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      const { user } = await api('/api/login', {
        method: 'POST',
        body: { username: $('#loginUsername').value, password: $('#loginPassword').value }
      });
      me = user;
      enterApp();
    } catch (err) {
      $('#loginError').textContent = err.message;
    }
  };

  $('#registerForm').onsubmit = async e => {
    e.preventDefault();
    $('#regError').textContent = '';
    try {
      const { user } = await api('/api/register', {
        method: 'POST',
        body: {
          username: $('#regUsername').value,
          password: $('#regPassword').value,
          displayName: $('#regDisplayName').value
        }
      });
      me = user;
      enterApp();
    } catch (err) {
      $('#regError').textContent = err.message;
    }
  };
}

// ============== الدخول للتطبيق ==============
function enterApp() {
  $('#authScreen').classList.add('hidden');
  $('#appScreen').classList.remove('hidden');
  $('#myName').textContent = me.displayName;
  $('#myIdBadge').textContent = 'ID: ' + me.userId;
  if (me.avatar) $('#myAvatar').src = me.avatar;

  connectSocket();
  bindAppEvents();
  loadChats();
  loadFriends();
}

function connectSocket() {
  socket = io();
  socket.on('message:new', msg => {
    if (msg.chatId === currentChatId) {
      appendMessage(msg);
      scrollMessagesToBottom();
    }
    loadChats(); // لتحديث آخر رسالة والترتيب
  });
  socket.on('chat:background', ({ chatId, backgroundUrl }) => {
    if (chatId === currentChatId) applyBackground(backgroundUrl);
  });
}

// ============== ربط أحداث الواجهة ==============
function bindAppEvents() {
  $('#logoutBtn').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
  };

  // البحث بالآيدي
  $('#idSearchBtn').onclick = doIdSearch;
  $('#idSearchInput').onkeydown = e => { if (e.key === 'Enter') doIdSearch(); };

  // تبويبات الشريط الجانبي
  $$('.side-tab').forEach(tab => {
    tab.onclick = () => {
      $$('.side-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.sideTab;
      $('#chatList').classList.toggle('hidden', which !== 'chats');
      $('#friendsTab').classList.toggle('hidden', which !== 'friends');
    };
  });

  // الملف الشخصي
  $('#openProfileBtn').onclick = openProfileModal;
  $('#profileAvatarInput').onchange = () => {
    const f = $('#profileAvatarInput').files[0];
    if (f) $('#profileAvatarPreview').src = URL.createObjectURL(f);
  };
  $('#saveProfileBtn').onclick = saveProfile;

  // إنشاء جروب
  $('#newGroupBtn').onclick = openGroupModal;
  $('#createGroupBtn').onclick = createGroup;

  // إغلاق المودالات
  $$('.modal-close').forEach(btn => btn.onclick = () => closeModals());
  $$('.modal-overlay').forEach(ov => ov.onclick = e => { if (e.target === ov) closeModals(); });

  // إعدادات المحادثة (الترس)
  $('#chatSettingsBtn').onclick = e => {
    e.stopPropagation();
    $('#settingsPanel').classList.toggle('hidden');
  };
  document.addEventListener('click', () => $('#settingsPanel').classList.add('hidden'));

  $('#muteToggleBtn').onclick = toggleMute;
  $('#bgFileInput').onchange = uploadChatBackground;
  $('#removeBgBtn').onclick = removeChatBackground;
  $('#backToListBtn').onclick = () => $('.app-shell').classList.remove('chat-open');

  // إرسال الرسائل
  $('#composerForm').onsubmit = sendTextMessage;
  $('#mediaInput').onchange = sendMediaMessage;
}

function closeModals() {
  $$('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

// ============== البحث بالآيدي وإضافة صديق ==============
async function doIdSearch() {
  const id = $('#idSearchInput').value.trim();
  const box = $('#searchResult');
  if (!id) { box.classList.add('hidden'); return; }
  try {
    const { user, relation, requestId } = await api('/api/search?id=' + encodeURIComponent(id));
    box.classList.remove('hidden');
    if (!user) {
      box.innerHTML = '<div class="search-empty">لا يوجد مستخدم بهذا الآيدي</div>';
      return;
    }
    if (relation === 'me') {
      box.innerHTML = '<div class="search-empty">هذا أنت 🙂</div>';
      return;
    }

    let actionHtml = '';
    if (relation === 'friends') {
      actionHtml = '';
    } else if (relation === 'outgoing') {
      actionHtml = `<button disabled>تم إرسال الطلب ⏳</button>`;
    } else if (relation === 'incoming') {
      actionHtml = `<button id="srAccept" class="primary">قبول طلب الصداقة</button>`;
    } else {
      actionHtml = `<button id="srAdd" class="primary">إضافة صديق</button>`;
    }

    box.innerHTML = `
      <div class="sr-row">
        <img class="avatar avatar-md" src="${user.avatar || '/img/default-avatar.svg'}">
        <div class="sr-info">
          <div class="sr-name">${escapeHtml(user.displayName)}</div>
          <div class="sr-id">ID: ${user.userId}</div>
        </div>
      </div>
      <div class="sr-actions">
        ${actionHtml}
        <button id="srMsg">مراسلة</button>
      </div>`;

    const addBtn = $('#srAdd');
    if (addBtn) addBtn.onclick = async () => {
      await api('/api/friends/add', { method: 'POST', body: { friendId: user.userId } });
      await loadFriends();
      doIdSearch();
    };
    const acceptBtn = $('#srAccept');
    if (acceptBtn) acceptBtn.onclick = async () => {
      if (requestId) await api('/api/friends/requests/' + requestId + '/accept', { method: 'POST' });
      await loadFriends();
      doIdSearch();
    };
    $('#srMsg').onclick = () => openPrivateChat(user.userId, user);
  } catch (err) {
    box.classList.remove('hidden');
    box.innerHTML = `<div class="search-empty">${err.message}</div>`;
  }
}

// ============== الأصدقاء وطلبات الصداقة ==============
async function loadFriends() {
  const [{ friends }, { incoming }] = await Promise.all([
    api('/api/friends'),
    api('/api/friends/requests')
  ]);
  friendsCache = friends;
  renderFriendRequests(incoming);

  const box = $('#friendList');
  if (!friends.length) {
    box.innerHTML = '<div class="search-empty">لا يوجد أصدقاء بعد، ابحث بالآيدي وأضف أحداً</div>';
    return;
  }
  box.innerHTML = '';
  friends.forEach(f => {
    const row = document.createElement('div');
    row.className = 'friend-item';
    row.innerHTML = `
      <img class="avatar avatar-md" src="${f.avatar || '/img/default-avatar.svg'}">
      <div class="friend-item-name">${escapeHtml(f.displayName)}</div>
      <button>مراسلة</button>`;
    row.querySelector('button').onclick = () => openPrivateChat(f.userId, f);
    box.appendChild(row);
  });
}

function renderFriendRequests(incoming) {
  const section = $('#requestsSection');
  const box = $('#requestsList');
  if (!incoming.length) {
    section.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');
  box.innerHTML = '';
  incoming.forEach(r => {
    const row = document.createElement('div');
    row.className = 'req-item';
    row.innerHTML = `
      <img class="avatar avatar-md" src="${r.user.avatar || '/img/default-avatar.svg'}">
      <div class="req-item-name">${escapeHtml(r.user.displayName)}</div>
      <div class="req-actions">
        <button class="accept">قبول</button>
        <button class="decline">رفض</button>
      </div>`;
    row.querySelector('.accept').onclick = async () => {
      await api('/api/friends/requests/' + r.requestId + '/accept', { method: 'POST' });
      loadFriends();
    };
    row.querySelector('.decline').onclick = async () => {
      await api('/api/friends/requests/' + r.requestId + '/decline', { method: 'POST' });
      loadFriends();
    };
    box.appendChild(row);
  });
}

async function openPrivateChat(friendId) {
  const { chatId } = await api('/api/chats/private', { method: 'POST', body: { friendId } });
  socket.emit('chat:join', { chatId });
  await loadChats();
  openChat(chatId);
}

// ============== قائمة المحادثات ==============
async function loadChats() {
  const { chats } = await api('/api/chats');
  const box = $('#chatList');
  if (!chats.length) {
    box.innerHTML = '<div class="search-empty">لا توجد محادثات بعد</div>';
    return;
  }
  box.innerHTML = '';
  chats.forEach(c => {
    const row = document.createElement('div');
    row.className = 'chat-item' + (c.id === currentChatId ? ' active' : '');
    let lastText = '';
    if (c.lastMessage) {
      if (c.lastMessage.type === 'text') lastText = c.lastMessage.content;
      else if (c.lastMessage.type === 'image') lastText = '📷 صورة';
      else lastText = '🎬 فيديو';
    }
    row.innerHTML = `
      <img class="avatar avatar-md" src="${c.avatar || '/img/default-avatar.svg'}">
      <div class="chat-item-body">
        <div class="chat-item-top">
          <div class="chat-item-name">${escapeHtml(c.title)}${c.muted ? ' 🔕' : ''}</div>
          <div class="chat-item-time">${c.lastMessage ? timeStr(c.lastMessage.timestamp) : ''}</div>
        </div>
        <div class="chat-item-last">${escapeHtml(lastText)}</div>
      </div>`;
    row.onclick = () => openChat(c.id);
    box.appendChild(row);
  });
}

// ============== فتح محادثة ==============
async function openChat(chatId) {
  currentChatId = chatId;
  const { chat, messages } = await api('/api/chats/' + chatId + '/messages');
  currentChat = chat;

  $('#emptyState').classList.add('hidden');
  $('#chatWindow').classList.remove('hidden');
  $('.app-shell').classList.add('chat-open');

  let title, avatar;
  if (chat.type === 'group') {
    title = chat.name;
    avatar = chat.avatar;
  } else {
    title = chat.otherUser ? chat.otherUser.displayName : 'مستخدم';
    avatar = chat.otherUser ? chat.otherUser.avatar : null;
  }
  $('#chatTitle').textContent = title;
  $('#chatSub').textContent = chat.type === 'group' ? (chat.members.length + ' أعضاء') : '';
  $('#chatAvatar').src = avatar || '/img/default-avatar.svg';

  applyBackground(chat.backgroundUrl);
  $('#muteToggleBtn').textContent = chat.mutedBy.includes(me.userId) ? '🔔 فتح الإشعارات' : '🔕 كتم الإشعارات';

  $('#messagesEl').innerHTML = '';
  messages.forEach(appendMessage);
  scrollMessagesToBottom();

  await loadChats(); // لتحديث التظليل على العنصر النشط
}

function applyBackground(url) {
  const win = $('#chatWindow');
  win.style.backgroundImage = url ? `url('${url}')` : 'none';
}

function appendMessage(msg) {
  const mine = msg.senderId === me.userId;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'theirs');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  let inner = '';
  if (currentChat && currentChat.type === 'group' && !mine) {
    inner += `<div class="meta">${escapeHtml(msg.senderName)}</div>`;
  }
  if (msg.type === 'text') {
    inner += `<div>${escapeHtml(msg.content)}</div>`;
  } else if (msg.type === 'image') {
    inner += `<img src="${msg.content}">`;
  } else if (msg.type === 'video') {
    inner += `<video src="${msg.content}" controls></video>`;
  }
  inner += `<div class="time">${timeStr(msg.timestamp)}</div>`;
  bubble.innerHTML = inner;

  const avatarSrc = (mine ? me.avatar : msg.senderAvatar) || '/img/default-avatar.svg';
  const avatarImg = document.createElement('img');
  avatarImg.className = 'msg-avatar';
  avatarImg.src = avatarSrc;

  if (mine) {
    row.appendChild(bubble);
    row.appendChild(avatarImg);
  } else {
    row.appendChild(avatarImg);
    row.appendChild(bubble);
  }
  $('#messagesEl').appendChild(row);
}

function scrollMessagesToBottom() {
  const box = $('#messagesEl');
  box.scrollTop = box.scrollHeight;
}

// ============== إرسال الرسائل ==============
function sendTextMessage(e) {
  e.preventDefault();
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  socket.emit('message:send', { chatId: currentChatId, type: 'text', content: text });
  input.value = '';
}

async function sendMediaMessage() {
  const file = $('#mediaInput').files[0];
  if (!file || !currentChatId) return;
  const fd = new FormData();
  fd.append('file', file);
  const { url, type } = await api('/api/upload/media', { method: 'POST', body: fd });
  socket.emit('message:send', { chatId: currentChatId, type, content: url });
  $('#mediaInput').value = '';
}

// ============== إعدادات المحادثة (كتم / خلفية) ==============
async function toggleMute() {
  if (!currentChat) return;
  const nowMuted = !currentChat.mutedBy.includes(me.userId);
  await api('/api/chats/' + currentChatId + '/mute', { method: 'POST', body: { muted: nowMuted } });
  if (nowMuted) currentChat.mutedBy.push(me.userId);
  else currentChat.mutedBy = currentChat.mutedBy.filter(id => id !== me.userId);
  $('#muteToggleBtn').textContent = nowMuted ? '🔔 فتح الإشعارات' : '🔕 كتم الإشعارات';
  loadChats();
}

async function uploadChatBackground() {
  const file = $('#bgFileInput').files[0];
  if (!file || !currentChatId) return;
  const fd = new FormData();
  fd.append('background', file);
  const { backgroundUrl } = await api('/api/chats/' + currentChatId + '/background', { method: 'POST', body: fd });
  currentChat.backgroundUrl = backgroundUrl;
  applyBackground(backgroundUrl);
  $('#bgFileInput').value = '';
}

async function removeChatBackground() {
  if (!currentChatId) return;
  const fd = new FormData();
  fd.append('remove', 'true');
  await api('/api/chats/' + currentChatId + '/background', { method: 'POST', body: fd });
  currentChat.backgroundUrl = null;
  applyBackground(null);
}

// ============== الملف الشخصي ==============
function openProfileModal() {
  $('#profileDisplayName').value = me.displayName;
  $('#profileAvatarPreview').src = me.avatar || '/img/default-avatar.svg';
  $('#profileIdText').textContent = me.userId;
  $('#profileModal').classList.remove('hidden');
}

async function saveProfile() {
  const fd = new FormData();
  fd.append('displayName', $('#profileDisplayName').value);
  const file = $('#profileAvatarInput').files[0];
  if (file) fd.append('avatar', file);
  const { user } = await api('/api/profile', { method: 'POST', body: fd });
  me = user;
  $('#myName').textContent = me.displayName;
  if (me.avatar) $('#myAvatar').src = me.avatar;
  closeModals();
}

// ============== إنشاء محادثة جماعية ==============
function openGroupModal() {
  $('#groupNameInput').value = '';
  const box = $('#groupMembersList');
  if (!friendsCache.length) {
    box.innerHTML = '<div class="search-empty">أضف أصدقاء أولاً لتقدر تسوي جروب</div>';
  } else {
    box.innerHTML = '';
    friendsCache.forEach(f => {
      const row = document.createElement('div');
      row.className = 'gm-item';
      row.innerHTML = `
        <label>
          <input type="checkbox" value="${f.userId}">
          <img class="avatar" style="width:28px;height:28px" src="${f.avatar || '/img/default-avatar.svg'}">
          ${escapeHtml(f.displayName)}
        </label>`;
      box.appendChild(row);
    });
  }
  $('#groupModal').classList.remove('hidden');
}

async function createGroup() {
  const name = $('#groupNameInput').value.trim();
  const memberIds = Array.from($('#groupMembersList').querySelectorAll('input:checked')).map(i => i.value);
  if (!name || !memberIds.length) { alert('اكتب اسم الكروب واختر عضو واحد على الأقل'); return; }
  const { chatId } = await api('/api/chats/group', { method: 'POST', body: { name, memberIds } });
  socket.emit('chat:join', { chatId });
  closeModals();
  await loadChats();
  openChat(chatId);
}

// ============== أدوات ==============
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}
