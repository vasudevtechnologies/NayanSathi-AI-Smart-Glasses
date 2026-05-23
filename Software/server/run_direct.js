const Client = require('ssh2').Client;
const path = require('path');
function run(c, cmd) { return new Promise(r => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write(d.toString())); st.on('close', code => { console.log('\n[exit=' + code + ']'); r(o) }) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    // Run directly redirecting both stdout+stderr, 40s timeout
    await run(c,
        'timeout 40 ~/yolo_env/bin/python /home/pi/NayanSathi/yolo_server.py ' +
        '--cam "http://192.168.1.35:3000/api/camera-stream?url=http://192.168.1.36:81/stream" ' +
        '--port 8766 --fps 4 --conf 0.25 2>&1'
    );
    c.end();
}
go().catch(e => console.error(e.message));
