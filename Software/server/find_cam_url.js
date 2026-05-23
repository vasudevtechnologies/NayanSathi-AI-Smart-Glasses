const Client = require('ssh2').Client;
function run(c, cmd) { return new Promise(r => { c.exec(cmd, (e, st) => { let o = ''; st.on('data', d => { o += d; process.stdout.write(d.toString()) }); st.stderr.on('data', d => process.stdout.write(d.toString())); st.on('close', () => r(o)) }) }) }
async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({ host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000 }));
    // Test all ESP32-CAM common endpoints
    const urls = [
        'http://192.168.1.36/capture',
        'http://192.168.1.36/jpg',
        'http://192.168.1.36/cam-hi.jpg',
        'http://192.168.1.36:81/capture',
        'http://192.168.1.36:81/',
        'http://192.168.1.36/',
    ];
    for (const url of urls) {
        await run(c, `curl -s --max-time 5 -o /tmp/test.jpg -w "URL:${url} → HTTP:%{http_code} SIZE:%{size_download}\\n" "${url}"`);
    }
    // Also check if we can read the MJPEG directly and extract first frame
    console.log('\n=== Try extracting 1 frame from MJPEG stream ===');
    await run(c, "timeout 8 ~/yolo_env/bin/python -c \"import urllib.request,numpy as np,cv2; req=urllib.request.urlopen('http://192.168.1.36:81/stream',timeout=5); buf=b''; frames=0; [buf:=buf+req.read(4096) or buf for _ in range(200)]; s=buf.find(b'\\xff\\xd8'); e=buf.find(b'\\xff\\xd9'); print('frame bytes:',e-s if s!=-1 and e!=-1 else 'NO FRAME')\" 2>&1");
    c.end();
}
go().catch(e => console.error(e.message));
