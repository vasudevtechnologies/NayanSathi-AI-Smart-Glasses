const Client = require('ssh2').Client;
const path = require('path');
function run(c, cmd) { return new Promise(r => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write(d.toString())); st.on('close', code => { console.log('[exit=' + code + ']'); r(o) }) }) }) }
function upload(c, local, remote) { return new Promise((r, j) => { c.sftp((e, sftp) => { if (e) return j(e); sftp.fastPut(local, remote, {}, e2 => { sftp.end(); if (e2) return j(e2); console.log('✅ ' + path.basename(local)); r() }) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    console.log('✅ Connected');
    await upload(c, path.join(__dirname, 'pi_scripts', 'yolo_server.py'), '/home/pi/NayanSathi/yolo_server.py');
    await run(c, 'pkill -f yolo_server.py 2>/dev/null; sleep 1; echo killed');
    await run(c, 'nohup ~/yolo_env/bin/python /home/pi/NayanSathi/yolo_server.py --cam http://192.168.1.36:82/stream --port 8765 --fps 5 --conf 0.25 > /home/pi/NayanSathi/yolo.log 2>&1 & echo "PID=$!"');
    console.log('\nWaiting 20s...');
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const p = await run(c, 'ss -tlnp 2>/dev/null|grep 8765&&echo PORT_OK||echo WAIT');
        if (p.includes('PORT_OK')) { console.log('\n🎉 YOLO SERVER IS LIVE!'); break; }
        console.log('[' + ((i + 1) * 5) + 's]...');
    }
    await run(c, 'cat /home/pi/NayanSathi/yolo.log');
    c.end();
}
go().catch(e => console.error('❌', e.message));
