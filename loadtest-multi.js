// loadtest-multi.js
import autocannon from "autocannon";

const routes = [
  { name: "Chat", url: "https://poker-joker.tech/api/chat" },
  { name: "Tokens", url: "https://poker-joker.tech/api/tokens" },
  { name: "Admin Stats", url: "https://poker-joker.tech/api/admin/stats" },
  { name: "User Summary", url: "https://poker-joker.tech/api/admin/user-summary?page=1&limit=10" }
];

const headers = {
  "Content-Type": "application/json",
  // optional: Cookie für authentifizierte Routen
  // "Cookie": "sessionId=<dein-session-cookie>"
};

async function runTests() {
  console.log(`🚀 Starte Multi-Route Benchmark (${routes.length} APIs)…\n`);

  for (const r of routes) {
    console.log(`📍 Teste: ${r.name} → ${r.url}`);
    const result = await runSingle(r.url);
    printResult(r.name, result);
  }
}

function runSingle(url) {
  return new Promise((resolve) => {
    const instance = autocannon({
      url,
      connections: 15,  // gleichzeitige Requests
      duration: 8,      // Sekunden
      method: "GET",
      headers,
    });

    instance.on("done", resolve);
  });
}

function printResult(name, res) {
  console.log(`\n=== 📊 ${name} ===`);
  console.log(`Requests/sec: ${res.requests.average}`);
  console.log(`Latency (avg): ${res.latency.average} ms`);
  console.log(`Throughput: ${(res.throughput.average / 1024).toFixed(2)} KB/s`);
  console.log("===========================\n");
}

runTests();
