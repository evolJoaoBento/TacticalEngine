// Original card illustrations served by the Daggerheart.su reference.
// The SRD text is independently sourced from the vendored structured data.
import fs from 'node:fs/promises';
const data = JSON.parse(await fs.readFile('tools/srd-sources/daggersearch/core/domain-cards.json', 'utf8'));
const cards = Array.isArray(data) ? data : Object.values(data);
await fs.mkdir('public/cards', { recursive: true });
const manifest = {};
const queue = [...cards];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let card; (card = queue.shift());) {
    const name = card.name['en-US'];
    const id = name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `https://en.daggerheart.su/image/domain/card/${id}.jpg`;
    const response = await fetch(url);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
      console.log(`No art: ${id}`); continue;
    }
    await fs.writeFile(`public/cards/${id}.jpg`, Buffer.from(await response.arrayBuffer()));
    manifest[id] = { source: url, file: `/cards/${id}.jpg` };
  }
}));
await fs.writeFile('public/cards/sources.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Downloaded ${Object.keys(manifest).length} illustrations.`);
