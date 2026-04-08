const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3003;
const LOG_FILE = path.join(__dirname, 'computer-use.log');

// Secret token for authentication
const TUNNEL_SECRET = process.env.TUNNEL_SECRET || 'dev-secret-change-me';

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
  if (token !== TUNNEL_SECRET) {
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
        // Wait for app to open then screenshot
        await sleep(2000);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'open_app', app: appName, screenshot });
      }

      case 'click': {
        const { x, y } = params || {};
        if (x == null || y == null) {
          return res.json({ success: false, error: 'Missing x, y coordinates' });
        }
        await click(x, y);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'click', x, y, screenshot });
      }

      case 'type': {
        const { text } = params || {};
        if (!text) {
          return res.json({ success: false, error: 'Missing text' });
        }
        await typeText(text);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'type', text, screenshot });
      }

      case 'scroll': {
        const { direction, amount } = params || {};
        await scroll(direction || 'down', amount || 3);
        await sleep(500);
        const screenshot = await takeScreenshot();
        return res.json({ success: true, action: 'scroll', direction, screenshot });
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
    return res.status(500).json({ error: err.message });
  }
});

// --- PowerShell helpers (no native deps needed) ---

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const escaped = script.replace(/"/g, '\\"');
    exec(`powershell -NoProfile -Command "${escaped}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15000,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function takeScreenshot() {
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $tmpFile = Join-Path $env:TEMP "fp-screenshot.png"
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bitmap.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output $tmpFile
  `;

  const tmpFile = await runPowerShell(ps);
  const buffer = fs.readFileSync(tmpFile.trim());
  fs.unlinkSync(tmpFile.trim());
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function openApp(exeName) {
  await runPowerShell(`Start-Process '${exeName}'`);
}

async function click(x, y) {
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
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
  const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}');
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
  `;
  await runPowerShell(ps);
}

async function scroll(direction, amount) {
  const scrollAmount = direction === 'up' ? amount * 120 : -(amount * 120);
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

  const sendKey = keyMap[key.toLowerCase()] || key;
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')
  `;
  await runPowerShell(ps);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(PORT, () => {
  log('SERVER_START', { port: PORT });
  console.log(`\n  Computer Use Server running on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health\n`);
});
