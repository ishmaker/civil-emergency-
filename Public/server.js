'use strict';

const cluster = require('cluster');
const os      = require('os');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const PORT      = 3000;
const NUM_CPUS  = os.cpus().length;
const DATA_FILE = path.join(__dirname, 'alerts_data.json');
const HTML_FILE = path.join(__dirname, 'public', 'index.html');


if (cluster.isMaster) {
  const nets  = os.networkInterfaces();
  const addrs = [];
  for (const iface of Object.keys(nets))
    for (const net of nets[iface])
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);

  const W = 62;
  const box = s => `║  ${(s||'').padEnd(W-4)}║`;
  console.log('\n╔' + '═'.repeat(W-2) + '╗');
  console.log(box('CIVIL EMERGENCY CONNECT  v5.0  — Syntax Squad'));
  console.log('╠' + '═'.repeat(W-2) + '╣');
  console.log(box(`CPU cores: ${NUM_CPUS}  →  ${NUM_CPUS} worker processes`));
  console.log(box(`Local:   http://localhost:${PORT}`));
  addrs.forEach(ip => console.log(box(`Network: http://${ip}:${PORT}  ← share on LAN / Hotspot`)));
  console.log('╠' + '═'.repeat(W-2) + '╣');
  console.log(box('HOW TO USE:'));
  console.log(box('1. One device runs: node server.js'));
  console.log(box('2. That device creates a WiFi Hotspot (or use LAN)'));
  console.log(box('3. Others connect to hotspot & open the Network URL'));
  console.log(box('4. No internet required — fully offline capable!'));
  console.log('╠' + '═'.repeat(W-2) + '╣');
  console.log(box('Endpoints:'));
  console.log(box('  GET  /api/alerts       — fetch all alerts'));
  console.log(box('  POST /api/alerts       — submit new alert'));
  console.log(box('  POST /api/vouch/:id    — vouch for an alert'));
  console.log(box('  GET  /api/status       — server health'));
  console.log(box('  GET  /admin/export     — CSV download'));
  console.log(box('  GET  /admin/json       — JSON download'));
  console.log(box('  DEL  /api/alerts       — wipe all (admin)'));
  console.log('╚' + '═'.repeat(W-2) + '╝\n');

  for (let i = 0; i < NUM_CPUS; i++) cluster.fork();
  cluster.on('exit', (w, code, sig) => {
    console.log(`[MASTER] Worker ${w.process.pid} died (${sig||code}) — respawning…`);
    cluster.fork();
  });
  cluster.on('online', w => console.log(`[MASTER] ✓ Worker ${w.process.pid} online`));
  return;
}


let alerts = [
  { id:1, type:'NEED_HELP', lat:30.3535, lng:76.3595, user:'Rahul M.',  message:'Trapped in hostel block C, ceiling collapsed', location:'Boys Hostel Block-C, Room 204',  time:Date.now()-120000, trust:'verified',   trustScore:87, category:'TRAPPED',    firstAid:'Stay calm, do not move debris alone. Signal with torch.', proxy:false, vouches:2, hasPhoto:true,  ambushFlag:false },
  { id:2, type:'NEED_HELP', lat:30.3510, lng:76.3620, user:'Priya S.',  message:'Bleeding from leg, need medical help urgently', location:'Main Academic Block, 3rd Floor', time:Date.now()-300000, trust:'verified',   trustScore:94, category:'MEDICAL',    firstAid:'Apply firm pressure to wound with cloth. Elevate leg. Stay still.', proxy:false, vouches:3, hasPhoto:true,  ambushFlag:false },
  { id:3, type:'NEED_HELP', lat:30.3528, lng:76.3642, user:'Arjun K.',  message:'Stuck under debris near east wing library',    location:'Central Library, East Wing',     time:Date.now()-480000, trust:'unverified', trustScore:28, category:'TRAPPED',    firstAid:'Stay calm and shout for help. Tap on pipe to signal.', proxy:false, vouches:0, hasPhoto:false, ambushFlag:false },
  { id:4, type:'SAFE',      lat:30.3545, lng:76.3580, user:'Ananya R.', message:'Reached main gate safely, awaiting transport', location:'Main Gate, Thapar University',   time:Date.now()-180000, trust:'verified',   trustScore:79, category:'SAFE',       firstAid:null, proxy:false, vouches:1, hasPhoto:false, ambushFlag:false },
  { id:5, type:'SAFE',      lat:30.3500, lng:76.3590, user:'Dev P.',    message:'Evacuated to sports ground with 8 others',    location:'Sports Ground, South Campus',    time:Date.now()-360000, trust:'verified',   trustScore:91, category:'SAFE',       firstAid:null, proxy:false, vouches:2, hasPhoto:true,  ambushFlag:false },
  { id:6, type:'SAFE',      lat:30.3538, lng:76.3625, user:'Simran T.', message:'At assembly point, 12 people here',           location:'Assembly Point, Admin Block',    time:Date.now()-660000, trust:'unverified', trustScore:30, category:'SAFE',       firstAid:null, proxy:true,  vouches:0, hasPhoto:false, ambushFlag:false },
];
let nextId           = 7;
let connectedDevices = 1;
const deviceSessions = new Map(); // track connected IPs


function loadFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const { alerts: saved, nextId: nid } = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (saved?.length) {
      alerts = saved;
      nextId = nid || Math.max(...saved.map(a => a.id)) + 1;
      console.log(`[W:${process.pid}] Reloaded ${alerts.length} alerts from disk`);
    }
  } catch(e) { console.log(`[W:${process.pid}] Fresh start`); }
}

function saveToDisk() {
  try {
    if (!fs.existsSync(path.dirname(DATA_FILE)))
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ alerts, nextId }, null, 2));
  } catch(e) { console.error(`[W:${process.pid}] DISK ERROR:`, e.message); }
}

loadFromDisk();


function haversine(lat1, lon1, lat2, lon2) {
  const R=6371000, φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
  const Δφ=(lat2-lat1)*Math.PI/180, Δλ=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function checkAmbush(lat, lng) {
  const cutoff = Date.now()-15000;
  const nearby = alerts.filter(a => a.time>=cutoff && haversine(lat,lng,a.lat,a.lng)<=50);
  if (nearby.length >= 3) {
    console.log(`[SECURITY ⚠] AMBUSH: ${nearby.length+1} reports in 15s within 50m`);
    return true;
  }
  return false;
}

const BOT_UA = [/bot/i,/crawl/i,/spider/i,/python-requests/i,/curl/i,/wget/i,/go-http/i,/postman/i];
const recentFPs = new Map();

function detectBot(ua='', battery) {
  if (!ua || ua.length<10) return { bot:true, reason:'Missing UA' };
  for (const p of BOT_UA) if (p.test(ua)) return { bot:true, reason:`UA: ${p}` };
  if (battery===1.0) return { bot:true, reason:'Perfect 100% battery (synthetic)' };
  return { bot:false };
}

function checkFPCluster(ua, battery, lat, lng) {
  const fp = `${ua.slice(0,40)}|${battery}`;
  const now = Date.now();
  const arr = (recentFPs.get(fp)||[]).filter(x=>now-x.t<60000);
  arr.push({t:now,lat,lng});
  recentFPs.set(fp, arr);
  if (arr.length >= 6) { console.log(`[SECURITY ⚠] BOT CLUSTER: ${fp.slice(0,30)} × ${arr.length} in 60s`); return true; }
  return false;
}

const ipRateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const arr = (ipRateMap.get(ip)||[]).filter(t=>now-t<60000);
  arr.push(now);
  ipRateMap.set(ip, arr);
  return arr.length > 15; // max 15 POSTs per IP per minute
}


function calcTrust({ vouches=0, hasPhoto=false, gpsAccuracy=null, wifiRssi=null, proxy=false }) {
  let s = 0;
  s += Math.min(vouches*15, 30);          
  if (hasPhoto)                  s += 30; 
  if (gpsAccuracy<=30)           s += 10;
  else if (gpsAccuracy<=100)     s +=  5;
  if (wifiRssi>-60)              s += 30; 
  else if (wifiRssi>-75)         s += 15;
  if (proxy) s = Math.max(s-10, 0);
  return Math.min(Math.round(s), 100);
}

function trustLevel(score) {
  const threshold = connectedDevices < 5 ? 35 : 60; 
  return score >= threshold ? 'verified' : 'unverified';
}


const TRIAGE_DB = [
  { cat:'MEDICAL',    kw:['injur','bleed','blood','broken','unconscious','heart','breath','medic','hospital','hurt','pain','wound','doctor','sick','seiz','faint','fractur','burn skin'], aid:'Apply direct pressure to wounds with clean cloth. Keep victim still. Do not remove embedded objects. Elevate injured limb if possible. Get trained medic immediately.' },
  { cat:'FIRE',       kw:['fire','burn','smoke','flame','blaze','gas leak','explosion','inferno'],                    aid:'Crawl low under smoke — clean air near floor. Close doors to slow spread. Move upwind. Do NOT use lifts. If on fire: STOP, DROP, ROLL.' },
  { cat:'TRAPPED',    kw:['trap','stuck','debris','rubble','buried','collapse','cant move','cant get out','locked','crush','pinned'], aid:'Stay calm — movement may shift debris. Tap on pipes/metal rhythmically to signal rescuers. Conserve phone battery. Cover mouth/nose from dust.' },
  { cat:'FLOOD',      kw:['flood','water','drown','submerge','rising water','swept','current','surge'],               aid:'Move to highest ground immediately. Never walk through fast-moving water. Signal from roof. Do not re-enter floodwater — may be electrified.' },
  { cat:'MISSING',    kw:['missing','lost','cant find','whereabouts','disappeared','gone','separated'],              aid:'Stay at last known location if safe. Use whistle, torch flash, or bang metal to signal. Do not wander alone at night.' },
  { cat:'FOOD_WATER', kw:['food','water','thirst','hungry','starv','supply','ration','dehydrat','no water'],         aid:'Ration water — minimum 0.5L/day. Avoid exertion. Do not drink floodwater. Signal for supply drop.' },
  { cat:'SAFE',       kw:['safe','okay','fine','reached','evacuate','secure','assembly','alright','shelter'],        aid:null },
];

function triageAlert(message) {
  const l = (message||'').toLowerCase();
  for (const r of TRIAGE_DB) if (r.kw.some(k=>l.includes(k))) return { category:r.cat, firstAid:r.aid };
  return { category:'GENERAL', firstAid:'Stay visible and conserve phone battery. Signal with torch or whistle every 2 minutes.' };
}


function toCSV(rows) {
  const COLS = ['id','type','category','trust','trustScore','vouches','user','message','location','lat','lng','proxy','reportedBy','hasPhoto','ambushFlag','time'];
  const esc  = v => `"${String(v??'').replace(/"/g,'""')}"`;
  return [COLS.join(','), ...rows.map(r=>COLS.map(c=>esc(c==='time'?new Date(r[c]).toISOString():r[c])).join(','))].join('\r\n');
}


function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Access-Control-Allow-Origin':'*'});
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks=[];
    let size=0;
    req.on('data', c => { size+=c.length; if(size>2e6){reject(new Error('TOO_LARGE'));return;} chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString()||'{}')); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

function getIP(req) {
  return (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
}


function router(req, res) {
  const url    = (req.url||'/').split('?')[0];
  const method = req.method.toUpperCase();
  const ua     = req.headers['user-agent']||'';
  const ip     = getIP(req);

 
  deviceSessions.set(ip, Date.now());

  for (const [k,v] of deviceSessions) if (Date.now()-v>300000) deviceSessions.delete(k);
  connectedDevices = deviceSessions.size || 1;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method==='OPTIONS') { res.writeHead(204); res.end(); return; }

 
  if (url==='/api/alerts' && method==='GET') {
    sendJSON(res, 200, {
      alerts: [...alerts].sort((a,b)=>b.time-a.time),
      meta: {
        workerId:         process.pid,
        ruralMode:        connectedDevices < 5,
        connectedDevices,
        verifiedCount:    alerts.filter(a=>a.trust==='verified').length,
        ambushActiveFlag: alerts.some(a=>a.ambushFlag && Date.now()-a.time<120000),
        serverTime:       Date.now(),
      }
    });
    return;
  }

 
  if (url==='/api/alerts' && method==='POST') {
    parseBody(req).then(body => {
      if (!body.type || !body.message) {
        sendJSON(res, 400, { error:'Required fields: type, message' }); return;
      }


      const botCheck = detectBot(ua, body.batteryLevel??null);
      const isLocal =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.');

    if (!isLocal) {
    const botCheck = detectBot(ua, body.batteryLevel ?? null);

    if (botCheck.bot) {
    console.log(`[SEC] BOT BLOCKED [${ip}]: ${botCheck.reason}`);
    sendJSON(res, 403, {
      error: 'Request flagged as synthetic',
      reason: botCheck.reason
    });
    return;
  }
}

     
      if (rateLimit(ip)) {
        sendJSON(res, 429, { error:'Too many requests. Slow down.' }); return;
      }

      const lat = parseFloat(body.lat)||30.3522;
      const lng = parseFloat(body.lng)||76.3608;

      if (checkFPCluster(ua, body.batteryLevel, lat, lng)) {
        sendJSON(res, 403, { error:'Bot cluster signature detected' }); return;
      }

      const ambushFlag = checkAmbush(lat, lng);

    
      const photoData = body.photoData
        ? (Buffer.byteLength(body.photoData,'base64') > 614400 ? null : body.photoData)
        : null;

      const hasPhoto = !!photoData;

      const trustScore = calcTrust({
        vouches:     parseInt(body.vouches)||0,
        hasPhoto,
        gpsAccuracy: body.gpsAccuracy!=null ? parseFloat(body.gpsAccuracy) : null,
        wifiRssi:    body.wifiRssi!=null    ? parseFloat(body.wifiRssi)    : null,
        proxy:       !!body.proxy,
      });

      const { category, firstAid } = triageAlert(body.message);

      const alert = {
        id:         nextId++,
        type:       ['NEED_HELP','SAFE'].includes(body.type)?body.type:'NEED_HELP',
        lat, lng,
        user:       String(body.user||'Anonymous').slice(0,50),
        message:    String(body.message).slice(0,300),
        location:   String(body.location||'Thapar Institute Campus').slice(0,120),
        time:       Date.now(),
        trust:      trustLevel(trustScore),
        trustScore,
        category,
        firstAid,
        proxy:      !!body.proxy,
        reportedBy: body.proxy ? String(body.reportedBy||'').slice(0,60) : null,
        vouches:    0,
        hasPhoto,
        photoData,
        ambushFlag,
        submittedBy: ip,
        deviceId:   String(body.deviceId||'').slice(0,36),
      };

      alerts.push(alert);
      saveToDisk();

      console.log(`[W:${process.pid}] ${alert.type} | ${alert.user} | ${category} | score:${trustScore}(${alert.trust}) | photo:${hasPhoto} ${ambushFlag?'⚠AMBUSH':''} | IP:${ip}`);

      const { photoData:_pd, submittedBy:_sb, ...safeAlert } = alert;
      sendJSON(res, 201, { ...safeAlert, hasPhoto });

    }).catch(e => {
      if (e.message==='TOO_LARGE') sendJSON(res,413,{error:'Request body too large'});
      else sendJSON(res,400,{error:'Malformed JSON body'});
    });
    return;
  }

  
  if (/^\/api\/alert\/\d+\/photo$/.test(url) && method==='GET') {
    const id    = parseInt(url.split('/')[3]);
    const alert = alerts.find(a=>a.id===id);
    if (!alert?.photoData) { sendJSON(res,404,{error:'No photo for this alert'}); return; }
    sendJSON(res, 200, { id, photoData:alert.photoData });
    return;
  }

  
  if (/^\/api\/vouch\/\d+$/.test(url) && method==='POST') {
    const id = parseInt(url.split('/')[3]);
    const a  = alerts.find(x=>x.id===id);
    if (!a) { sendJSON(res,404,{error:'Alert not found'}); return; }
    a.vouches    = (a.vouches||0)+1;
    a.trustScore = calcTrust({vouches:a.vouches,hasPhoto:a.hasPhoto,gpsAccuracy:a.gpsAccuracy});
    a.trust      = trustLevel(a.trustScore);
    saveToDisk();
    sendJSON(res, 200, { id, vouches:a.vouches, trustScore:a.trustScore, trust:a.trust });
    return;
  }

  
  if (url==='/api/status' && method==='GET') {
    sendJSON(res, 200, {
      worker:           process.pid,
      uptime:           Math.round(process.uptime()),
      totalAlerts:      alerts.length,
      verified:         alerts.filter(a=>a.trust==='verified').length,
      withPhoto:        alerts.filter(a=>a.hasPhoto).length,
      needHelp:         alerts.filter(a=>a.type==='NEED_HELP').length,
      safe:             alerts.filter(a=>a.type==='SAFE').length,
      ambushActive:     alerts.some(a=>a.ambushFlag),
      connectedDevices,
      ruralMode:        connectedDevices<5,
      memMB:            Math.round(process.memoryUsage().rss/1024/1024),
      dataFile:         DATA_FILE,
    });
    return;
  }

  
  if (url==='/admin/export' && method==='GET') {
    const csv = toCSV(alerts.map(({photoData:_p,...r})=>r));
    res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':`attachment; filename="cec_alerts_${Date.now()}.csv"`});
    res.end(csv); return;
  }

  
  if (url==='/admin/json' && method==='GET') {
    const clean = alerts.map(({photoData:_p,submittedBy:_s,...r})=>r);
    res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="cec_alerts_${Date.now()}.json"`});
    res.end(JSON.stringify(clean,null,2)); return;
  }

  
  if (url==='/api/alerts' && method==='DELETE') {
    alerts=[]; nextId=1; saveToDisk();
    sendJSON(res,200,{ok:true,message:'All alerts cleared'});
    return;
  }

  
  const MIME = {'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.ico':'image/x-icon','.png':'image/png'};
  let fp = path.join(__dirname, 'public', url==='/'?'index.html':url.slice(1));
  if (!path.extname(fp)) fp += '.html';
  fp = path.normalize(fp); 

  fs.readFile(fp, (err, data) => {
    if (err) {
      
      fs.readFile(HTML_FILE, (e2,d2) => {
        if (e2) { res.writeHead(404); res.end('404 Not Found'); return; }
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
        res.end(d2);
      });
      return;
    }
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'});
    res.end(data);
  });
}


fs.mkdirSync(path.join(__dirname, 'public'), { recursive:true });

http.createServer(router).listen(PORT, '0.0.0.0', () => {
  console.log(`[Worker ${process.pid}] HTTP ready on port ${PORT}`);
});

process.on('SIGTERM', () => { saveToDisk(); process.exit(0); });
process.on('SIGINT',  () => { saveToDisk(); process.exit(0); });