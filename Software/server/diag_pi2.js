const Client = require('ssh2').Client;
function run(c, cmd) { return new Promise((r) => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write('[e]' + d.toString())); st.on('close', () => r(o)) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));

    console.log('=== Pinging ESP32-CAM ===');
    await run(c, 'ping -c 2 192.168.1.36 || echo PING_FAIL');

    console.log('\n=== Trying cam stream URLs ===');
    await run(c, 'curl -s --max-time 4 -o /dev/null -w "HTTP:%{http_code}" http://192.168.1.36/ && echo OK || echo FAIL');
    await run(c, 'curl -s --max-time 4 -o /dev/null -w "HTTP:%{http_code}" http://192.168.1.36:81/stream && echo OK || echo FAIL');
    await run(c, 'curl -s --max-time 4 -o /dev/null -w "HTTP:%{http_code}" http://192.168.1.36:81/ && echo OK || echo FAIL');

    console.log('\n=== Full YOLO log ===');
    await run(c, 'cat ~/NayanSathi/yolo.log');

    console.log('\n=== Restart with correct cam URL ===');
    // Kill old and restart with stream URL and longer timeout
    await run(c, 'pkill -f yolo_server.py 2>/dev/null; sleep 1; nohup ~/yolo_env/bin/python ~/NayanSathi/yolo_server.py --cam http://192.168.1.36:81/stream --port 8765 --fps 3 --conf 0.35 > ~/NayanSathi/yolo.log 2>&1 & echo "Restarted PID=$!"');
    await new Promise(r => setTimeout(r, 8000));
    console.log('\n=== Log after restart ===');
    await run(c, 'cat ~/NayanSathi/yolo.log');

    c.end();
}
go().catch(e => console.error('❌', e.message));
