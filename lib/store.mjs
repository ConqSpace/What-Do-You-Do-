// The campaign lives in one JSON file (data/campaign.json). Starting a new campaign
// moves the old one to data/archive/.

import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(root) {
    this.dir = path.join(root, 'data');
    this.file = path.join(this.dir, 'campaign.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.timer = null;
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return null; }
  }

  saveNow(campaign) {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(campaign, null, 1));
    fs.renameSync(tmp, this.file);
  }

  saveSoon(campaign) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.saveNow(campaign); }, 300);
  }

  // Character names from the last few archived campaigns, newest first (so a new table can
  // steer away from the names the models keep reaching for).
  recentNames(campaigns = 6) {
    const d = path.join(this.dir, 'archive');
    let files = [];
    try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => path.join(d, f)); } catch { return []; }
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const names = [];
    for (const f of files.slice(0, campaigns)) {
      try {
        for (const ch of Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).characters || {})) if (ch?.name && !names.includes(ch.name)) names.push(ch.name);
      } catch { /* an unreadable archive is skipped */ }
    }
    return names;
  }

  archive(campaign) {
    if (!campaign?.id) return;
    const d = path.join(this.dir, 'archive');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${campaign.id}.json`), JSON.stringify(campaign, null, 1));
  }
}
