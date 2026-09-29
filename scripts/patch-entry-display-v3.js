const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'signals.html');
const BACKUP = FILE + '.bak-entry-track-' + Date.now();

fs.copyFileSync(FILE, BACKUP);
console.log('📁 Backup:', path.basename(BACKUP));

let html = fs.readFileSync(FILE, 'utf8');

// === 1. Replace price-grid (Entry 1/2/3) dengan entry tracker ===
const oldGrid = /\(function\(\) \{\s*var items = '';\s*if \(s\.entry_1 != null\)[\s\S]*?return '<div class="price-grid">' \+ items \+ '<\/div>';\s*\}\)\(\) \+/;

const newGrid = `(function() {
        var w1 = s.entry_1_pct || 30;
        var w2 = s.entry_2_pct || 30;
        var w3 = s.entry_3_pct || 40;
        
        function entryRow(price, weight, hitAt, idx) {
          if (price == null) return '';
          var icon = hitAt ? '✅' : '⏳';
          var status = hitAt ? 'Kena' : 'Belum';
          var dateStr = hitAt ? new Date(hitAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short'}) : '';
          var color = hitAt ? '#10b981' : '#6b7280';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0a0e17;border-radius:6px;margin-bottom:4px;border-left:3px solid ' + color + ';">' +
            '<div><span style="color:#9ca3af;font-size:10px;font-weight:600;letter-spacing:0.5px;">ENTRY ' + idx + '</span> ' +
            '<span class="mono" style="color:#00E5FF;font-weight:700;margin-left:8px;font-size:13px;">' + fmtRp(price) + '</span> ' +
            '<span style="color:#6b7280;font-size:10px;margin-left:6px;">(' + weight + '%)</span></div>' +
            '<div style="font-size:11px;"><span style="color:' + color + ';font-weight:600;">' + icon + ' ' + status + '</span>' +
            (dateStr ? '<span style="color:#6b7280;margin-left:6px;">' + dateStr + '</span>' : '') +
            '</div></div>';
        }
        
        var entryRows = '';
        entryRows += entryRow(s.entry_1, w1, s.entry_1_hit_at, 1);
        entryRows += entryRow(s.entry_2, w2, s.entry_2_hit_at, 2);
        entryRows += entryRow(s.entry_3, w3, s.entry_3_hit_at, 3);
        
        var plannedAvg = s.entry_avg;
        var actualAvg = s.actual_entry_avg;
        var avgDisplay = '';
        
        if (actualAvg && actualAvg !== plannedAvg) {
          avgDisplay = '<div style="display:flex;justify-content:space-between;padding:8px 10px;background:rgba(16,185,129,0.08);border-radius:6px;border:1px solid rgba(16,185,129,0.3);margin-top:8px;">' +
            '<div><span style="color:#9ca3af;font-size:10px;">PLANNED AVG</span><br>' +
            '<span class="mono" style="color:#6b7280;font-weight:700;font-size:14px;text-decoration:line-through;">' + fmtRp(plannedAvg) + '</span></div>' +
            '<div style="text-align:right;"><span style="color:#10b981;font-size:10px;font-weight:600;">ACTUAL AVG (PARTIAL)</span><br>' +
            '<span class="mono" style="color:#10b981;font-weight:800;font-size:16px;">' + fmtRp(actualAvg) + '</span></div>' +
            '</div>';
        } else {
          avgDisplay = '<div style="display:flex;justify-content:space-between;padding:8px 10px;background:#0a0e17;border-radius:6px;margin-top:8px;">' +
            '<div><span style="color:#9ca3af;font-size:10px;">ENTRY AVG</span><br>' +
            '<span class="mono" style="color:#e0e0e0;font-weight:700;font-size:14px;">' + fmtRp(plannedAvg) + '</span></div>' +
            '</div>';
        }
        
        // SL + TPs on separate row
        var slTpRow = '<div class="price-grid">';
        slTpRow += '<div class="price-item"><span class="price-label">Stop Loss</span><span class="price-value sl">' + fmtRp(s.stop_loss) + '</span></div>';
        slTpRow += '<div class="price-item"><span class="price-label">Target 1</span><span class="price-value tp">' + fmtRp(s.target_1) + '</span></div>';
        if (s.target_2 != null) slTpRow += '<div class="price-item"><span class="price-label">Target 2</span><span class="price-value tp">' + fmtRp(s.target_2) + '</span></div>';
        if (s.target_3 != null) slTpRow += '<div class="price-item"><span class="price-label">Target 3</span><span class="price-value tp">' + fmtRp(s.target_3) + '</span></div>';
        slTpRow += '</div>';
        
        return '<div style="margin:16px 0;">' + entryRows + avgDisplay + slTpRow + '</div>';
      })() +`;

if (oldGrid.test(html)) {
  html = html.replace(oldGrid, newGrid);
  console.log('✅ Entry tracker display updated');
} else {
  console.log('⚠️ Grid pattern not found — coba fallback');
}

fs.writeFileSync(FILE, html, 'utf8');
console.log('🎉 Selesai!');
