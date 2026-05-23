// venv_pi_fix.js — create venv, install packages, run yolo_server.py inside it
const Client = require('ssh2').Client;
const fs = require('fs');
const path = require('path');

function run(conn, cmd, label) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '', errs = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { errs += d; });
            st.on('close', code => {
                if (label) console.log('[' + label + '] code=' + code);
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
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({
        host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000
    }));
    console.log('[SSH] ✅ Connected to Pi\n');

    // Upload scripts  
    await run(conn, 'mkdir -p ~/NayanSathi');
    await upload(conn, path.join(__dirname, 'pi_scripts', 'yolo_server.py'), '/home/pi/NayanSathi/yolo_server.py');
    const onnx = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');
    if (fs.existsSync(onnx)) await upload(conn, onnx, '/home/pi/NayanSathi/yolo11n.onnx');

    // Create venv if not exists
    console.log('\n[1] Creating Python venv at ~/yolo_env ...');
    await run(conn, 'test -d ~/yolo_env && echo EXISTS || python3 -m venv ~/yolo_env && echo CREATED', 'venv');

    // Install packages INSIDE venv
    console.log('\n[2] Checking packages inside venv...');
    const chkAll = await run(conn, '~/yolo_env/bin/python -c "import websockets,ultralytics,cv2; print(\'ALL_OK\')" 2>&1');

    if (chkAll.out.includes('ALL_OK')) {
        console.log('✅ All packages already in venv!');
    } else {
        // websockets
        const wsChk = await run(conn, '~/yolo_env/bin/python -c "import websockets" 2>/dev/null && echo OK || echo NEED');
        if (wsChk.out.includes('NEED')) {
            console.log('Installing websockets...');
            await run(conn, '~/yolo_env/bin/pip install --no-cache-dir websockets 2>&1 | tail -3', 'websockets');
        }

        // opencv
        const cvChk = await run(conn, '~/yolo_env/bin/python -c "import cv2" 2>/dev/null && echo OK || echo NEED');
        if (cvChk.out.includes('NEED')) {
            console.log('Installing opencv-python-headless...');
            await run(conn, '~/yolo_env/bin/pip install --no-cache-dir opencv-python-headless 2>&1 | tail -3', 'opencv');
        }

        // ultralytics  
        const ulChk = await run(conn, '~/yolo_env/bin/python -c "import ultralytics" 2>/dev/null && echo OK || echo NEED');
        if (ulChk.out.includes('NEED')) {
            console.log('Installing ultralytics (3-5 min)...');
            await run(conn, '~/yolo_env/bin/pip install --no-cache-dir ultralytics 2>&1 | tail -6', 'ultralytics');
        }

        // Final check
        const final = await run(conn, '~/yolo_env/bin/python -c "import websockets,ultralytics,cv2; print(\'ALL_OK\')" 2>&1', 'final-check');
        if (!final.out.includes('ALL_OK')) {
            console.error('\n❌ Package install failed:\n', final.out, final.err);
            conn.end(); return;
        }
    }

    // Kill old + start with venv python
    console.log('\n[3] Starting yolo_server.py (using venv)...');
    await run(conn,
        'pkill -f yolo_server.py 2>/dev/null; sleep 1; ' +
        'nohup ~/yolo_env/bin/python ~/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream --port 8765 --fps 4 ' +
        '> ~/NayanSathi/yolo.log 2>&1 & echo "PID=$!"',
        'start'
    );

    console.log('\nWaiting 6s for server to boot...');
    await new Promise(r => setTimeout(r, 6000));

    const portCheck = await run(conn, 'ss -tlnp 2>/dev/null | grep 8765 && echo PORT_OK || echo NOT_OPEN');
    if (portCheck.out.includes('PORT_OK')) {
        console.log('\n🎉 ✅ yolo_server.py LIVE on port 8765!');
        console.log('→ Dashboard: 🤖 Pi YOLO → ▶ Run');
    } else {
        console.log('\n⚠️ Not open yet. Log:');
        await run(conn, 'cat ~/NayanSathi/yolo.log');
    }

    conn.end();
    console.log('\n[Done]');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
