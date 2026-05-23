/**
 * NayanSathi — Full Deploy Script
 * Uploads yolo_server.py + voice_server.py to Pi and starts both.
 * Run: node deploy.js
 */

const ssh2 = require('ssh2');
const fs = require('fs');
const net = require('net');

const PI = { host: '192.168.137.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000 };

// ── helpers ────────────────────────────────────────────────────────────────────
function run(c, cmd, to = 15000) {
    return new Promise(res => {
        c.exec(cmd, (e, st) => {
            if (e) return res('');
            let o = '';
            const t = setTimeout(() => res(o), to);
            st.on('data', d => { o += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { process.stdout.write('  [ERR] ' + d.toString()); });
            st.on('close', () => { clearTimeout(t); res(o); });
        });
    });
}

function upload(c, localPath, remotePath) {
    return new Promise((resolve, reject) => {
        c.sftp((err, sftp) => {
            if (err) return reject(err);
            const ws = sftp.createWriteStream(remotePath, { mode: 0o755 });
            ws.on('close', () => { console.log(`  ✅ Uploaded → ${remotePath}`); resolve(); });
            ws.on('error', reject);
            fs.createReadStream(localPath).pipe(ws);
        });
    });
}

function checkPort(host, port, timeout = 4000) {
    return new Promise(res => {
        const s = new net.Socket();
        s.setTimeout(timeout);
        s.connect(port, host, () => { s.destroy(); res(true); });
        s.on('error', () => res(false));
        s.on('timeout', () => { s.destroy(); res(false); });
    });
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   NayanSathi — Full Deploy to Pi         ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // 1. Connect
    process.stdout.write('🔌 Connecting to Pi @ ' + PI.host + '...');
    const c = new (ssh2.Client || ssh2)();
    await new Promise((ok, err) => c.on('ready', ok).on('error', err).connect(PI));
    console.log(' ✅\n');

    // 2. Kill old processes
    console.log('🔧 Stopping old processes...');
    await run(c, 'pkill -9 -f yolo_server.py 2>/dev/null; pkill -9 -f voice_server.py 2>/dev/null; sleep 1');
    console.log();

    // 3. Ensure NayanSathi directory exists
    await run(c, 'mkdir -p /home/pi/NayanSathi');

    // 4. Upload files
    console.log('📤 Uploading files...');
    const uploads = [
        { local: './pi_scripts/yolo_server.py', remote: '/home/pi/NayanSathi/yolo_server.py' },
        { local: './pi_voice_server.py', remote: '/home/pi/NayanSathi/voice_server.py' }
    ];
    for (const f of uploads) {
        if (!fs.existsSync(f.local)) { console.log(`  ⚠️  Not found: ${f.local} (skip)`); continue; }
        await upload(c, f.local, f.remote).catch(e => console.log('  ❌ Upload failed:', e.message));
    }
    console.log();

    // 5. Syntax check
    console.log('🧪 Python syntax check...');
    const chk = await run(c, '/home/pi/yolo_env/bin/python3 -c "import ast; ast.parse(open(\'/home/pi/NayanSathi/yolo_server.py\').read()); print(\'OK\')"');
    if (!chk.includes('OK')) { console.log('  ❌ Syntax error! Aborting.'); c.end(); return; }
    console.log('  ✅ Syntax OK\n');

    // 6. Show what ONNX/PT model is on Pi
    console.log('🤖 Models on Pi:');
    await run(c, 'ls -lh /home/pi/NayanSathi/*.onnx /home/pi/NayanSathi/*.pt ~/.cache/ultralytics/ 2>/dev/null | head -10 || echo "  (no .onnx/.pt found locally)"');
    console.log();

    // 7. Start voice server
    console.log('🔊 Starting voice server (port 3001)...');
    await run(c, 'nohup /home/pi/yolo_env/bin/python3 /home/pi/NayanSathi/voice_server.py > /tmp/vs.log 2>&1 & disown');

    // 8. Start YOLO server
    console.log('🧠 Starting YOLO server (port 8765)...');
    await run(c, 'rm -f /home/pi/NayanSathi/yolo.log; nohup /home/pi/yolo_env/bin/python3 /home/pi/NayanSathi/yolo_server.py > /home/pi/NayanSathi/yolo.log 2>&1 & disown && echo "PID=$!"');
    console.log();

    // 9. Wait for WebSocket to bind (ONNX loads in ~5s, .pt takes ~25s)
    process.stdout.write('⏳ Waiting for WebSocket to open');
    let open = false;
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        process.stdout.write('.');
        open = await checkPort(PI.host, 8765, 1500);
        if (open) break;
    }
    console.log(open ? ' ✅' : ' ❌');
    console.log();

    // 10. Show log
    console.log('📋 YOLO log:');
    await run(c, 'cat /home/pi/NayanSathi/yolo.log');
    console.log();

    // 11. Port status
    const voice = await checkPort(PI.host, 3001);
    console.log('─────────────────────────────────────────');
    console.log(`  YOLO  :8765  ${open ? '✅ OPEN — real-time detection ready' : '❌ NOT OPEN (check log above)'}`);
    console.log(`  Voice :3001  ${voice ? '✅ OPEN — voice feedback ready' : '❌ NOT OPEN'}`);
    console.log('─────────────────────────────────────────');

    if (open) {
        console.log('\n🎯 SUCCESS! Open http://localhost:3000/');
        console.log('   → SSH Connect → ▶ Run → walk around!');
        console.log('   Detections: person, car, traffic light, phone...');
        console.log('   Voice: Bluetooth earphones\n');
    } else {
        console.log('\n⚠️  YOLO not ready. Try: node deploy.js again in 30s\n');
    }

    c.end();
}

main().catch(e => {
    console.error('\n❌ Deploy failed:', e.message);
    process.exit(1);
});
