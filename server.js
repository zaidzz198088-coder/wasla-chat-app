// server.js -- سيرفر برنامج "مملكة الأشقر" للمراسلات
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');

// نتأكد إن مجلدات الرفع موجودة (مهم عند النشر على استضافة لأن GitHub ما يرفع مجلدات فاضية)
['uploads/avatars', 'uploads/media', 'uploads/backgrounds', 'data'].forEach(dir => {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- إعدادات عامة ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: 'change-this-secret-key-please',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 يوم
});
app.use(sessionMiddleware);

// نشارك الجلسة (session) مع Socket.io حتى نعرف مين المستخدم المتصل
io.engine.use(sessionMiddleware);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- رفع الملفات (صور / فيديو / أفتار / خلفية) ----------
function makeUploader(subfolder) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, 'uploads', subfolder));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    }
  });
  return multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // حتى 100 ميغا للفيديو
}
const uploadAvatar = makeUploader('avatars');
const uploadBackground = makeUploader('backgrounds');
const uploadMedia = makeUploader('media');

// ---------- أدوات مساعدة ----------
function genUserId() {
  // آيدي فريد مكوّن من 7 أرقام يقدر أي شخص يبحث فيه عليك
  const data = db.load();
  let id;
  do {
    id = String(Math.floor(1000000 + Math.random() * 9000000));
  } while (data.users.some(u => u.userId === id));
  return id;
}

function publicUser(u) {
  if (!u) return null;
  return { userId: u.userId, username: u.username, displayName: u.displayName, avatar: u.avatar };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  next();
}

function getUserById(data, userId) {
  return data.users.find(u => u.userId === userId);
}

function areFriends(data, idA, idB) {
  const a = getUserById(data, idA);
  return !!(a && a.contacts.includes(idB));
}

function getOrCreatePrivateChat(data, userA, userB) {
  let chat = data.chats.find(c =>
    c.type === 'private' &&
    c.members.length === 2 &&
    c.members.includes(userA) &&
    c.members.includes(userB)
  );
  if (!chat) {
    chat = {
      id: uuidv4(),
      type: 'private',
      members: [userA, userB],
      name: null,
      background: {}, // { [userIdOrShared]: url }  -- نخليها مشتركة فعليا (نفس الخلفية للطرفين)
      backgroundUrl: null,
      mutedBy: [],
      createdAt: Date.now()
    };
    data.chats.push(chat);
  }
  return chat;
}

// =======================================================
//                     مسارات API (Auth)
// =======================================================

app.post('/api/register', (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'الرجاء تعبئة كل الحقول' });
  }
  const result = db.update(data => {
    if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return { error: 'اسم المستخدم موجود مسبقا' };
    }
    const user = {
      userId: genUserId(),
      username,
      password: bcrypt.hashSync(password, 10),
      displayName,
      avatar: null,
      contacts: [],
      createdAt: Date.now()
    };
    data.users.push(user);
    return { user };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  req.session.userId = result.user.userId;
  res.json({ user: publicUser(result.user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = db.load();
  const user = data.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    return res.status(400).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  req.session.userId = user.userId;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const data = db.load();
  const user = getUserById(data, req.session.userId);
  res.json({ user: publicUser(user) });
});

// تعديل الملف الشخصي (اسم / أفتار)
app.post('/api/profile', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
  const result = db.update(data => {
    const user = getUserById(data, req.session.userId);
    if (req.body.displayName) user.displayName = req.body.displayName;
    if (req.file) user.avatar = '/uploads/avatars/' + req.file.filename;
    return publicUser(user);
  });
  res.json({ user: result });
});

// =======================================================
//                  البحث عن مستخدم بالآيدي وإضافة صديق
// =======================================================

app.get('/api/search', requireAuth, (req, res) => {
  const q = (req.query.id || '').trim();
  if (!q) return res.json({ user: null });
  const data = db.load();
  const found = data.users.find(u => u.userId === q);
  if (!found) return res.json({ user: null });

  const myId = req.session.userId;
  let relation = 'none';
  let requestId = null;
  if (found.userId === myId) {
    relation = 'me';
  } else if (areFriends(data, myId, found.userId)) {
    relation = 'friends';
  } else if (data.friendRequests.some(r => r.fromId === myId && r.toId === found.userId)) {
    relation = 'outgoing';
  } else {
    const incomingReq = data.friendRequests.find(r => r.fromId === found.userId && r.toId === myId);
    if (incomingReq) { relation = 'incoming'; requestId = incomingReq.id; }
  }
  res.json({ user: publicUser(found), relation, requestId });
});

// إرسال طلب صداقة (لا يصير الطرفان أصدقاء إلا لما الطرف الثاني يوافق)
app.post('/api/friends/add', requireAuth, (req, res) => {
  const { friendId } = req.body;
  const result = db.update(data => {
    const me = getUserById(data, req.session.userId);
    const friend = getUserById(data, friendId);
    if (!friend) return { error: 'المستخدم غير موجود' };
    if (friend.userId === me.userId) return { error: 'لا يمكنك إضافة نفسك' };
    if (me.contacts.includes(friend.userId)) return { error: 'أنتم أصدقاء بالفعل' };
    if (data.friendRequests.some(r => r.fromId === me.userId && r.toId === friend.userId)) {
      return { error: 'تم إرسال الطلب مسبقا' };
    }
    // إذا كان الطرف الثاني أرسل لي طلب من قبل، نقبله مباشرة بدل تكرار الطلب
    const incoming = data.friendRequests.find(r => r.fromId === friend.userId && r.toId === me.userId);
    if (incoming) {
      data.friendRequests = data.friendRequests.filter(r => r.id !== incoming.id);
      if (!me.contacts.includes(friend.userId)) me.contacts.push(friend.userId);
      if (!friend.contacts.includes(me.userId)) friend.contacts.push(me.userId);
      return { ok: true, autoAccepted: true };
    }
    data.friendRequests.push({
      id: uuidv4(),
      fromId: me.userId,
      toId: friend.userId,
      createdAt: Date.now()
    });
    return { ok: true };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// طلبات الصداقة الواردة والصادرة
app.get('/api/friends/requests', requireAuth, (req, res) => {
  const data = db.load();
  const myId = req.session.userId;
  const incoming = data.friendRequests
    .filter(r => r.toId === myId)
    .map(r => ({ requestId: r.id, user: publicUser(getUserById(data, r.fromId)) }))
    .filter(r => r.user);
  const outgoing = data.friendRequests
    .filter(r => r.fromId === myId)
    .map(r => ({ requestId: r.id, user: publicUser(getUserById(data, r.toId)) }))
    .filter(r => r.user);
  res.json({ incoming, outgoing });
});

// قبول طلب صداقة وارد
app.post('/api/friends/requests/:requestId/accept', requireAuth, (req, res) => {
  const result = db.update(data => {
    const reqItem = data.friendRequests.find(r => r.id === req.params.requestId && r.toId === req.session.userId);
    if (!reqItem) return { error: 'الطلب غير موجود' };
    const me = getUserById(data, reqItem.toId);
    const other = getUserById(data, reqItem.fromId);
    if (me && other) {
      if (!me.contacts.includes(other.userId)) me.contacts.push(other.userId);
      if (!other.contacts.includes(me.userId)) other.contacts.push(me.userId);
    }
    data.friendRequests = data.friendRequests.filter(r => r.id !== reqItem.id);
    return { ok: true, friendId: other ? other.userId : null };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// رفض / إلغاء طلب صداقة (وارد أو صادر)
app.post('/api/friends/requests/:requestId/decline', requireAuth, (req, res) => {
  const result = db.update(data => {
    const reqItem = data.friendRequests.find(r => r.id === req.params.requestId &&
      (r.toId === req.session.userId || r.fromId === req.session.userId));
    if (!reqItem) return { error: 'الطلب غير موجود' };
    data.friendRequests = data.friendRequests.filter(r => r.id !== reqItem.id);
    return { ok: true };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/friends', requireAuth, (req, res) => {
  const data = db.load();
  const me = getUserById(data, req.session.userId);
  const list = me.contacts.map(id => publicUser(getUserById(data, id))).filter(Boolean);
  res.json({ friends: list });
});

// =======================================================
//                        المحادثات
// =======================================================

// كل محادثاتي (فردية وجماعية) مع آخر رسالة
app.get('/api/chats', requireAuth, (req, res) => {
  const data = db.load();
  const myId = req.session.userId;
  const myChats = data.chats.filter(c => c.members.includes(myId));

  const list = myChats.map(c => {
    const chatMsgs = data.messages.filter(m => m.chatId === c.id);
    const lastMsg = chatMsgs[chatMsgs.length - 1] || null;
    let title, avatar;
    if (c.type === 'group') {
      title = c.name;
      avatar = c.avatar || null;
    } else {
      const otherId = c.members.find(id => id !== myId);
      const other = getUserById(data, otherId);
      title = other ? other.displayName : 'مستخدم محذوف';
      avatar = other ? other.avatar : null;
    }
    return {
      id: c.id,
      type: c.type,
      title,
      avatar,
      members: c.members,
      background: c.backgroundUrl || null,
      muted: c.mutedBy.includes(myId),
      lastMessage: lastMsg ? { type: lastMsg.type, content: lastMsg.content, senderId: lastMsg.senderId, timestamp: lastMsg.timestamp } : null,
      updatedAt: lastMsg ? lastMsg.timestamp : c.createdAt
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);

  res.json({ chats: list });
});

// فتح أو إنشاء محادثة فردية
app.post('/api/chats/private', requireAuth, (req, res) => {
  const { friendId } = req.body;
  const result = db.update(data => {
    const friend = getUserById(data, friendId);
    if (!friend) return { error: 'المستخدم غير موجود' };
    const chat = getOrCreatePrivateChat(data, req.session.userId, friendId);
    return { chatId: chat.id };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// إنشاء محادثة جماعية
app.post('/api/chats/group', requireAuth, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !Array.isArray(memberIds) || memberIds.length < 1) {
    return res.status(400).json({ error: 'اكتب اسم الكروب واختر أعضاء' });
  }
  const result = db.update(data => {
    const members = Array.from(new Set([req.session.userId, ...memberIds]));
    const chat = {
      id: uuidv4(),
      type: 'group',
      members,
      name,
      avatar: null,
      backgroundUrl: null,
      mutedBy: [],
      admin: req.session.userId,
      createdAt: Date.now()
    };
    data.chats.push(chat);
    return { chatId: chat.id };
  });
  res.json(result);
});

// معلومات محادثة واحدة + رسائلها
app.get('/api/chats/:chatId/messages', requireAuth, (req, res) => {
  const data = db.load();
  const chat = data.chats.find(c => c.id === req.params.chatId);
  if (!chat || !chat.members.includes(req.session.userId)) {
    return res.status(403).json({ error: 'لا تملك صلاحية' });
  }
  const msgs = data.messages.filter(m => m.chatId === chat.id).map(m => {
    const sender = getUserById(data, m.senderId);
    return { ...m, senderName: sender ? sender.displayName : 'مستخدم', senderAvatar: sender ? sender.avatar : null };
  });

  // نرفق معلومات الطرف الثاني بالمحادثة الفردية حتى لو ما كانوا أصدقاء بعد
  let otherUser = null;
  if (chat.type === 'private') {
    const otherId = chat.members.find(id => id !== req.session.userId);
    otherUser = publicUser(getUserById(data, otherId));
  }

  res.json({ chat: { ...chat, otherUser }, messages: msgs });
});

// كتم / فتح كتم محادثة
app.post('/api/chats/:chatId/mute', requireAuth, (req, res) => {
  const { muted } = req.body;
  const result = db.update(data => {
    const chat = data.chats.find(c => c.id === req.params.chatId);
    if (!chat) return { error: 'المحادثة غير موجودة' };
    chat.mutedBy = chat.mutedBy.filter(id => id !== req.session.userId);
    if (muted) chat.mutedBy.push(req.session.userId);
    return { ok: true };
  });
  res.json(result);
});

// تغيير خلفية المحادثة (تظهر لكلا الطرفين)
app.post('/api/chats/:chatId/background', requireAuth, uploadBackground.single('background'), (req, res) => {
  const result = db.update(data => {
    const chat = data.chats.find(c => c.id === req.params.chatId);
    if (!chat) return { error: 'المحادثة غير موجودة' };
    if (!chat.members.includes(req.session.userId)) return { error: 'لا تملك صلاحية' };
    if (req.file) {
      chat.backgroundUrl = '/uploads/backgrounds/' + req.file.filename;
    } else if (req.body.remove === 'true') {
      chat.backgroundUrl = null;
    }
    return { backgroundUrl: chat.backgroundUrl };
  });
  if (result.error) return res.status(400).json({ error: result.error });

  // نبلغ كل أعضاء المحادثة فورا بالخلفية الجديدة (حتى لو ما فتحوا المحادثة من قبل بهذي الجلسة)
  const data = db.load();
  const chat = data.chats.find(c => c.id === req.params.chatId);
  if (chat) {
    chat.members.forEach(uid => {
      io.to('user:' + uid).emit('chat:background', { chatId: chat.id, backgroundUrl: chat.backgroundUrl });
    });
  }

  res.json(result);
});

// رفع صورة أو فيديو لإرساله داخل الدردشة
app.post('/api/upload/media', requireAuth, uploadMedia.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لا يوجد ملف' });
  const isVideo = req.file.mimetype.startsWith('video/');
  res.json({ url: '/uploads/media/' + req.file.filename, type: isVideo ? 'video' : 'image' });
});

// =======================================================
//                       Socket.io (شات فوري)
// =======================================================

io.on('connection', socket => {
  const session = socket.request.session;
  const userId = session && session.userId;
  if (!userId) {
    socket.disconnect();
    return;
  }

  // ننضم لكل غرف محادثاته حتى توصله الرسائل فورا
  const data = db.load();
  const myChats = data.chats.filter(c => c.members.includes(userId));
  myChats.forEach(c => socket.join('chat:' + c.id));
  socket.join('user:' + userId);

  socket.on('message:send', payload => {
    const { chatId, type, content } = payload; // type: 'text' | 'image' | 'video'
    if (!chatId || !content) return;

    const result = db.update(d => {
      const chat = d.chats.find(c => c.id === chatId);
      if (!chat || !chat.members.includes(userId)) return null;
      const msg = {
        id: uuidv4(),
        chatId,
        senderId: userId,
        type: type || 'text',
        content,
        timestamp: Date.now()
      };
      d.messages.push(msg);
      return { msg, chat };
    });

    if (!result) return;
    const sender = getUserById(db.load(), userId);
    const msgOut = { ...result.msg, senderName: sender.displayName, senderAvatar: sender.avatar };
    // نرسل لكل أعضاء المحادثة عن طريق غرفة كل مستخدم، حتى توصل الرسالة فورا
    // للطرف الثاني حتى لو هذي أول محادثة بينهم ولسه ما انضم لغرفة الشات
    result.chat.members.forEach(uid => {
      io.to('user:' + uid).emit('message:new', msgOut);
    });
  });

  // مؤشر يكتب الآن...
  socket.on('typing', ({ chatId }) => {
    socket.to('chat:' + chatId).emit('typing', { chatId, userId });
  });

  // عند إنشاء محادثة جديدة ننضم لها فورا (يستدعيها الفرونت بعد الإنشاء)
  socket.on('chat:join', ({ chatId }) => {
    socket.join('chat:' + chatId);
  });
});

server.listen(PORT, () => {
  console.log('=================================================');
  console.log('  السيرفر شغال ✅');
  console.log('  افتح المتصفح على: http://localhost:' + PORT);
  console.log('=================================================');
});
