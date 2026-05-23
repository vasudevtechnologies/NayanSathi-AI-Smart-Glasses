// final_pi_fix.js — use python3 -m pip which installs where python3 can actually find it
const Client = require('ssh2').Client;
const fs = require('fs');
const path = require('path');

function run(conn, cmd, label) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, st) => {
            if (err) return rej(err);
            let out = '', errs = '';
            st.on('data', d => { out += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { errs += d; process.stdout.write(d.toString()); });
            st.on('close', code => {
                if (label) console.log('\n[' + label + '] code=' + code);
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
    console.log('[SSH] ✅ Connected to Pi 192.168.1.40\n');

    // Upload scripts
    await run(conn, 'mkdir -p ~/NayanSathi');
    await upload(conn, path.join(__dirname, 'pi_scripts', 'yolo_server.py'), '/home/pi/NayanSathi/yolo_server.py');
    const onnx = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');
    if (fs.existsSync(onnx)) await upload(conn, onnx, '/home/pi/NayanSathi/yolo11n.onnx');

    // Get python3 path and site-packages
    const pyPath = await run(conn, 'which python3 && python3 -c "import site; print(site.getsitepackages()[0])"');
    console.log('\nPython paths:', pyPath.out.trim());

    // Install using python3 -m pip (same python as running the script)
    const CHECK = 'python3 -c "import websockets, ultralytics, cv2; print(websockets.__version__, ultralytics.__version__)" 2>&1';
    const chk1 = await run(conn, CHECK, 'initial-check');

    if (!chk1.out.includes('No module')) {
        console.log('✅ All packages already installed!');
    } else {
        console.log('\nInstalling packages with python3 -m pip...\n');

        // websockets
        const wsChk = await run(conn, 'python3 -c "import websockets" 2>/dev/null && echo OK || echo NEED');
        if (wsChk.out.includes('NEED')) {
            await run(conn, 'python3 -m pip install --no-cache-dir websockets 2>&1 | tail -5', 'websockets');
        }

        // opencv
        const cvChk = await run(conn, 'python3 -c "import cv2" 2>/dev/null && echo OK || echo NEED');
        if (cvChk.out.includes('NEED')) {
            await run(conn, 'python3 -m pip install --no-cache-dir opencv-python-headless 2>&1 | tail -5', 'opencv');
        }

        // ultralytics (large)
        const ulChk = await run(conn, 'python3 -c "import ultralytics" 2>/dev/null && echo OK || echo NEED');
        if (ulChk.out.includes('NEED')) {
            console.log('\nInstalling ultralytics (may take 3-5 min)...');
            await run(conn, 'python3 -m pip install --no-cache-dir ultralytics 2>&1 | tail -8', 'ultralytics');
        }

        // Verify all
        console.log('\n=== Final verification ===');
        await run(conn, CHECK, 'verify');
    }

    // Kill old + start yolo_server.py
    console.log('\n[SSH] Starting yolo_server.py...');
    await run(conn,
        'pkill -f yolo_server.py 2>/dev/null; sleep 1; ' +
        'nohup python3 ~/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream --port 8765 --fps 4 ' +
        '> ~/NayanSathi/yolo.log 2>&1 & echo "PID=$!"',
        'start'
    );

    // Wait and check
    console.log('Waiting 6s for server to start...\n');
    await new Promise(r => setTimeout(r, 6000));

    const portCheck = await run(conn, 'ss -tlnp 2>/dev/null | grep 8765 && echo PORT_OK || echo PORT_NOT_OPEN');
    if (portCheck.out.includes('PORT_OK')) {
        console.log('\n🎉 ✅ yolo_server.py is LIVE on port 8765!');
        console.log('→ In dashboard: 🤖 Pi YOLO → ▶ Run');
    } else {
        console.log('\n⚠️ Port not open. Log output:');
        await run(conn, 'cat ~/NayanSathi/yolo.log');
    }

    conn.end();
    console.log('\n[SSH] Done!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
