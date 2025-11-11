// loadtest.js
import autocannon from 'autocannon';

// === Ziel-URL anpassen ===
const target = 'https://poker-joker.tech/api/admin/stats'; // oder eine andere API-Route

console.log(`🔥 Starte Load-Test auf: ${target}`);

const instance = autocannon({
  url: target,
  connections: 25,    // gleichzeitige Verbindungen
  duration: 10,       // Dauer in Sekunden
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    // ggf. Cookie oder Auth-Header falls nötig
  }
});

autocannon.track(instance);

instance.on('done', (res) => {
  console.log('\n=== 📊 Ergebnis ===');
  console.log(`Requests/sec: ${res.requests.average}`);
  console.log(`Latency (avg): ${res.latency.average} ms`);
  console.log(`Throughput: ${res.throughput.average / 1024} KB/s`);
  console.log('====================\n');
});
