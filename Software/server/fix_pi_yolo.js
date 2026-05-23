// fix_pi_yolo.js — Direct SSH fix: upload + install + start yolo_server.py on Pi
const Client = require('ssh2').Client;
const fs = require('fs');
const path = require('path');

const PI = { host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000 };
const SCRIPT_SRC = path.join(__dirname, 'pi_scripts', 'yolo_server.py');
const ONNX_SRC = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');

function run(conn, cmd) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '', err2 = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { err2 += d; process.stdout.write('[e] ' + d.toString()); });
            st.on('close', code => res({ code, out, err: err2 }));
        });
    });
}

function upload(conn, localPath, remotePath) {
    return new Promise((res, rej) => {
        conn.sftp((err, sftp) => {
            if (err) return rej(err);
            sftp.fastPut(localPath, remotePath, {}, (err2) => {
                if (err2) return rej(err2);
                console.log('[SFTP] Uploaded ' + path.basename(localPath) + ' → ' + remotePath);
                sftp.end();
                res();
            });
        });
    });
}

async function main() {
    const conn = new Client();

    await new Promise((res, rej) => {
        conn.on('ready', res).on('error', rej).connect(PI);
    });
    console.log('[SSH] ✅ Connected to Pi @ 192.168.1.40');

    // 1. mkdir
    await run(conn, 'mkdir -p ~/NayanSathi && echo "[1] Dir ready"');

    // 2. Upload yolo_server.py
    await upload(conn, SCRIPT_SRC, '/home/pi/NayanSathi/yolo_server.py');

    // 3. Upload ONNX model if exists
    if (fs.existsSync(ONNX_SRC)) {
        await upload(conn, ONNX_SRC, '/home/pi/NayanSathi/yolo11n.onnx');
    } else {
        console.log('[SFTP] yolo11n.onnx not found locally — Pi will download it');
    }

    // 4. Install Python deps (skip if already installed)
    console.log('[SSH] Checking Python dependencies...');
    const depCheck = await run(conn,
        'python3 -c "import ultralytics, websockets, cv2" 2>/dev/null && echo DEPS_OK'
    );
    if (!depCheck.out.includes('DEPS_OK')) {
        console.log('[SSH] Installing deps (this may take 2-5 min)...');
        await run(conn,
            'pip3 install --break-system-packages -q ultralytics websockets opencv-python-headless numpy 2>&1 | tail -5 && echo INSTALLED'
        );
    } else {
        console.log('[SSH] ✅ Dependencies already installed');
    }

    // 5. Kill old + start fresh yolo_server.py
    console.log('[SSH] Starting yolo_server.py...');
    await run(conn,
        'pkill -f yolo_server.py 2>/dev/null; sleep 1; ' +
        'nohup python3 ~/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream ' +
        '--port 8765 --fps 4 ' +
        '> ~/NayanSathi/yolo.log 2>&1 & echo "[5] PID=$!"'
    );

    // 6. Wait 4s then verify it's listening
    await new Promise(r => setTimeout(r, 4000));
    const check = await run(conn, 'ss -tlnp | grep 8765 && echo PORT_OK || echo PORT_NOT_OPEN');
    if (check.out.includes('PORT_OK')) {
        console.log('\n✅ yolo_server.py is listening on port 8765!');
        console.log('✅ Go to dashboard → ▶ Run to connect proxy');
    } else {
        console.log('\n⚠️  Port 8765 not open yet. Checking log...');
        await run(conn, 'tail -20 ~/NayanSathi/yolo.log');
    }

    conn.end();
    console.log('\n[SSH] Done!');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
