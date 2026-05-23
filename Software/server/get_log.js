const Client = require('ssh2').Client;
function run(c, cmd) { return new Promise((r) => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write('[e]' + d.toString())); st.on('close', () => r(o)) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    console.log('=== Full Log ===');
    await run(c, 'cat ~/NayanSathi/yolo.log 2>/dev/null || echo NO_LOG');
    console.log('\n=== Running process ===');
    await run(c, 'ps aux | grep yolo | grep -v grep');
    console.log('\n=== Port check ===');
    await run(c, 'ss -tlnp 2>/dev/null | grep 8765 || echo NOT_OPEN');
    c.end();
}
go().catch(e => console.error(e.message));
