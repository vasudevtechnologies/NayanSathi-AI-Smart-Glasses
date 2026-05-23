const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const path = require('path');
const dns = require('dns');
const { promisify } = require('util');
const dnsLookup = promisify(dns.lookup);
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/scripts', express.static(path.join(__dirname, 'pi_scripts')));
app.use('/ort-wasm', express.static(path.join(__dirname, 'public', 'ort-wasm')));

// ─── Camera MJPEG Proxy (avoids cross-origin / blocked network issues) ─────
const http2 = require('http');
app.get('/api/camera-stream', (req, res) => {
    const camUrl = req.query.url || 'http://192.168.137.36:81/stream';
    let parsed;
    try { parsed = new URL(camUrl); } catch {
        return res.status(400).send('Invalid camera URL');
    }
    const options = {
        hostname: parsed.hostname,
        port: parseInt(parsed.port) || 80,
        path: parsed.pathname + (parsed.search || ''),
        // NO timeout — MJPEG streams are infinite
    };
    const camReq = http2.get(options, camRes => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Content-Type', camRes.headers['content-type'] || 'multipart/x-mixed-replace');
        camRes.pipe(res);
        req.on('close', () => camReq.destroy());
    });
    camReq.on('error', err => {
        if (!res.headersSent) res.status(503).json({ error: 'Camera unreachable: ' + err.message });
    });
});


// ─── Ping Pi (TCP check) ─────────────────────────────────────────────────────

const net = require('net');
app.get('/api/ping-pi', (req, res) => {
    const host = req.query.host || '192.168.137.40';
    const port = parseInt(req.query.port) || 22;
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(3000);
    socket.connect(port, host, () => {
        done = true;
        socket.destroy();
        res.json({ reachable: true, host, port });
    });
    socket.on('error', err => {
        if (!done) { done = true; res.json({ reachable: false, reason: err.message }); }
    });
    socket.on('timeout', () => {
        if (!done) { done = true; socket.destroy(); res.json({ reachable: false, reason: 'timeout' }); }
    });
});

// Store active SSH sessions
const sessions = new Map();

// ─── Camera Registry (ESP32-CAM announces itself here) ─────────────────────
let camInfo = null; // {ip, stream, snap, mac, status, lastSeen}

// Broadcast to ALL dashboard WebSocket clients
function broadcastToAll(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

// ESP32-CAM POSTs here when it boots or changes IP
app.post('/api/cam-register', (req, res) => {
    const { ip, stream, snap, mac, status } = req.body;
    if (!ip) return res.status(400).json({ error: 'Missing ip' });

    const prev = camInfo;
    camInfo = { ip, stream, snap, mac, status: status || 'online', lastSeen: new Date().toISOString() };

    const ipChanged = !prev || prev.ip !== ip;
    console.log(`[CAM] ${ipChanged ? '🆕 NEW' : '✅ PING'} ESP32-CAM @ ${ip} (mac: ${mac})`);

    // Broadcast to all dashboard clients
    broadcastToAll({
        type: 'cam-online',
        ip, stream, snap, mac,
        ipChanged,
        lastSeen: camInfo.lastSeen
    });

    res.json({ success: true, message: 'Registered', ip });
});


// Dashboard polls this on load to get last known camera IP
app.get('/api/cam-status', (req, res) => {
    if (!camInfo) return res.json({ online: false });
    const ageMs = Date.now() - new Date(camInfo.lastSeen).getTime();
    const online = ageMs < 120000; // 120s — ESP32 only registers at boot
    res.json({ online, ...camInfo, ageMs });
});

// Active probe: TCP-check if ESP32 is reachable right now
app.get('/api/cam-probe', (req, res) => {
    const ip = (req.query.ip || (camInfo && camInfo.ip) || '192.168.137.36');
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(2000);
    socket.connect(81, ip, () => {
        done = true; socket.destroy();
        // Refresh lastSeen and broadcast
        if (!camInfo) camInfo = {};
        Object.assign(camInfo, { ip, stream: `http://${ip}:81/stream`, snap: `http://${ip}/snap`, status: 'online', lastSeen: new Date().toISOString() });
        broadcastToAll({ type: 'cam-online', ip, stream: camInfo.stream, snap: camInfo.snap, ipChanged: false, probed: true });
        res.json({ online: true, ip });
    });
    socket.on('error', () => { if (!done) { done = true; res.json({ online: false, ip }); } });
    socket.on('timeout', () => { if (!done) { done = true; socket.destroy(); res.json({ online: false, ip }); } });
});

// ── Auto-probe every 15s to detect ESP32 coming online ────────
setInterval(() => {
    const ip = camInfo ? camInfo.ip : '192.168.137.36';
    const ageMs = camInfo ? Date.now() - new Date(camInfo.lastSeen).getTime() : 999999;
    if (ageMs < 30000) return; // already fresh, skip
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(2000);
    socket.connect(81, ip, () => {
        done = true; socket.destroy();
        if (!camInfo) camInfo = {};
        const wasOffline = !camInfo.lastSeen || (Date.now() - new Date(camInfo.lastSeen).getTime()) > 30000;
        Object.assign(camInfo, { ip, stream: `http://${ip}:81/stream`, snap: `http://${ip}/snap`, status: 'online', lastSeen: new Date().toISOString() });
        if (wasOffline) {
            console.log(`[CAM] 🔍 Auto-probe: ESP32 @ ${ip} is ONLINE`);
            broadcastToAll({ type: 'cam-online', ip, stream: camInfo.stream, snap: camInfo.snap, ipChanged: false, probed: true });
        }
    });
    socket.on('error', () => { if (!done) { done = true; } });
    socket.on('timeout', () => { if (!done) { done = true; socket.destroy(); } });
}, 15000);


// ─── Bluetooth: Connect Airdopes 141 ───────────────────────────────────────
const BT_MAC = '8E:79:7D:B3:CD:A6';            // Airdopes 141 MAC
const BT_SINK = 'bluez_output.8E_79_7D_B3_CD_A6.1'; // Actual pactl sink name
const BT_SINK_ID = BT_MAC.replace(/:/g, '_');       // kept for compat

app.post('/api/bluetooth/connect-airdopes', (req, res) => {
    const host = '192.168.137.40', user = 'pi', pass = 'raspberry';
    const conn = new Client();
    conn.on('ready', () => {
        // Step 1: power on + connect + wait for A2DP negotiation
        const cmd = [
            'bluetoothctl power on',
            'sleep 1',
            `bluetoothctl connect ${BT_MAC} 2>&1`,
            'sleep 4',  // wait for A2DP profile to negotiate
            // Step 2: force A2DP profile on the card
            `pactl set-card-profile bluez_card.${BT_SINK_ID} a2dp-sink 2>/dev/null || true`,
            'sleep 1',
            // Step 3: find the actual sink name dynamically (bluez_output.MAC.1 or .2 etc)
            `BT_SINK_NOW=$(pactl list short sinks | grep bluez_output | awk '{print $2}' | head -1)`,
            // Step 4: route audio to BT sink
            `[ -n "$BT_SINK_NOW" ] && pactl set-default-sink "$BT_SINK_NOW" && pactl set-sink-volume "$BT_SINK_NOW" 100% && pactl suspend-sink "$BT_SINK_NOW" 0 && echo "SINK_OK:$BT_SINK_NOW" || echo "SINK_MISSING"`,
            // Step 5: connection status
            `bluetoothctl info ${BT_MAC} 2>/dev/null | grep -E "Connected|Paired"`
        ].join(' && ');

        conn.exec(cmd, (err, stream) => {
            let out = '';
            if (err) { conn.end(); return res.json({ success: false, message: err.message }); }
            stream.on('data', d => { out += d.toString(); });
            stream.stderr.on('data', d => { out += d.toString(); });
            stream.on('close', () => {
                conn.end();
                const btOk = out.includes('Connection successful') ||
                             out.includes('already connected') ||
                             out.includes('Connected: yes');
                const sinkOk = out.includes('SINK_OK');
                const sinkName = (out.match(/SINK_OK:([\w._]+)/) || [])[1] || BT_SINK;
                const ok = btOk;
                console.log(`[BT] Connect: ${btOk ? '✅' : '❌'} | Sink: ${sinkOk ? sinkName : 'NOT FOUND'}`);
                res.json({
                    success: ok,
                    message: ok
                        ? `Airdopes 141 connected ✓ ${sinkOk ? '| Audio routed → ' + sinkName : '| (audio sink not yet ready — retry in 5s)'}`
                        : 'Connect failed — make sure Airdopes 141 is in pairing mode (hold button 5s)',
                    sink: sinkOk ? sinkName : null,
                    log: out.slice(0, 400)
                });
            });
        });
    }).on('error', e => res.json({ success: false, message: 'Pi SSH failed: ' + e.message }))
        .connect({ host, port: 22, username: user, password: pass, readyTimeout: 8000 });
});

// ─── Bluetooth: Voice Test → proxies to Pi voice server (:3001) ───────────
const BT_CARD = `bluez_card.${BT_SINK_ID}`;
const PI_VOICE_URL = 'http://192.168.137.40:3001';

app.post('/api/bluetooth/voice-test', async (req, res) => {
    const rawText = (req.body && req.body.text) ? String(req.body.text) : 'NayanSathi is online';
    const text = rawText.replace(/[^a-zA-Z0-9 .,!?\- ]/g, '').slice(0, 200);
    try {
        const http = require('http');
        const url = `${PI_VOICE_URL}/?text=${encodeURIComponent(text)}`;
        const piRes = await new Promise((resolve, reject) => {
            const req2 = http.get(url, { timeout: 30000 }, (r) => {
                let d = '';
                r.on('data', c => d += c);
                r.on('end', () => {
                    try { resolve(JSON.parse(d)); }
                    catch { resolve({ success: r.statusCode === 200, raw: d }); }
                });
            });
            req2.on('error', reject);
            req2.on('timeout', () => { req2.destroy(); reject(new Error('Pi voice server timeout')); });
        });
        console.log(`[TTS] "${text}" → ${piRes.success ? '✅' : '❌'}`);
        res.json({ success: piRes.success, message: piRes.success ? `🔊 "${text}"` : (piRes.error || 'TTS failed'), engine: piRes.engine || 'Piper Female' });
    } catch (e) {
        console.error(`[TTS] Pi voice server error: ${e.message}`);
        res.json({ success: false, message: 'Pi voice server unreachable — is it running? ' + e.message });
    }
});






// ─── REST: Test SSH Connection ─────────────────────────────────────────────
app.post('/api/connect-test', (req, res) => {
    const { host, port, username, password } = req.body;
    const conn = new Client();
    conn.on('ready', () => {
        conn.end();
        res.json({ success: true, message: 'Connection successful!' });
    }).on('error', (err) => {
        res.json({ success: false, message: err.message });
    }).connect({ host, port: port || 22, username, password, readyTimeout: 5000 });
});

// ─── REST: Run single SSH command on Pi ───────────────────────────────────
app.post('/api/pi-cmd', async (req, res) => {
    const { host, username, password, cmd } = req.body;
    if (!cmd) return res.status(400).json({ error: 'Missing cmd' });
    let resolvedHost = host;
    try { resolvedHost = (await dnsLookup(host)).address; } catch { }
    const conn = new Client();
    let out = '', err_ = '';
    conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
            if (err) { conn.end(); return res.json({ success: false, message: err.message }); }
            stream.on('data', d => { out += d.toString(); });
            stream.stderr.on('data', d => { err_ += d.toString(); });
            stream.on('close', (code) => {
                conn.end();
                res.json({ success: code === 0, output: out, stderr: err_, code });
            });
        });
    }).on('error', e => res.json({ success: false, message: e.message }))
        .connect({ host: resolvedHost, port: 22, username, password, readyTimeout: 8000 });
});

// ─── REST: Deploy scripts to Pi via SFTP ──────────────────────────────────
const fs = require('fs');
const SCRIPTS_DIR = path.join(__dirname, 'pi_scripts');

app.post('/api/deploy', async (req, res) => {
    const { host, username, password } = req.body;
    // All deployable files
    const ALL_FILES = ['nayansathi.py', 'setup.sh', 'yolo11n.onnx', 'yolo_server.py', 'install_yolo.sh'];
    const files = ALL_FILES.filter(f => fs.existsSync(path.join(SCRIPTS_DIR, f)));
    if (!files.length) return res.json({ success: false, message: 'No script files found in pi_scripts/' });

    // Resolve hostname
    let resolvedHost = host;
    try { resolvedHost = (await dnsLookup(host)).address; } catch { }


    const conn = new Client();
    conn.on('ready', () => {
        // Step 1: mkdir ~/NayanSathi
        conn.exec('mkdir -p ~/NayanSathi && echo OK', (err, stream) => {
            if (err) { conn.end(); return res.json({ success: false, message: err.message }); }
            stream.on('close', () => {
                // Step 2: SFTP files
                conn.sftp((err, sftp) => {
                    if (err) { conn.end(); return res.json({ success: false, message: err.message }); }
                    let done = 0;
                    const uploaded = [];
                    files.forEach(file => {
                        const local = path.join(SCRIPTS_DIR, file);
                        const remote = `/home/${username}/NayanSathi/${file}`;
                        sftp.fastPut(local, remote, (err) => {
                            if (err) console.error(`[SFTP] Failed ${file}:`, err.message);
                            else { uploaded.push(file); console.log(`[SFTP] ✓ ${file} → ${remote}`); }
                            done++;
                            if (done === files.length) {
                                // Step 3: chmod +x
                                conn.exec(`chmod +x ~/NayanSathi/setup.sh ~/NayanSathi/nayansathi.py && echo DONE`, (err2, s2) => {
                                    s2?.resume();
                                    s2?.on('close', () => conn.end());
                                });
                                res.json({ success: true, message: `Deployed: ${uploaded.join(', ')} → ~/NayanSathi/` });
                            }
                        });
                    });
                });
            });
            stream.resume();
        });
    }).on('error', (err) => {
        res.json({ success: false, message: `SSH Error: ${err.message}` });
    }).connect({ host: resolvedHost, port: 22, username, password, readyTimeout: 6000 });
});

// ─── WebSocket: Full PTY Terminal ──────────────────────────────────────────
wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    let sshClient = null;
    let stream = null;
    const sessionId = Date.now().toString();

    ws.on('message', async (rawData) => {
        let msg;
        try { msg = JSON.parse(rawData); } catch { return; }

        switch (msg.type) {
            // ── SSH Connect ──────────────────────────────────────────────
            case 'connect': {
                const { host, port, username, password } = msg;
                sshClient = new Client();

                // Resolve hostname via OS (handles .local mDNS on Windows)
                let resolvedHost = host;
                try {
                    const result = await dnsLookup(host);
                    resolvedHost = result.address;
                    console.log(`[SSH] Resolved ${host} → ${resolvedHost}`);
                    ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[36mResolved ${host} → ${resolvedHost}\x1b[0m\r\n` }));
                } catch (dnsErr) {
                    console.warn(`[SSH] DNS lookup failed for ${host}, using as-is: ${dnsErr.message}`);
                }

                sshClient.on('ready', () => {
                    ws.send(JSON.stringify({ type: 'status', status: 'connected', host }));

                    sshClient.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, sh) => {
                        if (err) {
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                            return;
                        }
                        stream = sh;

                        // Pi → Browser
                        stream.on('data', (data) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'output', data: data.toString('binary') }));
                            }
                        });

                        stream.stderr.on('data', (data) => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({ type: 'output', data: data.toString('binary') }));
                            }
                        });

                        stream.on('close', () => {
                            ws.send(JSON.stringify({ type: 'status', status: 'disconnected' }));
                            sshClient && sshClient.end();
                        });
                    });

                    sessions.set(sessionId, { sshClient, ws });
                });

                sshClient.on('error', (err) => {
                    ws.send(JSON.stringify({ type: 'error', message: `SSH Error: ${err.message}` }));
                });

                sshClient.on('end', () => {
                    ws.send(JSON.stringify({ type: 'status', status: 'disconnected' }));
                });

                sshClient.connect({
                    host: resolvedHost,
                    port: parseInt(port) || 22,
                    username,
                    password,
                    readyTimeout: 5000,
                    keepaliveInterval: 5000
                });
                break;
            }

            // ── Send Keystroke/Command to Pi ─────────────────────────────
            case 'input': {
                if (stream && stream.writable) {
                    stream.write(msg.data);
                }
                break;
            }

            // ── Resize Terminal ──────────────────────────────────────────
            case 'resize': {
                if (stream) {
                    stream.setWindow(msg.rows, msg.cols, 0, 0);
                }
                break;
            }

            // ── Disconnect ──────────────────────────────────────────────
            case 'disconnect': {
                if (stream) stream.end();
                if (sshClient) sshClient.end();
                ws.send(JSON.stringify({ type: 'status', status: 'disconnected' }));
                break;
            }

            // ── Pi YOLO WebSocket Proxy ──────────────────────────────────
            // Browser sends {type:'pi-yolo-proxy', action:'start'|'stop', piHost}
            // Server proxies ws://piHost:8765 back to browser
            case 'pi-yolo-proxy': {
                if (msg.action === 'start') {
                    const piHost = msg.piHost || '192.168.137.40';
                    const piWsUrl = `ws://${piHost}:8765`;
                    console.log(`[YOLO] Proxying ${piWsUrl} → browser`);

                    let retries = 0;
                    const MAX_RETRY = 5;   // retry up to 5x every 3s while Pi boots

                    function tryConnect() {
                        let piErrored = false;
                        const piWs = new WebSocket(piWsUrl);

                        piWs.on('open', () => {
                            retries = 0;
                            console.log('[YOLO] ✅ Connected to Pi YOLO');
                            ws._piYoloWs = piWs;
                            if (ws.readyState === WebSocket.OPEN)
                                ws.send(JSON.stringify({ type: 'pi-yolo-status', status: 'connected', piHost }));
                        });

                        let msgCount = 0;

                        // ── Smart Voice Feedback ─────────────────────────────
                        const lastSpoken = {};     // label → timestamp
                        const COOLDOWN = 6000;     // 6s per class
                        const PRIORITY = {        // higher = speak first
                            person: 10, people: 10, man: 10, woman: 10, child: 10,
                            car: 8, truck: 8, bus: 8, motorcycle: 7, bicycle: 7,
                            dog: 6, cat: 6, bottle: 3, cup: 3, phone: 5,
                        };
                        let voiceBusy = false;
                        let batchTimeout = null;
                        let pendingDets = {};      // label → conf (batch buffer)

                        // Natural phrases for objects
                        function phrase(labels) {
                            const map = {
                                person: 'person ahead', people: 'people ahead',
                                car: 'car nearby', truck: 'truck nearby',
                                bus: 'bus ahead', motorcycle: 'motorcycle',
                                bicycle: 'bicycle', dog: 'dog nearby',
                                cat: 'cat nearby', phone: 'phone detected',
                            };
                            const named = labels.map(l => map[l.toLowerCase()] || l);
                            if (named.length === 1) return named[0];
                            if (named.length === 2) return named[0] + ' and ' + named[1];
                            return named[0] + ', ' + named[1] + ' and more';
                        }

                        async function flushVoice() {
                            if (voiceBusy || Object.keys(pendingDets).length === 0) return;
                            const now = Date.now();

                            // Filter: only new detections (not recently spoken)
                            const newDets = Object.entries(pendingDets)
                                .filter(([lbl]) => !lastSpoken[lbl] || now - lastSpoken[lbl] > COOLDOWN)
                                .sort(([a], [b]) => (PRIORITY[b] || 1) - (PRIORITY[a] || 1))
                                .slice(0, 2);  // max 2 objects per announcement

                            pendingDets = {};
                            if (newDets.length === 0) return;

                            // Mark spoken
                            newDets.forEach(([lbl]) => lastSpoken[lbl] = now);
                            voiceBusy = true;

                            const text = phrase(newDets.map(([l]) => l));
                            try {
                                await new Promise((resolve) => {
                                    const reqHttp = require('http').get(
                                        `http://192.168.137.40:3001/?text=${encodeURIComponent(text)}`,
                                        { timeout: 25000 },
                                        (r) => { r.resume(); r.on('end', resolve); }
                                    );
                                    reqHttp.on('error', resolve);
                                    reqHttp.on('timeout', () => { reqHttp.destroy(); resolve(); });
                                });
                                console.log(`[VOICE] 🔊 "${text}"`);
                            } catch (e) {
                                console.log(`[VOICE] ❌ ${e.message}`);
                            } finally {
                                voiceBusy = false;
                            }
                        }
                        // ────────────────────────────────────────────────────

                        piWs.on('message', data => {

                            msgCount++;
                            if (msgCount === 1 || msgCount % 30 === 0) {
                                const preview = data.toString().substring(0, 120);
                                console.log(`[YOLO] msg#${msgCount}: ${preview}`);
                            }
                            // Forward to browser
                            if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());

                            // ── Batch detections then flush ───────────────────
                            try {
                                const m = JSON.parse(data.toString());
                                if (m.type === 'yolo-detections' && m.detections && m.detections.length > 0) {
                                    // Add high-confidence detections to batch
                                    m.detections
                                        .filter(d => d.conf >= 0.55)
                                        .forEach(d => {
                                            const key = d.label.toLowerCase();
                                            if (!pendingDets[key] || d.conf > pendingDets[key])
                                                pendingDets[key] = d.conf;
                                        });
                                    // Flush after 600ms silence (batch window)
                                    clearTimeout(batchTimeout);
                                    batchTimeout = setTimeout(flushVoice, 200);

                                }
                            } catch { /* non-JSON, skip */ }
                            // ─────────────────────────────────────────────────
                        });


                        piWs.on('error', err => {
                            piErrored = true;
                            console.log(`[YOLO] Pi WS error (attempt ${retries + 1}): ${err.message}`);
                            if (err.message.includes('ECONNREFUSED') && retries < MAX_RETRY) {
                                retries++;
                                if (ws.readyState === WebSocket.OPEN)
                                    ws.send(JSON.stringify({
                                        type: 'pi-yolo-status',
                                        status: 'retrying',
                                        message: `Pi YOLO starting… retry ${retries}/${MAX_RETRY}`
                                    }));
                                setTimeout(tryConnect, 3000);
                            } else {
                                if (ws.readyState === WebSocket.OPEN)
                                    ws.send(JSON.stringify({
                                        type: 'pi-yolo-status',
                                        status: 'error',
                                        message: err.message.includes('ECONNREFUSED')
                                            ? 'yolo_server.py not running on Pi — click Run again'
                                            : err.message
                                    }));
                            }
                        });

                        piWs.on('close', () => {
                            console.log('[YOLO] Pi WS closed');
                            // Only send 'disconnected' if no error (was previously connected)
                            if (!piErrored && ws.readyState === WebSocket.OPEN)
                                ws.send(JSON.stringify({ type: 'pi-yolo-status', status: 'disconnected' }));
                        });
                    }

                    tryConnect();
                    ws._piYoloWs = { close: () => { retries = MAX_RETRY; } }; // sentinel
                } else if (msg.action === 'stop') {
                    if (ws._piYoloWs) { ws._piYoloWs.close(); ws._piYoloWs = null; }
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        console.log('[WS] Client disconnected');
        if (stream) try { stream.end(); } catch { }
        if (sshClient) try { sshClient.end(); } catch { }
        if (ws._piYoloWs) try { ws._piYoloWs.close(); } catch { }
        sessions.delete(sessionId);
    });
});

// ─── Tunnel Management ─────────────────────────────────────────────────────
const { spawn } = require('child_process');
let tunnelProc = null;
let tunnelUrl = null;
let tunnelType = null;

app.post('/api/tunnel/start', async (req, res) => {
    const { type = 'ngrok' } = req.body;
    if (tunnelProc) return res.json({ success: false, message: 'Tunnel already running. Stop it first.' });

    tunnelType = type;
    tunnelUrl = null;

    let cmd, args;
    if (type === 'ngrok') {
        cmd = 'ngrok'; args = ['http', '3000', '--log', 'stdout'];
    } else if (type === 'cloudflared') {
        // Use local exe if present, else fall back to system install
        const localExe = path.join(__dirname, 'cloudflared.exe');
        const fs2 = require('fs');
        cmd = fs2.existsSync(localExe) ? localExe : 'cloudflared';
        args = ['tunnel', '--url', 'http://localhost:3000'];
    } else if (type === 'lt') {
        cmd = 'npx'; args = ['-y', 'localtunnel', '--port', '3000'];
    } else {
        return res.json({ success: false, message: 'Unknown tunnel type' });
    }

    try {
        tunnelProc = spawn(cmd, args, { shell: true });

        // Parse URL from output
        tunnelProc.stdout.on('data', d => {
            const s = d.toString();
            // ngrok URL
            const ng = s.match(/https:\/\/[a-z0-9\-]+\.ngrok[\-a-z]*\.app/);
            if (ng) tunnelUrl = ng[0];
            // cloudflared URL
            const cf = s.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
            if (cf) tunnelUrl = cf[0];
            // localtunnel URL
            const lt = s.match(/your url is: (https:\/\/[^\s]+)/i);
            if (lt) tunnelUrl = lt[1];
        });
        tunnelProc.stderr.on('data', d => {
            const s = d.toString();
            const cf = s.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
            if (cf) tunnelUrl = cf[0];
            const ng = s.match(/https:\/\/[a-z0-9\-]+\.ngrok[\-a-z]*\.app/);
            if (ng) tunnelUrl = ng[0];
        });
        tunnelProc.on('exit', () => { tunnelProc = null; tunnelUrl = null; });

        res.json({ success: true, message: `${type} tunnel starting…` });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.get('/api/tunnel/status', async (req, res) => {
    if (!tunnelProc) return res.json({ running: false });

    // For ngrok: also try the local API for extra reliability
    if (tunnelType === 'ngrok' && !tunnelUrl) {
        try {
            const r = await fetch('http://localhost:4040/api/tunnels');
            const d = await r.json();
            const pub = d.tunnels?.find(t => t.proto === 'https');
            if (pub) tunnelUrl = pub.public_url;
        } catch { }
    }
    res.json({ running: true, url: tunnelUrl, type: tunnelType });
});

app.post('/api/tunnel/stop', (req, res) => {
    if (tunnelProc) { tunnelProc.kill(); tunnelProc = null; tunnelUrl = null; }
    res.json({ success: true, message: 'Tunnel stopped' });
});

// ─── Start Server ──────────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║        NayanSathi Pi Terminal Server - RUNNING                ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  Local:   http://localhost:${PORT}                               ║`);
    console.log(`║  Network: http://<YOUR_IP>:${PORT}                              ║`);
    console.log('║                                                                ║');
    console.log('║  Open the URL in your browser to connect to Raspberry Pi 4    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
});
