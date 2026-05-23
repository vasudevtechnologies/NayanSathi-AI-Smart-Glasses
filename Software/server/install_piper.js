const Client = require('ssh2').Client;
function run(c, cmd, to = 120000) {
    return new Promise(r => {
        c.exec(cmd, (e, st) => {
            if (e) { console.error('[ERR]', e.message); return r(''); }
            let o = '';
            const t = setTimeout(() => r(o), to);
            st.on('data', d => { o += d; process.stdout.write(d.toString()); });
            st.stderr.on('data', d => process.stdout.write('[err] ' + d.toString()));
            st.on('close', () => { clearTimeout(t); r(o); });
        });
    });
}

const SINK = 'bluez_output.8E_79_7D_B3_CD_A6.1';
const MAC = '8E:79:7D:B3:CD:A6';

async function go() {
    const c = new Client();
    await new Promise((r, j) => c.on('ready', r).on('error', j).connect({
        host: '192.168.1.40', port: 22, username: 'pi', password: 'raspberry', readyTimeout: 8000
    }));
    console.log('Connected\n');

    // 1. Download best female Piper voice: en_US-amy-medium
    console.log('=== Downloading female voice: en_US-amy-medium ===');
    await run(c,
        'mkdir -p ~/piper_voices && cd ~/piper_voices && ' +
        '[ -f en_US-amy-medium.onnx ] && echo "Already downloaded" || ' +
        '(wget -q --show-progress -O en_US-amy-medium.onnx ' +
        '"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx" && ' +
        'wget -q -O en_US-amy-medium.onnx.json ' +
        '"https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json" && ' +
        'echo "Female voice downloaded OK")',
        300000);

    // 2. List voice files
    console.log('\n=== Voice models ===');
    await run(c, 'ls -lh ~/piper_voices/*.onnx 2>/dev/null');

    // 3. Write updated tts.sh with female voice + auto BT connect
    console.log('\n=== Writing tts.sh with female voice ===');
    const ttsScript = `#!/bin/bash
# NayanSathi TTS — Female voice (Piper en_US-amy-medium)
TEXT="\${1:-NayanSathi online}"
MAC="${MAC}"
SINK="${SINK}"
FEMALE="$HOME/piper_voices/en_US-amy-medium.onnx"
MALE="$HOME/piper_voices/en_US-ryan-high.onnx"

# Step 1: Ensure Airdopes connected
bluetoothctl connect "$MAC" 2>/dev/null &
BT_PID=$!
sleep 2

# Step 2: Set BT as default audio sink
pactl set-default-sink "$SINK" 2>/dev/null || true

# Step 3: Speak with female Piper voice
MODEL="$FEMALE"
[ ! -f "$MODEL" ] && MODEL="$MALE"

if [ -f "$MODEL" ]; then
  echo "$TEXT" | python3 -m piper --model "$MODEL" --output_raw 2>/dev/null | \\
    paplay --raw --rate=22050 --channels=1 --format=s16le --device="$SINK" 2>/dev/null && exit 0
fi

# Fallback: espeak-ng female voice
espeak-ng -v en-gb+f3 -s 140 -p 70 -a 200 --stdout "$TEXT" 2>/dev/null | \\
  paplay --device="$SINK" 2>/dev/null && exit 0

espeak-ng -v en-gb+f3 -s 140 -p 70 "$TEXT" 2>/dev/null
`;
    await run(c, `python3 -c "
import os
script = ${JSON.stringify(ttsScript)}
path = os.path.expanduser('~/NayanSathi/tts.sh')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    f.write(script)
os.chmod(path, 0o755)
print('tts.sh written OK')
"`);

    // 4. Test female voice right now
    console.log('\n=== Testing female voice ===');
    await run(c, '~/NayanSathi/tts.sh "Hello, I am NayanSathi, your smart glasses assistant." && echo VOICE_OK || echo VOICE_FAIL', 30000);

    console.log('\n=== Done! Female voice installed ===');
    c.end();
}

go().catch(e => console.error('ERROR:', e.message));
