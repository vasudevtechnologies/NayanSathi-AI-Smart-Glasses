// fix_pi_yolo_nocache.js — installs with --no-cache-dir to avoid /tmp space issues
const Client = require('ssh2').Client;
const fs = require('fs');
const path = require('path');

const PI = { host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000 };

function run(conn, cmd, label) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '', errs = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { errs += d; process.stdout.write('[e] ' + d.toString()); });
            st.on('close', code => {
                if (label) console.log('[' + label + '] done (code=' + code + ')');
                res({ code, out, err: errs });
            });
        });
    });
}

function upload(conn, localPath, remotePath) {
    return new Promise((res, rej) => {
        conn.sftp((err, sftp) => {
            if (err) return rej(err);
            sftp.fastPut(localPath, remotePath, {}, err2 => {
                if (err2) return rej(err2);
                console.log('[SFTP] ✅ ' + path.basename(localPath));
                sftp.end();
                res();
            });
        });
    });
}

async function main() {
    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect(PI));
    console.log('[SSH] ✅ Connected!');

    await run(conn, 'mkdir -p ~/NayanSathi', '1-mkdir');

    const scriptSrc = path.join(__dirname, 'pi_scripts', 'yolo_server.py');
    await upload(conn, scriptSrc, '/home/pi/NayanSathi/yolo_server.py');

    const onnxSrc = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');
    if (fs.existsSync(onnxSrc)) await upload(conn, onnxSrc, '/home/pi/NayanSathi/yolo11n.onnx');

    // Check if already installed
    const depCheck = await run(conn, 'python3 -c "import websockets; print(websockets.__version__)" 2>/dev/null && echo DEPS_OK');
    if (depCheck.out.includes('DEPS_OK')) {
        console.log('[SSH] ✅ Dependencies already installed!');
    } else {
        console.log('[SSH] Installing with --no-cache-dir (no /tmp space needed)...');
        // First purge pip cache, then install
        await run(conn, 'pip3 cache purge 2>/dev/null; rm -rf ~/.cache/pip 2>/dev/null; echo cache_cleared', 'cache-purge');
        await run(conn,
            'pip3 install --no-cache-dir --break-system-packages websockets 2>&1 | tail -5 && echo WS_DONE',
            'install-websockets'
        );
        await run(conn,
            'pip3 install --no-cache-dir --break-system-packages opencv-python-headless 2>&1 | tail -5 && echo CV_DONE',
            'install-opencv'
        );
        await run(conn,
            'pip3 install --no-cache-dir --break-system-packages ultralytics 2>&1 | tail -5 && echo UL_DONE',
            'install-ultralytics'
        );
    }

    // Kill old + start fresh
    console.log('\n[SSH] Starting yolo_server.py on Pi...');
    await run(conn,
        'pkill -f yolo_server.py 2>/dev/null; sleep 1; ' +
        'nohup python3 ~/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream --port 8765 --fps 4 ' +
        '> ~/NayanSathi/yolo.log 2>&1 & echo "PID=$!"',
        'start'
    );

    await new Promise(r => setTimeout(r, 5000));
    const check = await run(conn, 'ss -tlnp 2>/dev/null | grep 8765 && echo PORT_OK || echo PORT_NOT_OPEN');
    if (check.out.includes('PORT_OK')) {
        console.log('\n✅✅ yolo_server.py is LIVE on port 8765!');
        console.log('→ Go to dashboard → 🤖 Pi YOLO → ▶ Run to connect');
    } else {
        console.log('\n⚠️  Not on port yet. Log:');
        await run(conn, 'tail -30 ~/NayanSathi/yolo.log');
    }
    conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
