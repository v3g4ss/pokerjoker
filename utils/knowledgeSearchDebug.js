// utils/knowledgeSearchDebug.js
// Usage (Windows cmd):
//   set KB_DEBUG_SEARCH=1 && node utils/knowledgeSearchDebug.js "your query here"
//
// This script helps validate that vague queries still trigger the right KB docs.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { searchChunks } = require('./knowledge');

(async () => {
  const q = process.argv.slice(2).join(' ').trim();
  if (!q) {
    console.log('Provide a query, e.g. node utils/knowledgeSearchDebug.js "3bet strategy"');
    process.exit(1);
  }

  const hits = await searchChunks(q, [], 8);
  console.log('Query:', q);
  console.log('Hits:', hits.length);
  for (const h of hits) {
    console.log('-', {
      id: h.id,
      doc_id: h.doc_id,
      title: h.title,
      category: h.category,
      image_url: h.image_url || null,
      source: h.source
    });
  }
  process.exit(0);
})().catch((e) => {
  console.error('Error:', e);
  process.exit(2);
});

