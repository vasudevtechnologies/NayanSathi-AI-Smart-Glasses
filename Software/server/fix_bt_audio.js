const ssh2 = require('ssh2');

function run(c, cmd, to = 15000) {
    return new Promise(res => {
        c.exec(cmd, (e, st) => {
            if (e) return res('');
            let o = '';
            const t = setTimeout(() => res(o), to);
            st.on('data', d => { o += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => { process.stdout.write('[STDERR] ' + d.toString()); });
            st.on('close', () => { clearTimeout(t); res(o); });
        });
    });
}

async function main() {
    const c = new (ssh2.Client || ssh2)();
    await new Promise((ok, err) => c.on('ready', ok).on('error', err)
        .connect({ host: '192.168.137.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    console.log('✅ SSH OK\n');

    await run(c, 'pkill -9 -f yolo_server 2>/dev/null; sleep 1');

    // Start with -u (unbuffered) and log everything
    await run(c, 'cd /home/pi/NayanSathi && /home/pi/yolo_env/bin/python3 -u yolo_server.py --cam http://192.168.137.36:82/stream --port 8765 --fps 3 --conf 0.3 > /tmp/yolo_test.log 2>&1 & disown && echo "Started: $!"');

    console.log('⏳ Waiting 8s...');
    await new Promise(r => setTimeout(r, 8000));

    console.log('\n=== /tmp/yolo_test.log ===');
    await run(c, 'cat /tmp/yolo_test.log');

    console.log('\n=== Port 8765 ===');
    await run(c, 'ss -tlnp | grep 8765 && echo "OPEN ✅" || echo "NOT OPEN ❌"');

    c.end();
}
main().catch(e => console.error(e.message));
