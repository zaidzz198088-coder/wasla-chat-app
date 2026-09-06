// db.js -- قاعدة بيانات بسيطة على شكل ملف JSON (لا تحتاج تثبيت أي سيرفر داتابيس)
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function defaultData() {
  return { users: [], chats: [], messages: [], friendRequests: [] };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return defaultData();
  }
  // توافق مع نسخ قديمة من ملف البيانات ما فيها هذا الحقل
  if (!data.friendRequests) data.friendRequests = [];
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// كل عملية كتابة تقرأ أحدث نسخة ثم تحفظ (كافي لعدد صغير من المستخدمين)
function update(mutatorFn) {
  const data = load();
  const result = mutatorFn(data);
  save(data);
  return result;
}

module.exports = { load, save, update };
