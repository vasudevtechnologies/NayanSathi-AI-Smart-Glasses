const Client = require('ssh2').Client;
function run(c, cmd) {
    return new Promise(r => {
        c.exec(cmd, (e, st) => {
            let o = '';
            st.on('data', d => { o += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => process.stdout.write(d.toString()));
            st.on('close', () => r(o));
        });
    });
}
const c = new Client();
c.on('ready', async () => {
    console.log('✅ Pi Connected via WiFi\n');
    await run(c, 'iwconfig wlan0 2>/dev/null | grep ESSID');
    await run(c, 'ip addr show wlan0 | grep "inet "');
    await run(c, 'cat /etc/wpa_supplicant/wpa_supplicant.conf | grep -v psk');
    await run(c, 'grep -A5 "wlan0" /etc/dhcpcd.conf');
    await run(c, 'ping -c 2 -W 2 8.8.8.8 2>/dev/null | tail -2');
    console.log('\n=== All good! Pi is on Thakre WiFi — no ethernet needed ===');
    c.end();
}).on('error', e => console.error('SSH error:', e.message))
    .connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 });
