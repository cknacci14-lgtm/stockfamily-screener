const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'signals.html');
const BACKUP = FILE + '.bak-entry-v2-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let html = fs.readFileSync(FILE, 'utf8');

// Regex untuk match price-grid block
const regex = /'<div class="price-grid">'\s*\+\s*'<div class="price-item"><span class="price-label">Entry Range<\/span>[\s\S]*?<\/div>'\s*\+\s*'<\/div>'\s*\+/;

if (!regex.test(html)) {
  console.log('❌ Regex tidak match');
  process.exit(1);
}

const replacement = `(function() {
        var items = '';
        if (s.entry_1 != null) items += '<div class="price-item"><span class="price-label">Entry 1</span><span class="price-value entry">' + fmtRp(s.entry_1) + '</span></div>';
        if (s.entry_2 != null) items += '<div class="price-item"><span class="price-label">Entry 2</span><span class="price-value entry">' + fmtRp(s.entry_2) + '</span></div>';
        if (s.entry_3 != null) items += '<div class="price-item"><span class="price-label">Entry 3</span><span class="price-value entry">' + fmtRp(s.entry_3) + '</span></div>';
        items += '<div class="price-item"><span class="price-label">Stop Loss</span><span class="price-value sl">' + fmtRp(s.stop_loss) + '</span></div>';
        items += '<div class="price-item"><span class="price-label">Target 1</span><span class="price-value tp">' + fmtRp(s.target_1) + '</span></div>';
        if (s.target_2 != null) items += '<div class="price-item"><span class="price-label">Target 2</span><span class="price-value tp">' + fmtRp(s.target_2) + '</span></div>';
        if (s.target_3 != null) items += '<div class="price-item"><span class="price-label">Target 3</span><span class="price-value tp">' + fmtRp(s.target_3) + '</span></div>';
        items += '<div class="price-item"><span class="price-label">Entry Avg</span><span class="price-value default">' + fmtRp(s.entry_avg) + '</span></div>';
        return '<div class="price-grid">' + items + '</div>';
      })() +`;

html = html.replace(regex, replacement);
fs.writeFileSync(FILE, html, 'utf8');
console.log('✅ Entry 1/2/3 display updated');
