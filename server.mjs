import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scrypt as scryptCallback, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { seed } from './seed.mjs';

const env = process.env;
const port = Number(env.PORT || 4173);
const base = new URL(env.BASE_URL || 'http://127.0.0.1:' + port);
const demo = env.DEMO_MODE !== 'false';
const password = env.ADMIN_PASSWORD || (demo && 'tennis-demo');
if (!password || (!demo && (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_WEBHOOK_SECRET))) {
  throw Error('Set ADMIN_PASSWORD, a Stripe test secret key and a webhook signing secret before starting Stripe test mode.');
}
const db = new DatabaseSync(env.DB_PATH || (demo ? 'demo.sqlite' : 'stripe-test.sqlite'));
db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, deadline INTEGER NOT NULL,
data TEXT NOT NULL, stripe TEXT, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS coach_accounts (
  coach_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_archives (
  order_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (order_id,item_id)
);`);
db.prepare('INSERT OR IGNORE INTO content VALUES (1, ?)').run(JSON.stringify(seed));
const content = () => JSON.parse(db.prepare('SELECT data FROM content WHERE id=1').get().data);
const order = id => db.prepare('SELECT * FROM orders WHERE id=?').get(id);
const sign = (value, key) => createHmac('sha256', key).update(value).digest('hex');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const sessionKey = randomUUID();
const attempts = new Map();
function owner(req) {
  const ticket = /(?:^|;\s*)owner=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  const [deadline,signature] = ticket.split('.');
  return Number(deadline)>Date.now() && equal(signature,sign(deadline,sessionKey));
}
const scrypt=promisify(scryptCallback);
const coachById=db.prepare('SELECT * FROM coach_accounts WHERE coach_id=?');
const coachByUsername=db.prepare('SELECT * FROM coach_accounts WHERE username=?');
const coachAccountList=()=>db.prepare('SELECT coach_id AS coachId, username FROM coach_accounts').all();
const cookieFlags='; Path=/; HttpOnly; SameSite=Strict'+(base.protocol==='https:'?'; Secure':'');
function coachSession(req) {
  const ticket=/(?:^|;\s*)coach_session=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  const [id,deadline,signature]=ticket.split('.');
  if(!id || !(Number(deadline)>Date.now())) return null;
  const account=coachById.get(id);
  if(!account || !equal(signature,sign(id+'.'+deadline+'.'+account.password_hash,sessionKey))) return null;
  return content().coaches.find(coach=>coach.id===id) || null;
}
async function signInCoach(req, res, input) {
  const ip='coach:'+req.socket.remoteAddress;
  const now=Date.now();
  let attempt=attempts.get(ip);
  if(!attempt || attempt.until<=now) attempt={count:0,until:now+60000};
  if(attempt.count>=8) fail('Too many attempts. Try again in one minute.',429);
  attempt.count++;
  attempts.set(ip,attempt);
  const username=typeof input?.username==='string'?input.username.trim().toLowerCase():'';
  const given=typeof input?.password==='string'?input.password:'';
  if(username.length>60 || given.length>128) fail('Incorrect coach username or password.',401);
  const account=coachByUsername.get(username);
  const hash=(await scrypt(given,account?.salt || 'coach-login-placeholder',64)).toString('hex');
  const current=account && coachById.get(account.coach_id);
  if(!current || !equal(current.password_hash,hash) || !content().coaches.some(c=>c.id===account.coach_id)) {
    fail('Incorrect coach username or password.',401);
  }
  attempts.delete(ip);
  const ticket=account.coach_id+'.'+(now+8*3600000);
  res.setHeader('Set-Cookie','coach_session='+ticket+'.'+sign(ticket+'.'+current.password_hash,sessionKey)+cookieFlags+'; Max-Age=28800');
  return json(res,{ok:true});
}
async function updateCoachAccount(input) {
  const {coachId,action}=input || {};
  if(typeof coachId!=='string' || !content().coaches.some(c=>c.id===coachId)) fail('Save the coach profile before managing its login.');
  if(action==='disable') {
    db.prepare('DELETE FROM coach_accounts WHERE coach_id=?').run(coachId);
    return;
  }
  const username=typeof input.username==='string'?input.username.trim().toLowerCase():'';
  const given=input.password;
  if(action!=='save' || !/^[a-z0-9][a-z0-9._@+-]{2,59}$/.test(username) || typeof given!=='string' || given.length<12 || given.length>128) {
    fail('Use a username of 3 to 60 characters and a password of 12 to 128 characters.');
  }
  const salt=randomBytes(24).toString('hex');
  const hash=(await scrypt(given,salt,64)).toString('hex');
  if(!content().coaches.some(c=>c.id===coachId)) fail('This coach profile is no longer available.',409);
  const existing=coachByUsername.get(username);
  if(existing && existing.coach_id!==coachId) fail('That username is already in use.',409);
  db.prepare('INSERT INTO coach_accounts VALUES (?,?,?,?) ON CONFLICT(coach_id) DO UPDATE SET username=excluded.username, salt=excluded.salt, password_hash=excluded.password_hash').run(coachId,username,salt,hash);
}
function coachSchedule(coach) {
  const data=content(), usage=counts();
  const availability=data.offerings.filter(i=>i.type==='lesson' && i.coach===coach.id).map(i=>{
    const count=usage.get(i.id);
    return {id:i.id,date:i.date,time:i.time,duration:i.duration,location:i.location,
      status:count?.paid?'Booked':count?.held?'On hold':'Available'};
  });
  const bookings=paidOrders().flatMap(order=>order.items.filter(i=>i.coach===coach.id).map(i=>({
    id:i.id,title:i.title,date:i.date,endDate:i.endDate,time:i.time,duration:i.duration,location:i.location,player:order.details.player
  })));
  return {name:coach.name,availability,bookings};
}
function fail(message,status=400) { throw Object.assign(new Error(message),{status}); }
const json = (res,data,status=200) => {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
};
async function read(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if(size>5_000_000) fail('Request is too large.',413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
async function body(req) {
  try { return JSON.parse(await read(req)); }
  catch(error) { if(error.status) throw error; fail('Invalid request.'); }
}
function expireDemo() {
  if(demo) db.prepare("UPDATE orders SET status='expired' WHERE status='held' AND deadline<=?").run(Date.now());
}
function counts() {
  expireDemo();
  const usage = new Map();
  for(const row of db.prepare("SELECT status,data FROM orders WHERE status IN ('held','paid')").all()) {
    for(const item of JSON.parse(row.data).items) {
      const count = usage.get(item.id) || {held:0,paid:0};
      count[row.status]++;
      usage.set(item.id,count);
    }
  }
  return usage;
}
function offer(item, data, usage) {
  const count = usage.get(item.id) || {paid:0,held:0};
  const coach = data.coaches.find(c=>c.id===item.coach);
  const capacity = item.type==='camp' ? 15 : item.type==='lesson' ? 1 : Infinity;
  return {...item,title:item.type==='lesson'?'Private lesson':item.title,coachName:coach?.name || '',
    price:item.type==='lesson'?coach?.price:item.price,paid:count.paid,
    full:count.paid>=capacity,available:count.paid+count.held<capacity};
}
function reserve(input) {
  const {ids,details} = input || {};
  if(!Array.isArray(ids) || !ids.length || ids.length>12 || new Set(ids).size!==ids.length) fail('Choose between 1 and 12 different bookings.');
  const clean = {};
  for(const key of ['player','age','parent','email','phone','notes']) {
    clean[key] = typeof details?.[key]==='string'?details[key].trim():'';
    if(clean[key].length>(key==='notes'?1000:180)) fail('Please shorten the information entered.');
  }
  if(!clean.player || !clean.age || !clean.parent || !/^\S+@\S+\.\S+$/.test(clean.email) || clean.phone.replace(/\D/g,'').length<7 || details?.accepted!==true) fail('Complete the player and contact fields and accept the booking policy.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const data = content(), usage = counts();
    const items = ids.map(id=>{
      const item = data.offerings.find(o=>o.id===id);
      if(!item) fail('One selection is no longer listed.',409);
      const snapshot = offer(item,data,usage);
      if(!snapshot.available || !snapshot.price) fail('One selection is no longer available. Refresh and try again.',409);
      return snapshot;
    });
    if(items.length>1 && !items.every(i=>i.type==='lesson' && i.coach===items[0].coach)) fail('Group bookings must be lessons with the same coach.');
    const id = randomUUID();
    const deadline = Date.now() + (demo ? Number(env.DEMO_HOLD_SECONDS || 180)*1000 : 31*60*1000);
    const dataToSave = {details:clean,items,total:items.reduce((sum,i)=>sum+i.price,0), policy:data.home.policy};
    db.prepare("INSERT INTO orders (id,status,deadline,data) VALUES (?,'held',?,?)").run(id,deadline,JSON.stringify(dataToSave));
    db.exec('COMMIT');
    return order(id);
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
async function stripe(path, params, idempotency) {
  const headers = {Authorization:'Bearer '+env.STRIPE_SECRET_KEY};
  if(params) headers['Content-Type']='application/x-www-form-urlencoded';
  if(idempotency) headers['Idempotency-Key']=idempotency;
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions'+path,{
    method:params?'POST':'GET',headers,body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(12000)
  });
  const data = await response.json();
  if(!response.ok) throw Object.assign(new Error('Stripe Checkout request failed.'),{remoteStatus:response.status, status:502});
  return data;
}
function createCheckout(row) {
  const {details,items} = JSON.parse(row.data);
  const params = {
    mode:'payment','payment_method_types[0]':'card',client_reference_id:row.id,
    customer_email:details.email,expires_at:String(Math.floor(row.deadline/1000)),
    success_url:new URL('/?order='+row.id,base).href,
    cancel_url:new URL('/?cancel='+row.id,base).href
  };
  items.forEach((item,index)=>{
    const prefix='line_items['+index+']';
    params[prefix+'[price_data][currency]']='usd';
    params[prefix+'[price_data][unit_amount]']=String(item.price);
    params[prefix+'[price_data][product_data][name]']=item.title+' · '+item.date+' '+item.time;
    params[prefix+'[quantity]']='1';
  });
  return stripe('',params,row.id);
}
function applyStripe(session) {
  const row = order(session.client_reference_id);
  if(!row || (row.stripe && row.stripe!==session.id)) return;
  db.prepare('UPDATE orders SET stripe=? WHERE id=?').run(session.id,row.id);
  if(session.status==='complete' && session.payment_status==='paid' && session.currency==='usd' && session.amount_total===JSON.parse(row.data).total) {
    db.prepare("UPDATE orders SET status='paid' WHERE id=? AND status='held'").run(row.id);
  } else if(session.status==='expired'){
    db.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='held'").run(row.id);
  }
}
function verifyWebhook(raw, header='') {
  const parts=header.split(',').map(part=>part.split('='));
  const time=parts.find(([key])=>key==='t')?.[1];
  return Number.isFinite(Number(time)) && Math.abs(Date.now()/1000-Number(time))<300 &&
    parts.some(([key,value])=>key==='v1' && equal(value,sign(time+'.'+raw,env.STRIPE_WEBHOOK_SECRET)));
}
let reconciling=false;
async function reconcile() {
  if(reconciling) return;
  reconciling=true;
  try {
    if(!demo) {
      const overdue=db.prepare("SELECT * FROM orders WHERE status='held' AND deadline<=?").all(Date.now());
      for(const row of overdue) {
        try {
          if(row.stripe) applyStripe(await stripe('/'+row.stripe));
          else if(Date.now()-row.deadline<22*3600000) applyStripe(await createCheckout(row));
        } catch {
          console.error('Unable to verify expired Stripe checkout. The booking remains held.');
        }
      }
    }
    if(!demo && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && env.OWNER_PHONE) {
      for(const row of db.prepare("SELECT * FROM orders WHERE status='paid' AND notified=0").all()) {
        const {details,items,total}=JSON.parse(row.data);
        const summary=items.map(i=>[i.title,i.coachName,i.date,i.time,i.location].filter(Boolean).join(' · ')).join('\n');
        const response=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+env.TWILIO_ACCOUNT_SID+'/Messages.json',{
          method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64')},
          body:new URLSearchParams({From:env.TWILIO_FROM,To:env.OWNER_PHONE,Body:('Paid booking for '+details.player+'\n'+summary+'\nTotal $'+(total/100).toFixed(2)).slice(0,1500)}),signal:AbortSignal.timeout(8000)
        });
        if(response.ok) db.prepare('UPDATE orders SET notified=1 WHERE id=?').run(row.id);
      }
    }
  } catch { console.error('Booking maintenance failed. Will retry.'); }
  finally { reconciling=false; }
}
setInterval(reconcile,15000).unref();

function validatedContent(data) {
  const pick=(source,keys,max=4000)=>Object.fromEntries(keys.map(key=>{
    const value=source?.[key] ?? '';
    if(typeof value!=='string' || value.length>max) fail('Check the length of '+key+'.');
    return [key,value.trim()];
  }));
  const home=pick(data?.home,Object.keys(seed.home));
  home.headerTitle ||= seed.home.headerTitle;
  if(home.headerTitle.length>80) fail('Use 80 characters or fewer for the header title.');
  home.heroMode ||= 'photo';
  if(!['photo','rally'].includes(home.heroMode)) fail('Choose a homepage hero style.');
  const archiveDays = data?.archiveDays ?? seed.archiveDays;
  if(!Number.isInteger(archiveDays) || archiveDays<0 || archiveDays>3650) fail('Enter 0 to 3650 days for automatic archiving.');
  if(!home.title || !home.policy) fail('Homepage title and booking policy are required.');
  if(!Array.isArray(data.coaches) || !Array.isArray(data.offerings) || data.offerings.length>2000 || data.coaches.length>100) fail('Invalid catalog.');
  const price=value=>{
    if(!Number.isInteger(value) || value<50 || value>1000000) fail('Enter a price from $0.50 to $10,000.');
    return value;
  };
  const idSet=new Set();
  function unique(id) {
    if(!/^[\w-]{1,70}$/.test(id) || idSet.has(id)) fail('Each record must have a unique ID.');
    idSet.add(id);
  }
  const coaches=data.coaches.map(c=>{
    const coach=pick(c,['id','name','photo','awards','story','players']);
    unique(coach.id);
    if(!coach.name) fail('Coach name is required.');
    return {...coach,price:price(c.price)};
  });
  const dateOK=value=>/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  const offerings=data.offerings.map(o=>{
    const item=pick(o,['id','type','title','description','date','endDate','time','location','coach','photo']);
    unique(item.id);
    if(!['camp','event','lesson'].includes(item.type) || !dateOK(item.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) ||
      !item.location || !Number.isInteger(o.duration) || o.duration<1 || o.duration>720 ||
      (item.endDate && (!dateOK(item.endDate) || item.endDate<item.date)) ||
      (item.type==='lesson' && !coaches.some(c=>c.id===item.coach)) ||
      (item.type!=='lesson' && !item.title) || (item.coach && !coaches.some(c=>c.id===item.coach))) fail('Complete the schedule fields and assign an existing coach to every private lesson.');
    return {...item,duration:o.duration,...(item.type==='lesson'?{}:{price:price(o.price)})};
  });
  const schedules=new Map();
  for(const slot of offerings.filter(o=>o.type==='lesson')) {
    const key=slot.coach+':'+slot.date;
    const [hour,minute]=slot.time.split(':').map(Number);
    const start=hour*60+minute,end=start+slot.duration;
    const schedule=schedules.get(key)||[];
    if(end>1440 || schedule.some(([a,b])=>start<b && end>a)) fail('Private lesson times must fit in one day and cannot overlap for the same coach.');
    schedule.push([start,end]); schedules.set(key,schedule);
  }
  return {home,coaches,offerings,archiveDays};
}
function protectBookedSlots(next) {
  const previous=content();
  const active=db.prepare("SELECT data FROM orders WHERE status IN ('held','paid')").all();
  const slots=active.flatMap(row=>JSON.parse(row.data).items).filter(i=>i.type==='lesson');
  for(const item of next.offerings.filter(i=>i.type==='lesson')) {
    const old=previous.offerings.find(o=>o.id===item.id);
    const toMinutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
    const start=toMinutes(item.time);
    if(slots.some(slot=>{
      if(slot.id===item.id) return !old || ['coach','date','time','duration','location'].some(key=>item[key]!==old[key]);
      const priorStart=toMinutes(slot.time);
      return slot.date===item.date && slot.coach===item.coach && start<priorStart+slot.duration && priorStart<start+item.duration;
    })) fail('This change conflicts with a booked or held lesson.',409);
  }
}
function paidOrders() {
  return db.prepare("SELECT id,data FROM orders WHERE status='paid' ORDER BY rowid DESC").all().map(row=>({id:row.id,...JSON.parse(row.data)}));
}
function dashboardOrders(archiveDays) {
  // Compare calendar dates in the same time zone used by the published schedules.
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const today=Object.fromEntries(parts.map(({type,value})=>[type,value]));
  const cutoff=Date.UTC(Number(today.year),Number(today.month)-1,Number(today.day));
  const manual=new Set(db.prepare('SELECT order_id,item_id FROM booking_archives').all().map(row=>row.order_id+':'+row.item_id));
  return paidOrders().map(booking=>({...booking,items:booking.items.map(item=>({
    ...item,
    archived:manual.has(booking.id+':'+item.id) || (archiveDays>0 && Date.parse(item.endDate || item.date)+archiveDays*86400000<=cutoff)
  }))}));
}
function csvCell(value) {
  const raw=String(value??'');
  return '"'+(/^[\s]*[=+\-@]|^[\t\r\n]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';
}

const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: http: data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path=new URL(req.url,base).pathname;
    const method=req.method;
    if(method==='POST' && path!=='/api/stripe/webhook' && req.headers.origin && req.headers.origin!==base.origin) fail('Request origin is invalid.',403);
    if(path==='/api/catalog' && method==='GET') {
      const data=content(), usage=counts();
      return json(res,{demo,home:data.home,coaches:data.coaches,offerings:data.offerings.map(i=>offer(i,data,usage))});
    }
    if(path==='/api/checkout' && method==='POST') {
      const row=reserve(await body(req));
      if(demo) return json(res,{url:'/?demo='+row.id});
      try {
        const session=await createCheckout(row);
        applyStripe(session);
        return json(res,{url:session.url});
      } catch(error) {
        if(error.remoteStatus===400) db.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='held' AND stripe IS NULL").run(row.id);
        throw error;
      }
    }
    if(path==='/api/order' && method==='GET') {
      expireDemo();
      const id=new URL(req.url,base).searchParams.get('id');
      let row=order(id);
      if(!row) fail('Booking could not be found.',404);
      if(!demo && row.status==='held' && row.stripe) {
        applyStripe(await stripe('/'+row.stripe));
        row=order(id);
      }
      const {items,total,policy}=JSON.parse(row.data);
      return json(res,{status:row.status,items,total,policy});
    }
    if(path==='/api/payment' && method==='POST') {
      const {id,action}=await body(req);
      expireDemo();
      const row=order(id);
      if(!row || row.status!=='held') fail('This checkout is no longer open.',409);
      if(action==='pay' && demo) db.prepare("UPDATE orders SET status='paid' WHERE id=? AND status='held'").run(id);
      else if(action==='cancel') {
        if(demo) db.prepare("UPDATE orders SET status='expired' WHERE id=? AND status='held'").run(id);
        else if(row.stripe) {
          let result;
          try { result=await stripe('/'+row.stripe+'/expire',{}); }
          catch { result=await stripe('/'+row.stripe); }
          applyStripe(result);
        }
      } else fail('Payment action is unavailable.');
      return json(res,{status:order(id).status});
    }
    if(path==='/api/stripe/webhook' && method==='POST' && !demo) {
      const raw=await read(req);
      if(!verifyWebhook(raw,req.headers['stripe-signature'])) fail('Invalid Stripe signature.',400);
      const event=JSON.parse(raw);
      if(['checkout.session.completed','checkout.session.expired'].includes(event.type)) applyStripe(event.data.object);
      return json(res,{received:true});
    }
    if(path==='/api/login' && method==='POST') {
      const {password:given}=await body(req);
      const ip=req.socket.remoteAddress;
      const now=Date.now();
      let attempt=attempts.get(ip);
      if(!attempt || attempt.until<=now) attempt={count:0,until:now+60000};
      if(attempt.count>=8) fail('Too many attempts. Try again in one minute.',429);
      if(!equal(given,password)) {
        attempt.count++;
        attempts.set(ip,attempt);
        fail('Incorrect owner password.',401);
      }
      attempts.delete(ip);
      const deadline=String(now+8*3600000);
      res.setHeader('Set-Cookie','owner='+deadline+'.'+sign(deadline,sessionKey)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'+(base.protocol==='https:'?'; Secure':''));
      return json(res,{ok:true});
    }
    if(path==='/api/coach/login' && method==='POST') return await signInCoach(req,res,await body(req));
    if(path==='/api/coach/logout' && method==='POST') {
      res.setHeader('Set-Cookie','coach_session='+cookieFlags+'; Max-Age=0');
      return json(res,{ok:true});
    }
    if(path==='/api/coach' && method==='GET') {
      const coach=coachSession(req);
      if(!coach) fail('Coach login required.',401);
      return json(res,coachSchedule(coach));
    }
    if(path.startsWith('/api/admin')) {
      if(!owner(req)) fail('Owner login required.',401);
      if(path==='/api/admin' && method==='GET') {
        const data=content();
        data.archiveDays ??= seed.archiveDays;
        data.home.headerTitle ||= seed.home.headerTitle;
        data.home.heroMode ||= 'photo';
        return json(res,{content:data,orders:dashboardOrders(data.archiveDays),coachAccounts:coachAccountList()});
      }
      if(path==='/api/admin/archive' && method==='POST') {
        const {orderId,itemId}=await body(req) || {};
        if(typeof orderId!=='string' || typeof itemId!=='string') fail('Choose a booking to archive.');
        const booking=order(orderId);
        if(booking?.status!=='paid' || !JSON.parse(booking.data).items.some(item=>item.id===itemId)) fail('Paid booking not found.',404);
        db.prepare('INSERT OR IGNORE INTO booking_archives (order_id,item_id) VALUES (?,?)').run(orderId,itemId);
        return json(res,{orders:dashboardOrders(content().archiveDays ?? seed.archiveDays)});
      }
      if(path==='/api/admin/coach-account' && method==='POST') {
        await updateCoachAccount(await body(req));
        return json(res,{coachAccounts:coachAccountList()});
      }
      if(path==='/api/admin' && method==='POST') {
        const next=validatedContent(await body(req));
        expireDemo();
        protectBookedSlots(next);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE content SET data=? WHERE id=1').run(JSON.stringify(next));
          const removeAccount=db.prepare('DELETE FROM coach_accounts WHERE coach_id=?');
          for(const {coachId} of coachAccountList()) {
            if(!next.coaches.some(c=>c.id===coachId)) removeAccount.run(coachId);
          }
          db.exec('COMMIT');
        } catch(error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return json(res,{ok:true});
      }
      if(path==='/api/admin/logout' && method==='POST') {
        res.setHeader('Set-Cookie','owner=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        return json(res,{ok:true});
      }
      if(path==='/api/admin/export.csv' && method==='GET') {
        const rows=[['Booking ID','Type','Program','Player','Age or grade','Parent/customer','Email','Phone','Coach','Date','End date','Time','Location','Price paid USD','Notes']];
        for(const booking of paidOrders()) for(const i of booking.items) {
          const d=booking.details;
          rows.push([booking.id,i.type,i.title,d.player,d.age,d.parent,d.email,d.phone,i.coachName,i.date,i.endDate,i.time,i.location,(i.price/100).toFixed(2),d.notes]);
        }
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="nwi-bookings.csv"'});
        return res.end('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));
      }
    }
    const files={'/style.css':['style.css','text/css'],'/app.js':['app.js','text/javascript']};
    const pages=['/','/camps','/lessons','/events','/owner','/coach'];
    const file=Object.hasOwn(files,path) ? files[path] : pages.includes(path) && ['index.html','text/html'];
    if(method!=='GET' || !file) fail('Page not found.',404);
    res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});
    res.end(await readFile(new URL('./public/'+file[0],import.meta.url)));
  } catch(error) {
    if(error.status>=500 || !error.status) console.error(error.message);
    if(!res.headersSent) json(res,{error:error.status?error.message:'Something went wrong. Please try again.'},error.status||500);
    else res.end();
  }
});
server.listen(port,'127.0.0.1',()=>console.log('NWI Summer Tennis running at '+base.origin+' ('+(demo?'demo':'Stripe test')+')'));


