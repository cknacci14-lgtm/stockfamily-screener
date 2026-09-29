const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'server.js');
const BACKUP = FILE + '.bak-image-upload-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let code = fs.readFileSync(FILE, 'utf8');

if (code.includes('/api/admin/signals/upload-image')) {
  console.log('⚠️ Endpoint sudah ada');
  process.exit(0);
}

const endpoint = `

// === UPLOAD SIGNAL IMAGE ===
app.post('/api/admin/signals/upload-image', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { image, filename } = req.body || {};
    if (!image || !filename) {
      return res.status(400).json({ success: false, error: 'image dan filename wajib' });
    }
    
    // Parse base64 data URI
    const match = image.match(/^data:image\\/(\\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Format image tidak valid' });
    }
    
    const ext = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Validate size (max 5MB)
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image max 5MB' });
    }
    
    // Build filename: signal_{timestamp}_{random}.{ext}
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const safeName = String(filename).replace(/[^a-z0-9._-]/gi, '_').substring(0, 50);
    const storagePath = \`\${timestamp}_\${random}_\${safeName}\`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('signal-images')
      .upload(storagePath, buffer, {
        contentType: 'image/' + ext,
        upsert: false
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('signal-images')
      .getPublicUrl(storagePath);
    
    res.json({
      success: true,
      url: urlData.publicUrl,
      path: storagePath,
      size: buffer.length
    });
  } catch (err) {
    console.error('[upload-signal-image]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === DELETE SIGNAL IMAGE ===
app.delete('/api/admin/signals/delete-image', express.json(), async (req, res) => {
  try {
    const { path: storagePath } = req.body || {};
    if (!storagePath) return res.status(400).json({ success: false, error: 'path wajib' });
    
    const { error } = await supabase.storage
      .from('signal-images')
      .remove([storagePath]);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[delete-signal-image]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

`;

// Insert sebelum "// === SIGNAL MANAGEMENT API ==="
const anchor = '// === SIGNAL MANAGEMENT API ===';
if (code.includes(anchor)) {
  code = code.replace(anchor, endpoint + anchor);
  fs.writeFileSync(FILE, code, 'utf8');
  console.log('✅ Endpoint upload-image ditambahkan');
} else {
  console.log('❌ Anchor tidak ditemukan');
}
