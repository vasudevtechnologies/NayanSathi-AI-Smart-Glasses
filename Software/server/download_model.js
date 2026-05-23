const https = require('https');
const fs = require('fs');
const dest = 'c:/xampp/htdocs/raspberry_pi_4gb/pi_scripts/yolo11n.onnx';

const urls = [
    'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n.onnx',
    'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx',
];

function download(url, dest, cb, depth = 0) {
    if (depth > 8) return cb(new Error('Too many redirects'));
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
            file.close();
            try { fs.unlinkSync(dest); } catch { }
            return download(res.headers.location, dest, cb, depth + 1);
        }
        if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(dest); } catch { }
            return cb(new Error(`HTTP ${res.statusCode}`));
        }
        let bytes = 0;
        res.on('data', c => { bytes += c.length; process.stdout.write(`\r  Downloading... ${(bytes / 1024 / 1024).toFixed(1)} MB`); });
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log(`\n✓ Done: ${(bytes / 1024 / 1024).toFixed(1)} MB`); cb(null); });
    }).on('error', cb);
}

function tryNext(i) {
    if (i >= urls.length) { console.error('\nAll URLs failed!'); process.exit(1); }
    console.log(`\nTrying [${i + 1}/${urls.length}]: ${urls[i]}`);
    download(urls[i], dest, (err) => {
        if (err) { console.log('  Failed:', err.message); tryNext(i + 1); }
        else {
            const size = fs.statSync(dest).size;
            if (size < 100000) { console.log('  File too small, trying next...'); tryNext(i + 1); }
            else { console.log(`\n✅ SUCCESS! ${(size / 1024 / 1024).toFixed(1)} MB → ${dest}`); }
        }
    });
}

console.log('Downloading yolo11n.onnx (YOLO v11 nano)...');
tryNext(0);
