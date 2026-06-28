const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireStrongTunnelSecret, safeCompareSecret, parseCoordinate, parseScrollAmount, parseScrollDirection, validateText, normalizeKey, psSingleQuote, escapeSendKeysText } = require('./computer-use-safety');

const app = express();
const PORT = Number(process.env.COMPUTER_USE_PORT || 3003);
const HOST = process.env.COMPUTER_USE_HOST || '127.0.0.1';
const LOG_FILE = path.join(__dirname, 'computer-use.log');

// Secret token for authentication
let TUNNEL_SECRET;
try {
  TUNNEL_SECRET = requireStrongTunnelSecret(process.env.TUNNEL_SECRET);
} catch (err) {
  console.error(`SECURITY ERROR: ${err.message}`);
  console.error('Set TUNNEL_SECRET to a random value of at least 32 characters before starting the server.');
  process.exit(1);
}

// Allowed applications whitelist
const ALLOWED_APPS = {
  'excel': 'excel.exe',
  'word': 'winword.exe',
  'chrome': 'chrome.exe',
  'navigateur': 'chrome.exe',
  'explorateur': 'explorer.exe',
  'bloc-notes': 'notepad.exe',
  'notepad': 'notepad.exe',
  'calculatrice': 'calc.exe',
  'paint': 'mspaint.exe',
  'wordpress': 'chrome.exe https://www.facadespollet.fr/inova-admin/',
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Log every action
function log(action, details) {
  const entry = `[${new Date().toISOString()}] ${action}: ${JSON.stringify(details)}\n`;
  fs.appendFileSync(LOG_FILE, entry);
  console.log(entry.trim());
}

// Auth middleware
function auth(req, res, next) {
  const token = req.headers['x-tunnel-secret'];
  if (!safeCompareSecret(Array.isArray(token) ? token[0] : token, TUNNEL_SECRET)) {
    log('AUTH_FAILED', { ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Take screenshot
app.post('/computer/action', auth, async (req, res) => {
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  log('ACTION', { action, params });

  try {
    switch (action) {
      case 'screenshot': {
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'screenshot', screenshot });
      }

      case 'open_app': {
        const appName = (params?.app || '').toLowerCase();
        const exeName = ALLOWED_APPS[appName];
        if (!exeName) {
          return res.json({
            success: false,
            error: `Application "${appName}" non autorisée. Applications disponibles : ${Object.keys(ALLOWED_APPS).join(', ')}`,
          });
        }
        await openApp(exeName);
        // Wait for app to open then screenshot (longer for URLs)
        await sleep(exeName.includes('http') ? 12000 : 3000);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'open_app', app: appName, screenshot });
      }

      case 'click': {
        const { x, y } = params || {};
        if (x == null || y == null) {
          return res.status(400).json({ success: false, error: 'Missing x, y coordinates' });
        }
        const safeX = parseCoordinate(x, 'x');
        const safeY = parseCoordinate(y, 'y');
        await click(safeX, safeY);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'click', x: safeX, y: safeY, screenshot });
      }

      case 'type': {
        const { text } = params || {};
        const safeText = validateText(text);
        await typeText(safeText);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'type', text: safeText, screenshot });
      }

      case 'scroll': {
        const { direction, amount } = params || {};
        const safeDirection = parseScrollDirection(direction || 'down');
        const safeAmount = parseScrollAmount(amount || 3);
        await scroll(safeDirection, safeAmount);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'scroll', direction: safeDirection, amount: safeAmount, screenshot });
      }

      case 'key': {
        const { key } = params || {};
        if (!key) {
          return res.json({ success: false, error: 'Missing key' });
        }
        await pressKey(key);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'key', key, screenshot });
      }

      default:
        return res.json({ success: false, error: `Action inconnue : ${action}` });
    }
  } catch (err) {
    log('ERROR', { action, error: err.message });
    const status = /^Invalid /.test(err.message) ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? err.message : 'Action failed' });
  }
});

// --- PowerShell helpers (no native deps needed) ---

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const psFile = path.join(require('os').tmpdir(), 'fp-ps-script.ps1');
    fs.writeFileSync(psFile, script);
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15000,
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(psFile); } catch {}
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function takeScreenshot() {
  const tmpFile = path.join(require('os').tmpdir(), 'fp-screenshot.jpg');

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
# Resize to 1024px wide for faster transfer
$newWidth = 1024
$newHeight = [int]($screen.Height * $newWidth / $screen.Width)
$resized = New-Object System.Drawing.Bitmap($bitmap, $newWidth, $newHeight)
# Save as JPEG quality 60 for smaller file
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 60)
$resized.Save('${tmpFile}', $encoder, $encoderParams)
$graphics.Dispose()
$bitmap.Dispose()
$resized.Dispose()
`;

  await runPowerShell(ps);
  const buffer = fs.readFileSync(tmpFile);
  try { fs.unlinkSync(tmpFile); } catch {}
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function openApp(exeName) {
  const parts = exeName.split(' ');
  if (parts.length > 1) {
    // App with arguments (e.g. "chrome.exe https://...")
    await runPowerShell(`Start-Process '${parts[0]}' -ArgumentList '${parts.slice(1).join(' ')}'`);
  } else {
    await runPowerShell(`Start-Process '${exeName}'`);
  }
}

async function click(x, y) {
  const safeX = parseCoordinate(x, 'x');
  const safeY = parseCoordinate(y, 'y');
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${safeX}, ${safeY})
    Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      public class MouseClick {
        [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
        public static void Click() { mouse_event(2, 0, 0, 0, 0); mouse_event(4, 0, 0, 0, 0); }
      }
'@
    [MouseClick]::Click()
  `;
  await runPowerShell(ps);
}

async function typeText(text) {
  // Use SendKeys for text input
  const escaped = escapeSendKeysText(text);
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${psSingleQuote(escaped)}')
  `;
  await runPowerShell(ps);
}

async function scroll(direction, amount) {
  const safeDirection = parseScrollDirection(direction);
  const safeAmount = parseScrollAmount(amount);
  const scrollAmount = safeDirection === 'up' ? safeAmount * 120 : -(safeAmount * 120);
  const ps = `
    Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      public class MouseScroll {
        [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
        public static void Scroll(int amount) { mouse_event(0x0800, 0, 0, amount, 0); }
      }
'@
    [MouseScroll]::Scroll(${scrollAmount})
  `;
  await runPowerShell(ps);
}

async function pressKey(key) {
  const keyMap = {
    'enter': '{ENTER}',
    'tab': '{TAB}',
    'escape': '{ESC}',
    'esc': '{ESC}',
    'backspace': '{BACKSPACE}',
    'delete': '{DELETE}',
    'up': '{UP}',
    'down': '{DOWN}',
    'left': '{LEFT}',
    'right': '{RIGHT}',
    'home': '{HOME}',
    'end': '{END}',
    'ctrl+a': '^a',
    'ctrl+c': '^c',
    'ctrl+v': '^v',
    'ctrl+s': '^s',
    'ctrl+z': '^z',
    'alt+tab': '%{TAB}',
    'alt+f4': '%{F4}',
  };

  const sendKey = normalizeKey(key);
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${psSingleQuote(sendKey)}')
  `;
  await runPowerShell(ps);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, HOST, () => {
  log('SERVER_START', { host: HOST, port: PORT });
  console.log(`\n  Computer Use Server running on http://${HOST}:${PORT}`);
  console.log(`  Health check: http://${HOST}:${PORT}/health\n`);
});
