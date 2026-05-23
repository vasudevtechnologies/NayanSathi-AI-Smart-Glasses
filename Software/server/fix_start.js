const Client = require('ssh2').Client;
const fs = require('fs'), path = require('path');
function run(c, cmd) { return new Promise((r) => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write(d.toString())); st.on('close', () => r(o)) }) }) }
function upload(c, local, remote) { return new Promise((r, j) => { c.sftp((e, sftp) => { if (e) return j(e); sftp.fastPut(local, remote, {}, e2 => { sftp.end(); if (e2) return j(e2); console.log('✅ Uploaded ' + path.basename(local)); r() }) }) }) }

async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    console.log('✅ Connected\n');

    // Check what files exist
    console.log('=== Files on Pi ===');
    await run(c, 'ls -la ~/NayanSathi/');

    // Upload fresh yolo_server.py
    await upload(c, path.join(__dirname, 'pi_scripts', 'yolo_server.py'), '/home/pi/NayanSathi/yolo_server.py');

    // Check if ONNX model exists
    const onnxLocal = path.join(__dirname, 'pi_scripts', 'yolo11n.onnx');
    if (fs.existsSync(onnxLocal)) {
        await upload(c, onnxLocal, '/home/pi/NayanSathi/yolo11n.onnx');
    }

    // Test model loading directly (shows exact error)
    console.log('\n=== Testing model load ===');
    await run(c, "~/yolo_env/bin/python -c \"from ultralytics import YOLO; m=YOLO('yolo11n.pt',task='detect'); print('Model OK')\" 2>&1 | head -20");

    // Kill old + restart using .pt model (auto-downloads if needed)
    console.log('\n=== Starting with yolo11n.pt (auto-download) ===');
    await run(c,
        'pkill -f yolo_server.py 2>/dev/null; sleep 1; ' +
        '~/yolo_env/bin/python /home/pi/NayanSathi/yolo_server.py ' +
        '--cam http://192.168.1.36:81/stream --port 8765 --fps 3 --conf 0.3 ' +
        '> /home/pi/NayanSathi/yolo.log 2>&1 & echo "PID=$!"'
    );

    console.log('\nWaiting 12s for model load + cam connect...');
    await new Promise(r => setTimeout(r, 12000));

    console.log('\n=== Status after 12s ===');
    await run(c, 'ss -tlnp 2>/dev/null | grep 8765 && echo PORT_OK || echo NOT_OPEN');
    await run(c, 'cat /home/pi/NayanSathi/yolo.log');
    c.end();
}
go().catch(e => console.error('❌', e.message));
