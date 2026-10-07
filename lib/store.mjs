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

  archive(campaign) {
    if (!campaign?.id) return;
    const d = path.join(this.dir, 'archive');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${campaign.id}.json`), JSON.stringify(campaign, null, 1));
  }
}
