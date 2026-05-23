const Client = require('ssh2').Client;
function run(c, cmd, lbl) { return new Promise((res, rej) => { c.exec(cmd, (e, st) => { if (e) return rej(e); let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write(d.toString())); st.on('close', code => { console.log('[' + lbl + '] exit=' + code); res({ code, out: o }) }) }) }) }
async function go() {
    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 10000 }));
    console.log('✅ Connected to Pi');

    await run(conn, 'df -h /tmp /home/pi', 'df');

    // Install ultralytics with TMPDIR on home partition (lots of space)
    await run(conn, 'mkdir -p ~/tmp && TMPDIR=~/tmp ~/yolo_env/bin/pip install --no-cache-dir ultralytics 2>&1 | tail -8', 'ultralytics');

    // Verify all
    const v = await run(conn, "~/yolo_env/bin/python -c 'import websockets,ultralytics,cv2;print(websockets.__version__,ultralytics.__version__,cv2.__version__)' 2>&1", 'verify');
    if (v.out.includes('No module')) {
        console.log('❌ Still failing. Log:');
        await run(conn, 'cat ~/NayanSathi/yolo.log 2>/dev/null||echo empty', 'log');
        conn.end(); return;
    }
    console.log('✅ All packages OK! Starting server...');

    // Kill old + start fresh
    await run(conn, "pkill -f yolo_server.py 2>/dev/null||true;sleep 1;nohup ~/yolo_env/bin/python ~/NayanSathi/yolo_server.py --cam http://192.168.1.36:81/stream --port 8765 --fps 4 >~/NayanSathi/yolo.log 2>&1 &echo PID=$!", 'start');

    await new Promise(r => setTimeout(r, 8000));
    await run(conn, "ss -tlnp|grep 8765&&echo PORT_OK||(echo NOT_OPEN&&cat ~/NayanSathi/yolo.log)", 'port');
    conn.end();
}
go().catch(e => console.error('❌', e.message));
