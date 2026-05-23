// check_pi.js — diagnose and fix websockets install
const Client = require('ssh2').Client;
const conn = new Client();

function run(conn, cmd, label) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '', errs = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { errs += d; process.stdout.write(d.toString()); });
            st.on('close', code => res({ code, out, err: errs }));
        });
    });
}

async function main() {
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({
        host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000
    }));
    console.log('[SSH] Connected\n');

    // Check disk usage detail
    await run(conn, 'df -h && echo ---');

    // Show yolo.log
    console.log('\n=== yolo.log ===');
    await run(conn, 'cat ~/NayanSathi/yolo.log 2>/dev/null || echo "(empty)"');

    // Try import websockets directly  
    console.log('\n=== import check ===');
    await run(conn, 'python3 -c "import websockets; print(websockets.__version__)" 2>&1');
    await run(conn, 'python3 -c "import ultralytics; print(ultralytics.__version__)" 2>&1');
    await run(conn, 'python3 -c "import cv2; print(cv2.__version__)" 2>&1');

    // Try install websockets with pip3 user
    console.log('\n=== Installing websockets user-mode ===');
    await run(conn, 'pip3 install --no-cache-dir --user websockets 2>&1 | tail -5 && echo WS_DONE');

    // Verify
    await run(conn, 'python3 -c "import websockets; print(websockets.__version__)" 2>&1');

    // Start server
    console.log('\n=== Starting yolo_server.py ===');
    await run(conn, 'pkill -f yolo_server.py 2>/dev/null; sleep 1; nohup python3 ~/NayanSathi/yolo_server.py --cam http://192.168.1.36:81/stream --port 8765 --fps 4 > ~/NayanSathi/yolo.log 2>&1 & echo "PID=$!"');
    await new Promise(r => setTimeout(r, 4000));
    await run(conn, 'ss -tlnp | grep 8765 && echo PORT_OK || echo NOT_OPEN');
    await run(conn, 'tail -15 ~/NayanSathi/yolo.log');

    conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
