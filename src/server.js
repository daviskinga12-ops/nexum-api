require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║        NEXUM API — Trust Layer           ║
║   The infrastructure beneath every      ║
║           exchange.                      ║
╠══════════════════════════════════════════╣
║  Port    : ${PORT}                           ║
║  Env     : ${(process.env.NODE_ENV || 'development').padEnd(30)}║
║  M-Pesa  : ${(process.env.MPESA_ENV || 'sandbox').padEnd(30)}║
╚══════════════════════════════════════════╝
  `);
});
