const express = require('express');
const productsRouter = require('./routes/products');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// Basic health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// Mount products routes
app.use('/products', productsRouter);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`happyfestivegiftsApi listening on port ${PORT}`);
});
