// force_install_pi.js — unconditionally install all packages in venv + start server
const Client = require('ssh2').Client;
const fs = require('fs'), path = require('path');

function run(conn, cmd, label) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => process.stdout.write(d.toString()));
            st.on('close', code => { if (label) console.log('[' + label + '] exit=' + code); res({ code, out }); });
        });
    });
}

function upload(conn, localPath, remotePath) {
    return new Promise((res, rej) => {
        conn.sftp((err, sftp) => {
            if (err) return rej(err);
            sftp.fastPut(localPath, remotePath, {}, err2 => {
                sftp.end();
                if (err2) return rej(err2);
                console.log('[SFTP] ✅ ' + path.basename(localPath));
                res();
            });
        });
    });
}

async function main() {
    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({
        host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000
    }));
    console.log('✅ SSH Connected to Pi\n');

    await run(conn, 'mkdir -p ~/NayanSathi');
    await upload(conn, path.join(__dirname, 'pi_scripts', 'yolo_server.py'), '/home/pi/NayanSathi/yolo_server.py');
    const onnx = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');
    if (fs.existsSync(onnx)) await upload(conn, onnx, '/home/pi/NayanSathi/yolo11n.onnx');

    // Ensure venv exists with --system-site-packages (reuses OS packages like numpy)
    console.log('\n[1] Setup venv...');
    await run(conn, 'test -d ~/yolo_env || python3 -m venv --system-site-packages ~/yolo_env && echo VENV_OK', 'venv');

    // Force install all needed packages
    console.log('\n[2] Installing packages in venv (force)...');
    await run(conn, '~/yolo_env/bin/pip install --no-cache-dir --upgrade pip 2>&1 | tail -2', 'pip-upgrade');
    await run(conn, '~/yolo_env/bin/pip install --no-cache-dir websockets 2>&1 | tail -4', 'websockets');
    await run(conn, '~/yolo_env/bin/pip install --no-cache-dir opencv-python-headless 2>&1 | tail -4', 'opencv');

    console.log('\n[3] Installing ultralytics (largest package, 3-5 min)...');
    await run(conn, '~/yolo_env/bin/pip install --no-cache-dir ultralytics 2>&1 | tail -6', 'ultralytics');

    // Verify
    console.log('\n[4] Verification...');
    const v = await run(conn, '~/yolo_env/bin/python -c "import websockets,ultralytics,cv2; print(websockets.__version__, ultralytics.__version__, cv2.__version__)" 2>&1', 'verify');
    if (v.out.includes('No module')) {
        console.error('\n❌ Still missing modules:\n', v.out);
        conn.end(); return;
    }
    console.log('\n✅ All packages verified!');

    // Kill old + start fresh 
    console.log('\n[5] Starting yolo_server.py...');
    await run(conn,
        'pkill -f yolo_server.py 2>/dev/null || true; sleep 1; ' +
        'nohup ~/yolo_env/bin/python ~/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream --port 8765 --fps 4 ' +
        '> ~/NayanSathi/yolo.log 2>&1 & echo "PID=$!"', 'start'
    );

    console.log('\nWaiting 7s for YOLO model to load...');
    await new Promise(r => setTimeout(r, 7000));

    const port = await run(conn, 'ss -tlnp 2>/dev/null | grep 8765 && echo PORT_OK || echo NOT_OPEN', 'port-check');
    if (port.out.includes('PORT_OK')) {
        console.log('\n🎉🎉 yolo_server.py is LIVE on :8765!');
        console.log('→ Dashboard → 🤖 Pi YOLO → ▶ Run');
    } else {
        console.log('\n⚠️ Port not open. Log:');
        await run(conn, 'cat ~/NayanSathi/yolo.log');
    }

    conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
