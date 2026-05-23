const Client = require('ssh2').Client;
function run(c, cmd) { return new Promise((r) => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write('[e]' + d.toString())); st.on('close', () => r(o)) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    console.log('=== PROCESS CHECK ===');
    await run(c, 'ps aux | grep yolo | grep -v grep || echo "NO YOLO PROCESS"');
    console.log('\n=== PORT CHECK ===');
    await run(c, 'ss -tlnp | grep 8765 || echo "PORT 8765 NOT OPEN"');
    console.log('\n=== YOLO LOG (last 40 lines) ===');
    await run(c, 'tail -40 ~/NayanSathi/yolo.log 2>/dev/null || echo "(no log file)"');
    console.log('\n=== CAMERA CHECK ===');
    await run(c, 'curl -s --max-time 3 -o /dev/null -w "%{http_code}" http://192.168.1.36:81/stream || echo "CAM UNREACHABLE"');
    c.end();
}
go().catch(e => console.error('❌', e.message));
