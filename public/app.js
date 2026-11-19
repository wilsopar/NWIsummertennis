const main = document.querySelector('#main');
const dialog = document.querySelector('#booking');
const form = document.querySelector('#checkout');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = value => /^https?:\/\//i.test(value || '') ? esc(value) : '';
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const date = value => new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00Z'));
const time = value => new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'}).format(new Date('2000-01-01T'+value+'Z'));
const where = i => [date(i.date)+(i.endDate?' – '+date(i.endDate):''),time(i.time)+' EST'+(i.duration?' · '+i.duration+' min':''),i.location,i.coachName].filter(Boolean).map(esc).join('<br>');
let catalog, editable, coachAccounts=[], availabilityCoach='';

async function api(path,data) {
  const response = await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const result = await response.json();
  if(!response.ok) throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}
function head(title,intro='') {
  return '<section class="page-head"><div class="shell"><h1>'+esc(title)+'</h1>'+(intro?'<p>'+esc(intro)+'</p>':'')+'</div></section>';
}
function photo(value,label) {
  return '<div class="photo">'+(url(value)?'<img src="'+url(value)+'" alt="'+esc(label.replace(' placeholder',''))+'">':'<span>'+esc(label)+'</span>')+'</div>';
}
function sample() {
  return '<p class="sample">'+(catalog.demo?'Demo checkout · no money collected. ':'Stripe test checkout · no money collected. ')+'Sample schedules and prices can be changed in the owner dashboard.</p>';
}
function rally() {
  return '<div class="rally" role="img" aria-label="Illustrated tennis rally with two racquets hitting a ball across a court">'+
    '<div class="rally-court" aria-hidden="true"><span class="court-lines"></span><span class="court-net"></span></div>'+
    '<div class="rally-ball-track" aria-hidden="true"><span class="rally-ball"></span></div>'+
    '<span class="racquet racquet-left" aria-hidden="true"></span><span class="racquet racquet-right" aria-hidden="true"></span></div>';
}
function home() {
  const h=catalog.home;
  main.innerHTML='<section class="hero"><div class="shell hero-grid"><div><p class="eyebrow">Northwest Indiana</p><h1>'+esc(h.title)+'</h1><p>'+esc(h.intro)+'</p></div>'+(h.heroMode==='rally'?rally():photo(h.hero,'Coaching photo placeholder'))+'</div></section>'+
    '<section class="actions"><div class="shell action-grid"><a href="/camps">Tennis Camps</a><a href="/lessons">Private Lessons</a><a href="/events">Match Play Events</a></div></section>'+
    '<section class="section shell story">'+photo(h.founder,'Founder photo placeholder')+'<div><h2>'+esc(h.storyTitle)+'</h2><p>'+esc(h.story)+'</p><h3>Contact</h3><p>'+esc(h.contact)+'</p><div class="row">'+
    (url(h.instagram)?'<a href="'+url(h.instagram)+'">Instagram</a>':'')+(url(h.facebook)?'<a href="'+url(h.facebook)+'">Facebook</a>':'')+'</div></div></section>';
}
function programs(type) {
  const camps=type==='camp';
  const items=catalog.offerings.filter(i=>i.type===type).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  main.innerHTML=head(camps?'Tennis Camps':'Match Play Events',camps?'Find a camp group and session that fits your player.':'Find upcoming opportunities to get on court and play matches.')+
    '<section class="section shell">'+sample()+'<div class="cards">'+items.map(i=>'<article class="card">'+photo(i.photo,camps?'Camp photo placeholder':'Event photo placeholder')+
      '<h2>'+esc(i.title)+'</h2><p>'+esc(i.description)+'</p><p class="meta">'+where(i)+'</p><p class="price">'+money(i.price)+'</p>'+
      (camps?'<p>'+i.paid+' / 15 registered</p>':'')+'<button type="button" data-register="'+esc(i.id)+'" '+(i.available?'':'disabled')+'>'+(i.full?'Full':i.available?'Register':'Temporarily held')+'</button></article>').join('')+
    (!items.length?'<p>No sessions are listed yet.</p>':'')+'</div></section>';
  main.querySelectorAll('[data-register]').forEach(button=>button.onclick=()=>checkout(items.filter(i=>i.id===button.dataset.register)));
}
function lessons() {
  main.innerHTML=head('Choose Your Coach','Explore each coach’s background and choose one or more available lesson times.')+'<section class="section shell">'+sample()+
    (catalog.coaches.length?'':'<p>Coach profiles are coming soon.</p>')+catalog.coaches.map(c=>'<article class="profile">'+photo(c.photo,'Coach photo placeholder')+
    '<div><h2>'+esc(c.name)+'</h2><p class="price">'+money(c.price)+' per lesson</p>'+[
      ['Distinctions & Awards',c.awards],['My Tennis Story',c.story],['Players I Coach',c.players]
    ].map(([title,copy])=>'<details><summary>'+title+'</summary><p>'+esc(copy)+'</p></details>').join('')+
    '<button type="button" data-coach="'+esc(c.id)+'">Book Me</button></div></article>').join('')+'</section>';
  main.querySelectorAll('[data-coach]').forEach(button=>button.onclick=()=>slots(button.dataset.coach));
}
function slots(id, previous=[]) {
  const coach=catalog.coaches.find(c=>c.id===id);
  const items=catalog.offerings.filter(i=>i.type==='lesson' && i.coach===id && i.available).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const byDate=Map.groupBy(items,item=>item.date);
  form.innerHTML='<h2>Book '+esc(coach.name)+'</h2><p>Choose up to 12 times across one or more dates. All times are EST.</p>'+
    '<div class="slot-list">'+[...byDate.entries()].map(([day,daySlots])=>
      '<fieldset class="slot-day"><legend>'+esc(date(day))+'</legend><div class="slot-grid">'+
      daySlots.map(item=>'<label class="slot-option"><input type="checkbox" name="slot" value="'+esc(item.id)+'" '+
        (previous.includes(item.id)?'checked':'')+'><span class="slot-description"><strong>'+time(item.time)+' EST</strong>'+
        '<span>'+esc(item.location)+' · '+item.duration+' min</span></span><strong class="slot-price">'+money(item.price)+'</strong></label>').join('')+
      '</div></fieldset>').join('')+'</div>'+
    (!items.length?'<p>No times are currently available.</p>':'')+
    '<div class="slot-footer"><p class="price" id="slot-total" aria-live="polite"></p><div class="row"><button type="submit" disabled>Continue</button><button type="button" class="secondary" data-close>Close</button></div></div>';
  const chosen=()=>{
    const selected=new Set(new FormData(form).getAll('slot'));
    return items.filter(item=>selected.has(item.id));
  };
  function updateSelection() {
    const selected=chosen();
    form.querySelector('#slot-total').textContent=selected.length>12?'Choose up to 12 times':selected.length?
      selected.length+' selected · '+money(selected.reduce((sum,item)=>sum+item.price,0)):'No times selected';
    form.querySelector('[type=submit]').disabled=selected.length===0 || selected.length>12;
  }
  form.onchange=updateSelection;
  form.onsubmit=event=>{
    event.preventDefault();
    const selected=chosen();
    if(selected.length>0 && selected.length<=12) checkout(selected,()=>slots(id,selected.map(item=>item.id)));
  };
  updateSelection();
  showDialog();
}
function showDialog() {
  form.querySelector('[data-close]').onclick=()=>dialog.close();
  if(!dialog.open) dialog.showModal();
}
const orderSummary = items => items.map(i=>'<p><strong>'+esc(i.title)+' · '+money(i.price)+'</strong><br>'+where(i)+'</p>').join('');
function checkout(items, back) {
  form.onchange=null;
  form.innerHTML='<h2>Review your booking</h2>'+orderSummary(items)+'<p class="price">Total '+money(items.reduce((sum,i)=>sum+i.price,0))+'</p>'+
    '<fieldset><legend>Player and parent information</legend><div class="field-grid">'+
    '<label>Player name<input name="player" required maxlength="180"></label><label>Age or grade<input name="age" required maxlength="180"></label>'+
    '<label>Parent or customer name<input name="parent" autocomplete="name" required maxlength="180"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="180"></label>'+
    '<label>Phone<input name="phone" type="tel" autocomplete="tel" required maxlength="180"></label></div>'+
    '<label>Notes for the coach (optional)<textarea name="notes" maxlength="1000"></textarea></label></fieldset>'+
    '<label class="check"><input name="accepted" type="checkbox" required><span>'+esc(catalog.home.policy)+'</span></label>'+
    '<p class="error" role="alert"></p><div class="row"><button type="submit">Checkout</button><button type="button" class="secondary" data-close>'+(back?'Change times':'Back to site')+'</button></div>';
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('[type=submit]');
    const details=Object.fromEntries(new FormData(form));
    details.accepted=details.accepted==='on';
    button.disabled=true;
    try { location.assign((await api('checkout',{ids:items.map(i=>i.id),details})).url); }
    catch(error) { form.querySelector('.error').textContent=error.message;button.disabled=false; }
  };
  showDialog();
  if(back) form.querySelector('[data-close]').onclick=back;
}
async function payment(id,mode) {
  if(mode==='cancel') await api('payment',{id,action:'cancel'}).catch(()=>{});
  const result=await api('order?id='+encodeURIComponent(id));
  const paid=result.status==='paid', open=result.status==='held', simulated=mode==='demo' && catalog.demo && open;
  const title=paid?'Booking confirmed':simulated?'Demo checkout':open?'Payment confirmation pending':'Checkout closed';
  main.innerHTML=head(title)+'<section class="section shell">'+orderSummary(result.items)+'<p class="price">Total '+money(result.total)+'</p>'+
    (simulated?'<p>Simulate payment or cancel to release your reservation.</p><div class="row"><button data-pay="pay">Simulate successful payment</button><button class="secondary" data-pay="cancel">Cancel checkout</button></div>':
      open?'<p>Refresh this page to check payment status.</p>':'<a class="button" href="/">Back to NWI Summer Tennis</a>')+'<p class="error" role="alert"></p></section>';
  main.querySelectorAll('[data-pay]').forEach(button=>button.onclick=async()=>{
    main.querySelectorAll('[data-pay]').forEach(b=>b.disabled=true);
    try { await api('payment',{id,action:button.dataset.pay});location.assign('/?order='+encodeURIComponent(id)); }
    catch(error){ main.querySelector('.error').textContent=error.message;main.querySelectorAll('[data-pay]').forEach(b=>b.disabled=false); }
  });
}
const homeLabels={headerTitle:'Header title',favicon:'Browser tab icon URL',title:'Homepage headline',intro:'Introduction',storyTitle:'Founder section heading',story:'Founder story',contact:'Contact information',logo:'Logo image URL',heroMode:'Main homepage visual',hero:'Coaching photo URL',founder:'Founder photo URL',instagram:'Instagram URL',facebook:'Facebook URL',policy:'Booking policy'};
const coachLabels={name:'Coach name',price:'Lesson price ($)',photo:'Coach photo URL',awards:'Distinctions & awards',story:'Tennis story',players:'Players coached (age and level)'};
const offerLabels={title:'Program or group name',description:'Description',date:'Start date',endDate:'End date (optional)',time:'Start time (EST)',duration:'Duration in minutes',location:'Court location',coach:'Assigned coach',price:'Price ($)',photo:'Photo URL'};
function fields(obj,labels,group,index) {
  return '<div class="field-grid">'+Object.entries(labels).map(([key,label])=>{
    const attr='data-field="'+key+'" data-group="'+group+'" data-index="'+index+'"';
    const value=obj[key] ?? '';
    const type={archiveDays:'number',date:'date',endDate:'date',time:'time',duration:'number',price:'number'}[key] || 'text';
    let field;
    if(key==='heroMode') field='<select '+attr+'><option value="photo">Photo</option><option value="rally" '+(value==='rally'?'selected':'')+'>Animated tennis rally</option></select>';
    else if(key==='coach') field='<select '+attr+'><option value="">Choose coach</option>'+editable.coaches.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===value?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select>';
    else if(['intro','story','policy','awards','players','description'].includes(key)) field='<textarea '+attr+'>'+esc(value)+'</textarea>';
    else field='<input type="'+type+'" '+attr+' value="'+esc(key==='price'?value/100:value)+'" '+(key==='price'?'step=".01" min=".50"':key==='archiveDays'?'min="0" max="3650" step="1"':'')+'>';
    return '<label>'+label+field+'</label>';
  }).join('')+'</div>';
}
function bookingGroups(entries) {
  const groups = new Map();
  for(const entry of entries) {
    const key=entry.item.coach || entry.item.coachName || '';
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(entry);
  }
  return [...groups.entries()].map(([key, group])=>{
    const name=editable.coaches.find(c=>c.id===key)?.name || group[0].item.coachName || 'Unassigned';
    return '<section class="coach-bookings"><h3>'+esc(name)+' <span class="booking-count">'+group.length+'</span></h3>'+
      '<ul class="booking-list">'+group.map(({item,details,orderId})=>'<li class="booking-record">'+
        '<div><strong>'+esc(details.player)+'</strong><br>'+esc(details.age)+'</div>'+
        '<div><strong>'+esc(item.title)+'</strong><br>'+where({...item,coachName:''})+'</div>'+
        '<div><strong>'+money(item.price)+'</strong><br>'+esc(details.parent)+'<br>'+esc(details.email)+'<br>'+esc(details.phone)+'</div>'+
        (details.notes?'<p class="booking-notes">'+esc(details.notes)+'</p>':'')+
        (item.archived?'':'<div class="booking-actions"><button class="secondary" data-archive="'+esc(orderId)+'" data-item="'+esc(item.id)+'">Archive now</button></div>')+'</li>').join('')+'</ul></section>';
  }).join('');
}
function coachAccountFields() {
  return editable.coaches.map(coach=>{
    const account=coachAccounts.find(entry=>entry.coachId===coach.id);
    return '<form class="edit-row" data-coach-account="'+esc(coach.id)+'">'+
      '<h3>'+esc(coach.name)+'</h3><p>'+(account?'Login enabled':'No login yet')+'</p>'+
      '<div class="field-grid"><label>Username<input name="username" required minlength="3" maxlength="60" autocomplete="off" value="'+esc(account?.username)+'"></label>'+
      '<label>'+(account?'New password':'Password')+'<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label></div>'+
      '<div class="row"><button type="submit">'+(account?'Update login':'Create login')+'</button>'+
      (account?'<button type="button" class="secondary" data-disable-coach>Disable login</button>':'')+'</div><p role="status"></p></form>';
  }).join('') || '<p>Add a coach profile and save it first.</p>';
}
async function changeCoachAccount(form, action) {
  const message=form.querySelector('[role=status]');
  const input=action==='save'?Object.fromEntries(new FormData(form)):{};
  const buttons=[...form.querySelectorAll('button')];
  buttons.forEach(b=>b.disabled=true);
  try {
    const result=await api('admin/coach-account',{...input,coachId:form.dataset.coachAccount,action});
    coachAccounts=result.coachAccounts;
    const section=form.closest('details');
    section.querySelector('.coach-accounts').innerHTML=coachAccountFields();
    const updated=[...section.querySelectorAll('form')].find(f=>f.dataset.coachAccount===form.dataset.coachAccount);
    const status=updated.querySelector('[role=status]');
    status.className='success';
    status.textContent=action==='save'?'Coach login saved.':'Coach login disabled.';
    updated.querySelector('button').focus();
  } catch(error) {
    message.className='error';
    message.textContent=error.message;
  } finally { buttons.forEach(b=>b.disabled=false); }
}
function dashboard(orders) {
  const headings={camp:'Camp sessions',event:'Match play events'};
  const open = new Set([...main.querySelectorAll('[data-area][open]')].map(d=>d.dataset.area));
  const entries=orders.flatMap(order=>order.items.map(item=>({item,details:order.details,orderId:order.id})));
  const active=entries.filter(({item})=>!item.archived);
  const archived=entries.filter(({item})=>item.archived);
  const section=(key,title,body)=>'<details data-area="'+key+'" '+(open.has(key)?'open':'')+'><summary>'+title+'</summary>'+body+'</details>';
  const controls=(group,index,reorder)=>'<div class="row">'+(reorder?'<button class="secondary" data-move="-1" data-group="'+group+'" data-index="'+index+'" '+(index===0?'disabled':'')+'>Move up</button><button class="secondary" data-move="1" data-group="'+group+'" data-index="'+index+'" '+(index===editable.coaches.length-1?'disabled':'')+'>Move down</button>':'')+
    '<button class="secondary" data-remove data-group="'+group+'" data-index="'+index+'">Remove</button></div>';
  const selectedCoach=editable.coaches.find(coach=>coach.id===availabilityCoach);
  if(!selectedCoach) availabilityCoach='';
  const availability=editable.offerings.map((item,index)=>({item,index}))
    .filter(({item})=>item.type==='lesson' && item.coach===availabilityCoach)
    .sort((a,b)=>(a.item.date+a.item.time).localeCompare(b.item.date+b.item.time));
  const slotLabels=Object.fromEntries(['date','time','duration','location'].map(key=>[key,offerLabels[key]]));
  main.innerHTML=head('Owner Dashboard')+'<div class="section shell admin-grid"><div class="panel"><div class="row"><h2>Paid Bookings</h2><a class="button secondary" href="/api/admin/export.csv">Export CSV</a><button class="secondary" id="logout">Sign out</button></div>'+
    (bookingGroups(active)||'<p>No active paid bookings.</p>')+
    '<p id="archive-status" role="status"></p>'+
    section('archived','Archived ('+archived.length+')',bookingGroups(archived)||'<p>No archived bookings yet.</p>')+'</div>'+
    section('archive-settings','Archive settings',fields(editable,{archiveDays:'Days after the booking ends'},'settings',0)+
      '<p>Bookings move to Archived after this many calendar days. Enter 0 to turn off automatic archiving. CSV export includes archived bookings.</p>')+
    '<h2>Edit website</h2><p>Paste image URLs and save your changes when you’re ready.</p>'+
    section('home','Homepage, photos and policy',fields(editable.home,homeLabels,'home',0))+
    section('coach-logins','Coach logins','<p>Save the coach profile first, then create a username and password here. Coaches sign in from the site footer.</p><div class="coach-accounts">'+coachAccountFields()+'</div>')+
    section('coach','Coaches and lesson prices',editable.coaches.map((c,index)=>'<div class="edit-row">'+fields(c,coachLabels,'coaches',index)+controls('coaches',index,true)+'</div>').join('')+'<button data-add="coach">Add coach</button>')+
    section('lesson','Lesson availability','<label>Choose a coach<select id="availability-coach"><option value="">Select a coach</option>'+
      editable.coaches.map(coach=>'<option value="'+esc(coach.id)+'" '+(coach.id===availabilityCoach?'selected':'')+'>'+esc(coach.name)+'</option>').join('')+
      '</select></label>'+
      (selectedCoach?(availability.length?availability.map(({item,index})=>'<div class="edit-row">'+fields(item,slotLabels,'offerings',index)+controls('offerings',index,false)+'</div>').join(''):'<p>No lesson slots assigned to this coach.</p>')+
        '<button data-add="lesson">Add lesson slot</button>':''))+
    Object.entries(headings).map(([type,label])=>section(type,label,editable.offerings.map((i,index)=>{
      if(i.type!==type) return '';
      return '<div class="edit-row">'+fields(i,offerLabels,'offerings',index)+controls('offerings',index,false)+'</div>';
    }).join('')+'<button data-add="'+type+'">Add '+(type==='camp'?'camp session':'event')+'</button>')).join('')+
    '<div class="sticky row"><button id="save">Save changes</button><span id="save-status" role="status"></span></div></div>';
  const coachSelector=main.querySelector('#availability-coach');
  coachSelector.onchange=()=>{
    availabilityCoach=coachSelector.value;
    dashboard(orders);
    main.querySelector('#availability-coach').focus();
  };
  main.onsubmit=event=>{
    if(!event.target.matches('[data-coach-account]')) return;
    event.preventDefault();
    changeCoachAccount(event.target,'save');
  };
  main.oninput=event=>{
    const el=event.target;
    const {field,group,index}=el.dataset;
    if(!field) return;
    const item=group==='settings'?editable:group==='home'?editable.home:editable[group][Number(index)];
    item[field]=field==='price'?Math.round(Number(el.value)*100):['duration','archiveDays'].includes(field)?(el.value===''?null:Number(el.value)):el.value;
  };
  main.onclick=async event=>{
    const b=event.target.closest('button');
    if(!b) return;
    const {add,group,index,move}=b.dataset;
    if(b.hasAttribute('data-archive')) {
      b.disabled=true;
      try {
        const result=await api('admin/archive',{orderId:b.dataset.archive,itemId:b.dataset.item});
        dashboard(result.orders);
        main.querySelector('[data-area="archived"] summary').focus();
        const status=main.querySelector('#archive-status');
        status.className='success';
        status.textContent='Booking moved to Archived.';
      } catch(error) {
        b.disabled=false;
        const status=main.querySelector('#archive-status');
        status.className='error';
        status.textContent=error.message;
      }
    } else if(b.hasAttribute('data-disable-coach')) {
      changeCoachAccount(b.closest('form'),'disable');
    } else if(add) {
      const id=crypto.randomUUID();
      if(add==='coach') editable.coaches.push({id,name:'New coach',price:3500});
      else editable.offerings.push({id,type:add,date:'',time:'',duration:60,location:'',coach:add==='lesson'?availabilityCoach:'',price:2000,title:'',description:''});
      dashboard(orders);
      const section=main.querySelector('[data-area="'+add+'"]');
      section.open=true;
      const rows=section.querySelectorAll('.edit-row');
      (add==='lesson'?rows[0]:[...rows].at(-1))?.querySelector('input')?.focus();
    } else if(move) {
      const i=Number(index), j=i+Number(move);
      [editable[group][i],editable[group][j]]=[editable[group][j],editable[group][i]];
      dashboard(orders);
    } else if(b.hasAttribute('data-remove')) {
      const [removed]=editable[group].splice(Number(index),1);
      if(group==='coaches') {
        editable.offerings=editable.offerings.filter(i=>i.type!=='lesson' || i.coach!==removed.id);
        editable.offerings.forEach(i=>{if(i.coach===removed.id)i.coach='';});
      }
      dashboard(orders);
    } else if(b.id==='save') {
      const status=document.querySelector('#save-status');
      b.disabled=true;
      try {
        await api('admin',editable);
        const latest=await api('admin');
        editable=latest.content;
        coachAccounts=latest.coachAccounts;
        dashboard(latest.orders);
        const message=document.querySelector('#save-status');
        message.className='success';
        message.textContent='Saved.';
        document.querySelector('#save').focus();
      }
      catch(error){status.className='error';status.textContent=error.message;}
      finally { b.disabled=false; }
    } else if(b.id==='logout') {
      await api('admin/logout',{});
      location.reload();
    }
  };
}
async function ownerPage() {
  try {
    const data=await api('admin');
    editable=data.content;
    coachAccounts=data.coachAccounts;
    dashboard(data.orders);
  } catch(error) {
    if(error.status!==401) throw error;
    main.innerHTML=head('Owner sign-in')+'<section class="section shell"><form class="panel" id="login"><label>Owner password<input type="password" name="password" autocomplete="current-password" required></label><button>Sign in</button><p class="error" role="alert"></p></form></section>';
    document.querySelector('#login').onsubmit=async event=>{
      event.preventDefault();
      const login=event.currentTarget;
      try {await api('login',Object.fromEntries(new FormData(login)));await ownerPage();}
      catch(e){login.querySelector('.error').textContent=e.message;}
    };
  }
}
const monthLabel=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const easternDate=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'numeric',timeZone:'America/New_York'});
function currentMonth() {
  const parts=Object.fromEntries(easternDate.formatToParts(new Date()).map(({type,value})=>[type,value]));
  return new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,1));
}
function coachCalendar(schedule, month) {
  const year=month.getUTCFullYear(), number=month.getUTCMonth();
  const monthId=month.toISOString().slice(0,7);
  const days=new Date(Date.UTC(year,number+1,0)).getUTCDate();
  const bookings=[...schedule.bookings].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const slotList=schedule.availability.filter(slot=>slot.date.startsWith(monthId)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const cells=Array.from({length:days},(_,index)=>{
    const day=index+1;
    const dayId=monthId+'-'+String(day).padStart(2,'0');
    const entries=bookings.filter(booking=>booking.date<=dayId && (booking.endDate || booking.date)>=dayId);
    return '<li class="calendar-day '+(entries.length?'has-booking':'')+'"><time datetime="'+dayId+'">'+day+'</time>'+
      (entries.length?'<ul>'+entries.map(item=>'<li><strong>'+esc(item.title)+'</strong><span>'+esc(item.player)+' · '+time(item.time)+' EST</span><span>'+esc(item.location)+'</span></li>').join('')+'</ul>':'')+'</li>';
  });
  const blanks=Array.from({length:month.getUTCDay()},()=>'<li class="calendar-blank" aria-hidden="true"></li>').join('');
  main.innerHTML=head('Coach Dashboard',schedule.name)+'<section class="section shell admin-grid">'+
    '<div class="panel"><div class="calendar-controls"><div><h2>Booking calendar</h2><p class="calendar-month" id="calendar-month" aria-live="polite">'+monthLabel.format(month)+'</p></div>'+
    '<div class="row"><button class="secondary" data-month="-1">Previous month</button><button class="secondary" data-month="1">Next month</button><button class="secondary" id="coach-logout">Sign out</button></div></div>'+
    '<div class="calendar-weekdays" aria-hidden="true">'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>'<span>'+day+'</span>').join('')+'</div>'+
    '<ol class="coach-calendar" aria-labelledby="calendar-month">'+blanks+cells.join('')+'</ol>'+
    (cells.some(cell=>cell.includes('has-booking'))?'':'<p>No confirmed bookings this month.</p>')+'</div>'+
    '<div class="panel"><h2>Assigned availability</h2>'+
    (slotList.length?'<ul class="booking-list">'+slotList.map(slot=>'<li class="booking-record"><div><strong>'+date(slot.date)+'</strong></div><div>'+time(slot.time)+' EST · '+slot.duration+' min<br>'+esc(slot.location)+'</div><div><strong>'+slot.status+'</strong></div></li>').join('')+'</ul>':'<p>No lesson availability assigned this month.</p>')+'</div></section>';
  main.querySelectorAll('[data-month]').forEach(button=>{
    button.onclick=async()=>{
      const direction=button.dataset.month;
      button.disabled=true;
      try {
        coachCalendar(await api('coach'),new Date(Date.UTC(year,number+Number(direction),1)));
        main.querySelector('[data-month="'+direction+'"]').focus();
      } catch(error) {
        if(error.status===401) return coachPage();
        button.disabled=false;
        document.querySelector('#calendar-month').textContent=error.message;
      }
    };
  });
  document.querySelector('#coach-logout').onclick=async()=>{
    await api('coach/logout',{});
    location.reload();
  };
}
async function coachPage() {
  try {
    coachCalendar(await api('coach'),currentMonth());
  } catch(error) {
    if(error.status!==401) throw error;
    main.innerHTML=head('Coach sign-in')+'<section class="section shell"><form class="panel" id="coach-login">'+
      '<label>Username<input name="username" required autocomplete="username"></label>'+
      '<label>Password<input name="password" type="password" required autocomplete="current-password"></label>'+
      '<button>Sign in</button><p class="error" role="alert"></p></form></section>';
    document.querySelector('#coach-login').onsubmit=async event=>{
      event.preventDefault();
      const login=event.currentTarget;
      const button=login.querySelector('button');
      button.disabled=true;
      try { await api('coach/login',Object.fromEntries(new FormData(login))); await coachPage(); }
      catch(error) { login.querySelector('.error').textContent=error.message; button.disabled=false; }
    };
  }
}
async function start() {
  catalog=await api('catalog');
  document.querySelector('#header-title').textContent=catalog.home.headerTitle || 'Summer Tennis';
  if(/^https?:\/\//i.test(catalog.home.favicon || '')) {
    const icon=document.createElement('link');
    icon.rel='icon';
    icon.href=catalog.home.favicon;
    document.head.append(icon);
  }
  const logo=url(catalog.home.logo);
  if(logo) document.querySelector('.mark').outerHTML='<img class="logo" src="'+logo+'" alt="">';
  const query=new URLSearchParams(location.search);
  for(const mode of ['demo','order','cancel']) if(query.has(mode)) return payment(query.get(mode),mode);
  if(location.pathname==='/camps') return programs('camp');
  if(location.pathname==='/events') return programs('event');
  if(location.pathname==='/lessons') return lessons();
  if(location.pathname==='/owner') return ownerPage();
  if(location.pathname==='/coach') return coachPage();
  home();
}
start().catch(error=>{main.innerHTML='<section class="section shell"><p class="error">'+esc(error.message)+'</p><a href="/">Return home</a></section>';});
