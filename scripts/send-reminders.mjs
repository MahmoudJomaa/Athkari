// Sends Zakeroon reminders through Firebase Cloud Messaging.
// Runs every 15 minutes from .github/workflows/reminders.yml.
// Only users who signed in and allowed notifications are reminded, and only
// while the reminder window is open and that period isn't finished yet.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) {
  console.log('FIREBASE_SERVICE_ACCOUNT secret is not set yet; nothing to do.');
  process.exit(0);
}
let account;
try {
  account = JSON.parse(sa);
} catch {
  console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole service-account .json file into the secret.');
  process.exit(1);
}
initializeApp({ credential: cert(account) });
const db = getFirestore();
const fcm = getMessaging();

const RM = {
  m: { title: '☀️ وقت أذكار الصباح', body: 'ابدأ يومك بذكر الله، أذكار الصباح في انتظارك', url: './?p=z&per=m' },
  e: { title: '🌙 وقت أذكار المساء', body: 'لا تفوّتك أذكار المساء قبل الغروب', url: './?p=z&per=e' },
  t: { title: '📿 دقيقة تسبيح واستغفار', body: 'سبحان الله وبحمده، أستغفر الله وأتوب إليه', url: './?p=t' }
};
const DEF_RM = { m: true, e: true, t: true };
const DEF_RT = { m: '06:00', e: '15:30', t: '13:00' };
const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

const hm = s => { const p = String(s || '0:0').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); };
// Same windows as the app (see remEnd in index.html)
const windowEnd = (k, st) => k === 'e' ? 1440 : k === 'm' ? Math.max(720, st + 180) : Math.min(1440, st + 180);

// The user's date key (same format as the app: Y-M-D without padding) and minutes since midnight
function localNow(tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
  } catch {
    return localNow('Africa/Cairo');
  }
  const g = t => +parts.find(p => p.type === t).value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, min: g('hour') * 60 + g('minute') };
}

const snap = await db.collection('users').where('push', '==', true).get();
let sent = 0;

for (const doc of snap.docs) {
  const u = doc.data();
  let tokens = Array.isArray(u.tokens) ? u.tokens : [];
  if (!tokens.length) continue;
  const d = u.d || {};
  const now = localNow(u.tz || 'Africa/Cairo');
  const rm = { ...DEF_RM, ...(d.rm || {}) };
  const rt = { ...DEF_RT, ...(d.rt || {}) };
  const doneToday = (d.hist || {})[now.day] || {};
  const today = d.today && d.today.day === now.day ? d.today : {};
  const already = u.sent && u.sent.day === now.day ? { ...u.sent } : { day: now.day };
  const dead = new Set();
  let changed = false;

  for (const k of ['m', 'e', 't']) {
    if (!rm[k] || already[k] || (today.rx || {})[k]) continue;
    const st = hm(rt[k]);
    if (now.min < st || now.min >= windowEnd(k, st)) continue;
    const done = k === 't' ? (today.t || 0) >= 33 : !!doneToday[k];
    if (done) continue;

    const r = RM[k];
    const res = await fcm.sendEachForMulticast({
      tokens,
      data: { title: r.title, body: r.body, url: r.url, tag: 'zk-' + k },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } }
    });
    res.responses.forEach((x, i) => { if (!x.success && DEAD.has(x.error?.code)) dead.add(tokens[i]); });
    sent += res.successCount;
    already[k] = true;
    changed = true;
  }

  if (changed || dead.size) {
    tokens = tokens.filter(t => !dead.has(t));
    await doc.ref.set({ sent: already, tokens, push: tokens.length > 0 }, { merge: true });
  }
}

console.log(`Checked ${snap.size} users, sent ${sent} notifications.`);
